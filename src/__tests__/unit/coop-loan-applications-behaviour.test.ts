/**
 * @jest-environment node
 */

/**
 * Cooperative loan applications, EXECUTED — submission, and the three readers.
 *
 * At 3.5%, and it holds the tier and eligibility arithmetic that decides how much
 * a member may borrow. Two recorded defects live here, both of them queries:
 *
 *   - A MEMBER'S OWN LOAN LIST SHOWED NOTHING while their loan was live.
 *     /cooperatives/loans files into COOPERATIVE_LOANS keyed by `memberId`;
 *     the reader queried LOAN_APPLICATIONS by `userId`. Two collections, two
 *     borrower keys, one of them read.
 *   - THE ADMIN PENDING QUEUE had the same split, so applications sat unseen
 *     while members waited.
 *
 * Both are "which collection, keyed how", and a call-recorder harness whose
 * `where()` was a no-op could not tell a reader of one collection from a reader
 * of both.
 *
 * The submission path is also the clearest arithmetic in the codebase: a tier
 * multiplier caps the amount, a tier cap bounds the duration, and the repayment
 * is computed in KOBO to keep floating-point drift out of a money figure.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

let store: FakeDbHandle;

function actAs(id: string, roles: string[] = ['user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com`, name: id } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
});

async function actions() {
    return import('@/app/actions/cooperative/_loans_applications');
}

const MEMBER = 'member-1';

/** A submission that satisfies every rule, so a test can vary one thing. */
function validForm(overrides: Record<string, unknown> = {}) {
    return {
        userId: MEMBER,
        userEmail: 'member@example.com',
        fullName: 'Ada Obi',
        amount: 50_000,
        purpose: 'Stock for the shop',
        durationMonths: 6,
        contributionAmount: 100_000,
        tier: 'Member' as const,
        guarantorName: 'Chidi Eze',
        guarantorPhone: '08031111111',
        ...overrides,
    };
}

/** The applications the store holds, whichever collection they landed in. */
function filed(): Record<string, unknown>[] {
    return [
        ...store.all(COLLECTIONS.LOAN_APPLICATIONS).map(([, d]) => d),
        ...store.all(COLLECTIONS.COOPERATIVE_LOANS).map(([, d]) => d),
    ];
}

// ─── submission: the guards ──────────────────────────────────────────────────

describe('submitting a loan application', () => {
    it('files it as pending, stamped with the product', async () => {
        // loanProduct is the discriminator finding #70 added. Without it the
        // business-loan queue and the cooperative queue each showed both.
        const { submitLoanApplicationAction } = await actions();
        const result = await submitLoanApplicationAction(validForm());

        expect(result.success).toBe(true);
        const [app] = filed();
        expect(app.status).toBe('pending');
        expect(app.loanProduct).toBe('cooperative');
        expect(app.userId).toBe(MEMBER);
        expect(app.guarantorVerified).toBe(false);
    });

    it('demanding a guarantor, which the business product does not have', async () => {
        const { submitLoanApplicationAction } = await actions();

        expect((await submitLoanApplicationAction(validForm({ guarantorName: '  ' }))).success)
            .toBe(false);
        expect((await submitLoanApplicationAction(validForm({ guarantorPhone: '' }))).success)
            .toBe(false);
        expect(filed()).toHaveLength(0);
    });

    it('and refusing to file an application on somebody else’s behalf', async () => {
        // The userId comes from the form, so without this check any member could
        // file a loan in another member's name — and a loan is money.
        actAs('somebody-else');
        const { submitLoanApplicationAction } = await actions();

        const result = await submitLoanApplicationAction(validForm());
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/unauthorized/i);
        expect(filed()).toHaveLength(0);
    });

    it('and an unauthenticated caller', async () => {
        (globalThis as { mockRequireSession: { mockImplementation: (f: () => unknown) => void } })
            .mockRequireSession.mockImplementation(() => Promise.resolve({
                session: null, error: { error: 'Authentication required' },
            }));

        const { submitLoanApplicationAction } = await actions();
        expect((await submitLoanApplicationAction(validForm())).success).toBe(false);
        expect(filed()).toHaveLength(0);
    });
});

// ─── the tier arithmetic ─────────────────────────────────────────────────────

describe('the tier rules', () => {
    it('refuse a tier that does not match the contribution', async () => {
        // The tier arrives in the form and is recomputed from the contribution.
        // Trusting the submitted value would let a member claim a tier whose
        // multiplier lets them borrow more.
        const { calculateUserTier } = await import('@/lib/cooperative-tiers');
        expect(calculateUserTier(100_000)).toBe('Member');

        const { submitLoanApplicationAction } = await actions();
        const result = await submitLoanApplicationAction(
            validForm({ tier: 'Gold' as never }));

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Tier mismatch/i);
        expect(filed()).toHaveLength(0);
    });

    it('cap the amount at the tier multiple of the savings', async () => {
        const { COOPERATIVE_TIERS } = await import('@/lib/cooperative-tiers');
        const multiplier = COOPERATIVE_TIERS.Member.maxLoanMultiplier;
        const contribution = 100_000;
        const ceiling = contribution * multiplier;

        const { submitLoanApplicationAction } = await actions();

        const over = await submitLoanApplicationAction(
            validForm({ contributionAmount: contribution, amount: ceiling + 1 }));
        expect(over.success).toBe(false);
        expect(over.error).toMatch(/exceeds your limit/i);

        const at = await submitLoanApplicationAction(
            validForm({ contributionAmount: contribution, amount: ceiling }));
        expect(at.success).toBe(true);
        expect(filed()).toHaveLength(1);
    });

    it('and cap the duration at the tier maximum', async () => {
        const { getTierMaxDuration } = await import('@/lib/cooperative-tiers');
        const max = getTierMaxDuration('Member');

        const { submitLoanApplicationAction } = await actions();

        const over = await submitLoanApplicationAction(
            validForm({ durationMonths: max + 1 }));
        expect(over.success).toBe(false);
        expect(over.error).toMatch(/duration exceeds/i);

        const at = await submitLoanApplicationAction(validForm({ durationMonths: max }));
        expect(at.success).toBe(true);
    });
});

describe('the repayment arithmetic', () => {
    it('computes interest, total and monthly payment from the tier rate', async () => {
        const { getTierInterestRate } = await import('@/lib/cooperative-tiers');
        const rate = getTierInterestRate('Member');

        const { submitLoanApplicationAction } = await actions();
        await submitLoanApplicationAction(validForm({ amount: 50_000, durationMonths: 6 }));

        const [app] = filed();
        expect(app.interestRate).toBe(rate);
        expect(app.totalRepayment as number).toBeGreaterThan(50_000);
        expect(app.monthlyPayment as number).toBeGreaterThan(0);
    });

    it('and the monthly payment times the term equals the total, to the naira', async () => {
        // The reason it is computed in KOBO. In floating-point naira the schedule
        // and the total drift apart, and a member is billed a total their twelve
        // instalments do not add up to.
        const { submitLoanApplicationAction } = await actions();
        await submitLoanApplicationAction(validForm({ amount: 50_000, durationMonths: 6 }));

        const [app] = filed();
        const total = app.totalRepayment as number;
        const monthly = app.monthlyPayment as number;

        expect(Math.abs(monthly * 6 - total)).toBeLessThanOrEqual(1);
    });

    it('with no floating-point tail on either figure', async () => {
        // 0.30000000000000004 in a money field is how a total ends up rendered
        // with fifteen decimal places on an invoice.
        const { submitLoanApplicationAction } = await actions();
        await submitLoanApplicationAction(validForm({ amount: 37_500, durationMonths: 7 }));

        const [app] = filed();
        for (const field of ['totalRepayment', 'monthlyPayment']) {
            const value = app[field] as number;
            expect(Math.round(value * 100)).toBeCloseTo(value * 100, 6);
        }
    });
});

// ─── double lending ──────────────────────────────────────────────────────────

describe('one open loan at a time, platform-wide', () => {
    it.each(['pending', 'reviewing', 'approved', 'partially_approved', 'disbursed'])(
        'an existing %s application in LOAN_APPLICATIONS blocks a new one', async (status) => {
            store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'existing', { userId: MEMBER, status });

            const { submitLoanApplicationAction } = await actions();
            const result = await submitLoanApplicationAction(validForm());

            expect(result.success).toBe(false);
            expect(store.size(COLLECTIONS.LOAN_APPLICATIONS)).toBe(1);
        });

    it('and one in COOPERATIVE_LOANS blocks it too, under its own borrower key', async () => {
        // The second collection, keyed on `memberId` rather than `userId`. A
        // check that read only the first would let a member hold two live loans
        // by filing one through each door.
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'existing', { memberId: MEMBER, status: 'disbursed' });

        const { submitLoanApplicationAction } = await actions();
        const result = await submitLoanApplicationAction(validForm());

        expect(result.success).toBe(false);
        expect(store.size(COLLECTIONS.LOAN_APPLICATIONS)).toBe(0);
    });

    it('while a settled loan does not block anything', async () => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'old', { userId: MEMBER, status: 'completed' });
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'refused', { userId: MEMBER, status: 'rejected' });

        const { submitLoanApplicationAction } = await actions();
        expect((await submitLoanApplicationAction(validForm())).success).toBe(true);
    });

    it('and ANOTHER member’s open loan does not block this one', async () => {
        // THE query test. The block is per member, and a check that ignored the
        // borrower would stop the whole cooperative lending the moment one loan
        // was live.
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'other', { userId: 'somebody-else', status: 'disbursed' });

        const { submitLoanApplicationAction } = await actions();
        expect((await submitLoanApplicationAction(validForm())).success).toBe(true);
    });
});

// ─── the member's own list: two collections, two keys ────────────────────────

describe('a member’s own loan list', () => {
    beforeEach(() => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'general-1',
            { userId: MEMBER, amount: 10_000, status: 'pending' });
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'coop-1',
            { memberId: MEMBER, amount: 20_000, status: 'disbursed' });
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'other-general',
            { userId: 'somebody-else', amount: 99, status: 'pending' });
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'other-coop',
            { memberId: 'somebody-else', amount: 99, status: 'pending' });
    });

    it('includes BOTH collections — the list used to show nothing', async () => {
        // THE defect. /cooperatives/loans files into COOPERATIVE_LOANS keyed by
        // memberId, and this reader queried LOAN_APPLICATIONS by userId. A member
        // with a live loan saw an empty history.
        actAs(MEMBER);
        const { getUserLoanApplicationsAction } = await actions();
        const rows = await getUserLoanApplicationsAction(MEMBER);

        expect(rows.map((r) => r.id).sort()).toEqual(['coop-1', 'general-1']);
    });

    it('and nobody else’s', async () => {
        actAs(MEMBER);
        const { getUserLoanApplicationsAction } = await actions();
        const rows = await getUserLoanApplicationsAction(MEMBER);

        expect(rows.map((r) => r.id)).not.toContain('other-general');
        expect(rows.map((r) => r.id)).not.toContain('other-coop');
    });

    it('refusing to show one member’s loans to another', async () => {
        actAs('nosy-member');
        const { getUserLoanApplicationsAction } = await actions();
        expect(await getUserLoanApplicationsAction(MEMBER)).toEqual([]);
    });

    it('while an admin may read anybody’s', async () => {
        actAs('admin-1', ['super_admin']);
        const { getUserLoanApplicationsAction } = await actions();
        expect((await getUserLoanApplicationsAction(MEMBER)).length).toBe(2);
    });

    it('and an unauthenticated caller gets an empty list, not an error', async () => {
        (globalThis as { mockRequireSession: { mockImplementation: (f: () => unknown) => void } })
            .mockRequireSession.mockImplementation(() => Promise.resolve({
                session: null, error: { error: 'Authentication required' },
            }));

        const { getUserLoanApplicationsAction } = await actions();
        expect(await getUserLoanApplicationsAction(MEMBER)).toEqual([]);
    });
});

// ─── the admin pending queue ─────────────────────────────────────────────────

describe('the admin pending queue', () => {
    beforeEach(() => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'g-pending', { userId: 'a', status: 'pending' });
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'g-approved', { userId: 'b', status: 'approved' });
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'c-pending', { memberId: 'c', status: 'pending' });
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'c-disbursed', { memberId: 'd', status: 'disbursed' });
        actAs('admin-1', ['super_admin']);
    });

    it('spans both collections, so nothing waits unseen', async () => {
        const { getPendingLoanApplicationsAction } = await actions();
        const rows = await getPendingLoanApplicationsAction();

        expect(rows.map((r) => r.id).sort()).toEqual(['c-pending', 'g-pending']);
    });

    it('and shows only what is pending', async () => {
        const { getPendingLoanApplicationsAction } = await actions();
        const ids = (await getPendingLoanApplicationsAction()).map((r) => r.id);

        expect(ids).not.toContain('g-approved');
        expect(ids).not.toContain('c-disbursed');
    });

    it('refusing a non-admin with an empty list', async () => {
        actAs('member-x', ['user']);
        const { getPendingLoanApplicationsAction } = await actions();
        expect(await getPendingLoanApplicationsAction()).toEqual([]);
    });
});

// ─── the admin stats ─────────────────────────────────────────────────────────

describe('the admin loan statistics', () => {
    beforeEach(() => {
        actAs('admin-1', ['super_admin']);
    });

    it('are refused to a non-admin', async () => {
        actAs('member-x', ['user']);
        const { getAdminLoanStatsAction } = await actions();
        const result = await getAdminLoanStatsAction();
        expect(result.success).toBe(false);
    });

    it('and count across both collections for an admin', async () => {
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'g1', { userId: 'a', status: 'pending', amount: 1000 });
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'c1', { memberId: 'b', status: 'pending', amount: 2000 });

        const { getAdminLoanStatsAction } = await actions();
        const result = await getAdminLoanStatsAction();

        // The counts live under `stats`, not `data`, and they span BOTH
        // collections — the cards used to count loan_applications alone and read
        // "Pending: 0" above a queue full of pending member applications.
        expect(result.success).toBe(true);
        expect(result.stats).toMatchObject({ total: 2, pending: 2 });
    });
});

describe('the admin application list', () => {
    beforeEach(() => {
        actAs('admin-1', ['super_admin']);
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, 'g1',
            { userId: 'a', status: 'pending', amount: 1000, appliedAt: '2026-01-01T00:00:00.000Z' });
        store.seed(COLLECTIONS.COOPERATIVE_LOANS, 'c1',
            { memberId: 'b', status: 'approved', amount: 2000, appliedAt: '2026-02-01T00:00:00.000Z' });
    });

    it('returns applications from both collections', async () => {
        const { getAdminLoanApplicationsAction } = await actions();
        const result = await getAdminLoanApplicationsAction({});

        expect(result.success).toBe(true);
        // `data` IS the array; there is no `applications` key. Written the other
        // way first, which passed `?? []` and asserted on an empty list — the
        // shape of a vacuous pass, caught only because the ids were checked.
        const ids = ((result.data ?? []) as { id: string }[]).map((a) => a.id).sort();
        expect(ids).toEqual(['c1', 'g1']);
    });

    it('and is refused to a non-admin', async () => {
        actAs('member-x', ['user']);
        const { getAdminLoanApplicationsAction } = await actions();
        expect((await getAdminLoanApplicationsAction({})).success).toBe(false);
    });
});
