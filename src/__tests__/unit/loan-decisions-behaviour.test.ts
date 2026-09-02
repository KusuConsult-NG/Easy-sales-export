/**
 * @jest-environment node
 */

/**
 * The loan decisions, EXECUTED — approve, reject, disburse.
 *
 * At 26%. Every guard in this file has been written or corrected by a previous
 * pass — the claimed transitions, dual control, the self-approval refusal, the
 * platform-wide double-lending check, the maximum-loan ceiling — and not one of
 * them had ever been run.
 *
 * APPLICATIONS LIVE IN TWO COLLECTIONS, AND THIS FILE READS ONE SHAPE.
 *
 * lib/loan-application-location.ts exists because of that split, and it ships
 * two functions:
 *
 *   resolveLoanApplication     find the row in whichever collection holds it
 *   normaliseLoanApplication   "cooperative_loans keys the borrower as
 *                              `memberId`; loan_applications uses `userId`"
 *
 * _loans_applications.ts calls both. _loans_repayments.ts calls both. The
 * my-loan-applications route calls both. This file — the one that APPROVES,
 * REJECTS and DISBURSES — imports only the first, and then reads
 * `appData.userId` three times.
 *
 * cooperative_loans is, in that module's own words, "the ONLY path the member
 * loan page at /cooperatives/loans submits through".
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));

const mockNotify = jest.fn(async (_args: any) => ({ success: true }));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: (args: any) => mockNotify(args),
}));

const mockAudit = jest.fn(async (_args: any) => ({}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (args: any) => mockAudit(args),
    logAdminAction: jest.fn(async () => ({})),
}));

/**
 * claimStatusTransitionFromAny is a Postgres CAS reached through
 * supabaseAdmin.rpc, which the in-memory store cannot serve. Backed by the same
 * store here, with the SQL function's semantics, so the transitions this file
 * depends on are really exercised.
 */
const mockClaimFromAny = jest.fn(async (args: any) => {
    const { collection, id, fromAny, to, patch } = args;
    const doc = store.get(collection, id);
    if (!doc) return { claimed: false, exists: false, status: null };
    const current = doc.status ?? null;
    if (current === null) return { claimed: false, exists: true, status: null };
    if (!fromAny.includes(current)) return { claimed: false, exists: true, status: current };
    store.seed(collection, id, { ...doc, ...(patch ?? {}), status: to });
    return { claimed: true, exists: true, status: to };
});
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (args: any) => mockClaimFromAny(args),
}));

let store: FakeDbHandle;

const ADMIN = 'admin-1';
const OTHER_ADMIN = 'admin-2';
const BORROWER = 'member-1';

function actAs(id: string | null, roles: string[] = ['super_admin']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() =>
        Promise.resolve(
            id === null
                ? { session: null, error: { error: 'Authentication required' } }
                : { session: { user: { id, roles, email: `${id}@example.com`, name: id } }, error: null },
        ),
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(ADMIN);
});

async function actions() {
    return import('@/app/actions/cooperative/_loans_decisions');
}

// ─── seeds ───────────────────────────────────────────────────────────────────

/** A membership with savings, which is what the ceiling is computed against. */
function seedMembership(savingsBalance: number): void {
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, BORROWER, {
        userId: BORROWER,
        membershipStatus: 'active',
        status: 'active',
        savingsBalance,
    });
}

/** A row as loan_applications holds it — the wizard and the API route. */
function seedGeneralApplication(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.LOAN_APPLICATIONS, id, {
        userId: BORROWER,
        amount: 100_000,
        contributionAmount: 400_000,
        status: 'pending',
        purpose: 'Stock purchase',
        ...extra,
    });
}

/**
 * A row as cooperative_loans holds it — the member loan page.
 *
 * Exactly what _coop_money.ts writes: `memberId`, and NO `userId`, and no
 * `contributionAmount`.
 */
function seedMemberApplication(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.COOPERATIVE_LOANS, id, {
        memberId: BORROWER,
        amount: 100_000,
        status: 'pending',
        purpose: 'Stock purchase',
        ...extra,
    });
}

// ─── authorisation ───────────────────────────────────────────────────────────

describe('who may decide a loan', () => {
    it.each([
        ['approve', (a: any) => a.approveLoanAction('app-1', ADMIN)],
        ['reject', (a: any) => a.rejectLoanAction('app-1', ADMIN, 'Insufficient savings')],
        ['disburse', (a: any) => a.disburseLoanAction('app-1')],
    ])('%s refuses a caller with no session', async (_label: string, call: any) => {
        actAs(null);
        seedGeneralApplication('app-1');

        expect(await call(await actions())).toMatchObject({ success: false });
    });

    it.each([
        ['approve', (a: any) => a.approveLoanAction('app-1', ADMIN)],
        ['reject', (a: any) => a.rejectLoanAction('app-1', ADMIN, 'no')],
        ['disburse', (a: any) => a.disburseLoanAction('app-1')],
    ])('%s refuses an admin without cooperatives:approve_loans', async (_label: string, call: any) => {
        actAs('moderator-1', ['moderator']);
        seedGeneralApplication('app-1');

        expect(await call(await actions())).toMatchObject({ success: false, error: 'Unauthorized' });
    });
});

// ─── approval, on a loan_applications row ────────────────────────────────────

describe('approveLoanAction', () => {
    it('approves a small application outright', async () => {
        seedMembership(400_000);
        seedGeneralApplication('app-1');

        const { approveLoanAction } = await actions();
        expect(await approveLoanAction('app-1', ADMIN)).toMatchObject({ success: true });

        expect(store.get(COLLECTIONS.LOAN_APPLICATIONS, 'app-1')).toMatchObject({
            status: 'approved', reviewedBy: ADMIN,
        });
    });

    it('refuses an application that is not pending, and says so', async () => {
        seedMembership(400_000);
        seedGeneralApplication('app-1', { status: 'disbursed' });

        const { approveLoanAction } = await actions();
        const result = await approveLoanAction('app-1', ADMIN);

        expect(result.success).toBe(false);
        expect(result.error).toContain('not pending');
    });

    it('refuses an id in neither collection', async () => {
        const { approveLoanAction } = await actions();
        expect(await approveLoanAction('nope', ADMIN)).toMatchObject({
            success: false, error: 'Application not found',
        });
    });

    describe('the platform-wide double-lending check', () => {
        it('refuses when the borrower already holds another open application', async () => {
            seedMembership(400_000);
            seedGeneralApplication('app-1');
            seedGeneralApplication('app-other', { status: 'disbursed' });

            const { approveLoanAction } = await actions();
            const result = await approveLoanAction('app-1', ADMIN);

            expect(result.success).toBe(false);
            // AND THE ADMIN IS TOLD WHY. Every refusal the pre-check block
            // raises — the guarantor rule, "not pending", this one, the
            // ceiling — was thrown, and the function's outer catch replaced all
            // four with the single string "Failed to approve loan". Four
            // carefully worded messages, none of which could reach the screen.
            expect(result.error).toContain('already exists platform-wide');
            expect(store.get(COLLECTIONS.LOAN_APPLICATIONS, 'app-1')?.status).toBe('pending');
        });

        it('and when the other one is in the OTHER collection', async () => {
            // The two collections are one borrower's loan book. An open
            // cooperative_loans row must block a loan_applications approval.
            seedMembership(400_000);
            seedGeneralApplication('app-1');
            seedMemberApplication('coop-other', { status: 'approved' });

            const { approveLoanAction } = await actions();
            expect(await approveLoanAction('app-1', ADMIN)).toMatchObject({ success: false });
        });
    });

    describe('the maximum-loan ceiling', () => {
        it('refuses a loan above what the borrower may take, and says so', async () => {
            // cooperative-tiers puts the Member multiplier at 0.5 — a member may
            // borrow up to HALF their savings.
            seedMembership(100_000);
            seedGeneralApplication('app-1', { amount: 90_000, contributionAmount: 100_000 });

            const { approveLoanAction } = await actions();
            const result = await approveLoanAction('app-1', ADMIN);

            expect(result.success).toBe(false);
            expect(result.error).toContain('exceeds maximum limit');
            expect(store.get(COLLECTIONS.LOAN_APPLICATIONS, 'app-1')?.status).toBe('pending');
        });

        it('and allows one within it', async () => {
            seedMembership(400_000);
            seedGeneralApplication('app-1', { amount: 100_000, contributionAmount: 400_000 });

            const { approveLoanAction } = await actions();
            expect(await approveLoanAction('app-1', ADMIN)).toMatchObject({ success: true });
        });
    });

    describe('dual control', () => {
        const BIG = 3_000_000;

        it('takes the first admin as maker and holds at partially_approved', async () => {
            seedMembership(20_000_000);
            seedGeneralApplication('app-1', { amount: BIG, contributionAmount: 20_000_000 });

            const { approveLoanAction } = await actions();
            expect(await approveLoanAction('app-1', ADMIN)).toMatchObject({ success: true });

            const row = store.get(COLLECTIONS.LOAN_APPLICATIONS, 'app-1');
            expect(row?.status).toBe('partially_approved');
            expect(row?.approvalChain?.firstApprover).toBe(ADMIN);
        });

        it('refuses the same admin as checker', async () => {
            seedMembership(20_000_000);
            seedGeneralApplication('app-1', {
                amount: BIG,
                contributionAmount: 20_000_000,
                status: 'partially_approved',
                approvalChain: { firstApprover: ADMIN, firstApproverName: ADMIN },
            });

            const { approveLoanAction } = await actions();
            expect(await approveLoanAction('app-1', ADMIN)).toMatchObject({
                success: false,
                error: 'You cannot verify your own approval. Another admin is required.',
            });
            expect(store.get(COLLECTIONS.LOAN_APPLICATIONS, 'app-1')?.status).toBe('partially_approved');
        });

        it('and a second admin completes it, keeping both names', async () => {
            seedMembership(20_000_000);
            seedGeneralApplication('app-1', {
                amount: BIG,
                contributionAmount: 20_000_000,
                status: 'partially_approved',
                approvalChain: { firstApprover: ADMIN, firstApproverName: ADMIN },
            });
            actAs(OTHER_ADMIN);

            const { approveLoanAction } = await actions();
            expect(await approveLoanAction('app-1', OTHER_ADMIN)).toMatchObject({ success: true });

            const row = store.get(COLLECTIONS.LOAN_APPLICATIONS, 'app-1');
            expect(row?.status).toBe('approved');
            expect(row?.approvalChain).toMatchObject({
                firstApprover: ADMIN, secondApprover: OTHER_ADMIN,
            });
        });
    });
});

// ─── the shape this file did not read ────────────────────────────────────────

/**
 * A loan filed through the member page is a cooperative_loans row: `memberId`,
 * no `userId`, no `contributionAmount`. Three of this file's guards read those
 * two fields off it.
 *
 *   the double-lending queries   .where("userId", "==", appData.userId)
 *                                .where("memberId", "==", appData.userId)
 *                                — both against `undefined`
 *
 *   the ceiling                  getMaxLoanAmount(appData.contributionAmount)
 *                                = undefined * 0.5 = NaN, and `amount > NaN`
 *                                is FALSE, so the limit passed everything
 *
 *   the audit row and the        applicantId / userId = undefined
 *   disbursement notification
 */
describe('an application filed through the member loan page', () => {
    it('is found and approved like any other', async () => {
        seedMembership(400_000);
        seedMemberApplication('coop-1');

        const { approveLoanAction } = await actions();
        expect(await approveLoanAction('coop-1', ADMIN)).toMatchObject({ success: true });
        expect(store.get(COLLECTIONS.COOPERATIVE_LOANS, 'coop-1')?.status).toBe('approved');
    });

    it('has its borrower identified in the audit row', async () => {
        seedMembership(400_000);
        seedMemberApplication('coop-1');

        const { approveLoanAction } = await actions();
        await approveLoanAction('coop-1', ADMIN);

        const entry: any = (mockAudit.mock.calls.at(-1) as any[])?.[0];
        expect(entry.metadata.applicantId).toBe(BORROWER);
    });

    it('is subject to the double-lending check', async () => {
        // THE test. Both queries ran against `undefined`, so the check that
        // stops one borrower holding two loans matched nothing and passed.
        seedMembership(400_000);
        seedMemberApplication('coop-1');
        seedGeneralApplication('app-other', { status: 'disbursed' });

        const { approveLoanAction } = await actions();
        expect(await approveLoanAction('coop-1', ADMIN)).toMatchObject({ success: false });
        expect(store.get(COLLECTIONS.COOPERATIVE_LOANS, 'coop-1')?.status).toBe('pending');
    });

    it('and to the maximum-loan ceiling', async () => {
        // THE other test. getMaxLoanAmount(undefined) is NaN and `amount > NaN`
        // is false, so the ceiling — just corrected from 3x to 0.5x — was not
        // applied at all on the path the member UI submits through.
        seedMembership(100_000);
        seedMemberApplication('coop-1', { amount: 90_000 });

        const { approveLoanAction } = await actions();
        expect(await approveLoanAction('coop-1', ADMIN)).toMatchObject({ success: false });
        expect(store.get(COLLECTIONS.COOPERATIVE_LOANS, 'coop-1')?.status).toBe('pending');
    });

    it('and is allowed when it sits within that ceiling', async () => {
        // Vacuity guard: enforcing the ceiling must not refuse a sound loan.
        seedMembership(400_000);
        seedMemberApplication('coop-1', { amount: 100_000 });

        const { approveLoanAction } = await actions();
        expect(await approveLoanAction('coop-1', ADMIN)).toMatchObject({ success: true });
    });

    it('refuses when the ceiling cannot be computed at all, saying which', async () => {
        // A money ceiling that cannot be worked out must refuse, not pass. This
        // is the case that used to become NaN.
        //
        // The MESSAGE is what pins the branch. Without the explicit fail-closed
        // return, a null contribution coerces to 0 in `null * multiplier`, so
        // the ceiling check happens to refuse anyway — for the wrong reason,
        // telling the admin the loan "exceeds maximum limit of ₦0" rather than
        // that the borrower's record could not be read. And it is safe only by
        // accident: it holds for a positive amount and would pass a zero one.
        seedMemberApplication('coop-1', { amount: 100_000 });

        const { approveLoanAction } = await actions();
        const result = await approveLoanAction('coop-1', ADMIN);

        expect(result.success).toBe(false);
        expect(result.error).toContain('contribution record could not be read');
        expect(store.get(COLLECTIONS.COOPERATIVE_LOANS, 'coop-1')?.status).toBe('pending');
    });

    it('and does not let a zero-amount loan through on a missing record', async () => {
        // The accident the branch above protects against: `null * 0.5` is 0, and
        // `0 > 0` is false, so an amount of zero would have passed a ceiling
        // that could not be established.
        seedMemberApplication('coop-zero', { amount: 0 });

        const { approveLoanAction } = await actions();
        const result = await approveLoanAction('coop-zero', ADMIN);

        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.COOPERATIVE_LOANS, 'coop-zero')?.status).toBe('pending');
    });
});

// ─── rejection ───────────────────────────────────────────────────────────────

describe('rejectLoanAction', () => {
    it('rejects a pending application and records the reason', async () => {
        seedGeneralApplication('app-1');

        const { rejectLoanAction } = await actions();
        expect(await rejectLoanAction('app-1', ADMIN, 'Savings too low')).toMatchObject({ success: true });

        expect(store.get(COLLECTIONS.LOAN_APPLICATIONS, 'app-1')).toMatchObject({
            status: 'rejected', rejectionReason: 'Savings too low', reviewedBy: ADMIN,
        });
    });

    it('refuses to reject a loan whose money has gone', async () => {
        seedGeneralApplication('app-1', { status: 'disbursed' });

        const { rejectLoanAction } = await actions();
        const result = await rejectLoanAction('app-1', ADMIN, 'Changed my mind');

        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.LOAN_APPLICATIONS, 'app-1')?.status).toBe('disbursed');
    });

    it('names the borrower in the audit row for a member-page application', async () => {
        seedMemberApplication('coop-1');

        const { rejectLoanAction } = await actions();
        await rejectLoanAction('coop-1', ADMIN, 'Savings too low');

        const entry: any = (mockAudit.mock.calls.at(-1) as any[])?.[0];
        expect(entry.metadata.applicantId).toBe(BORROWER);
    });
});

// ─── disbursement ────────────────────────────────────────────────────────────

describe('disburseLoanAction', () => {
    it('disburses an approved loan', async () => {
        seedGeneralApplication('app-1', { status: 'approved' });

        const { disburseLoanAction } = await actions();
        expect(await disburseLoanAction('app-1')).toMatchObject({ success: true });

        expect(store.get(COLLECTIONS.LOAN_APPLICATIONS, 'app-1')).toMatchObject({
            status: 'disbursed', disbursedBy: ADMIN,
        });
    });

    it('refuses one that was never approved', async () => {
        seedGeneralApplication('app-1', { status: 'pending' });

        const { disburseLoanAction } = await actions();
        expect(await disburseLoanAction('app-1')).toMatchObject({
            success: false, error: 'Loan must be approved before disbursement',
        });
    });

    it('refuses a second disbursement', async () => {
        seedGeneralApplication('app-1', { status: 'disbursed' });

        const { disburseLoanAction } = await actions();
        expect(await disburseLoanAction('app-1')).toMatchObject({
            success: false, error: 'Loan already disbursed',
        });
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('tells the borrower, at a link that exists', async () => {
        seedGeneralApplication('app-1', { status: 'approved' });

        const { disburseLoanAction } = await actions();
        await disburseLoanAction('app-1');

        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
            userId: BORROWER,
            title: 'Funds Disbursed',
            link: '/cooperatives/my-loans',
        }));
    });

    it('and tells the borrower of a member-page loan too', async () => {
        // THE third consequence: `userId: appData.userId` was undefined, so the
        // member who filed through /cooperatives/loans was never told their
        // money had been sent.
        seedMemberApplication('coop-1', { status: 'approved' });

        const { disburseLoanAction } = await actions();
        await disburseLoanAction('coop-1');

        expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: BORROWER }));
    });
});
