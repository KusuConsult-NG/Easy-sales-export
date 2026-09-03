/**
 * @jest-environment node
 */

/**
 * repayLoanFromSavingsAction — paying a loan instalment out of cooperative
 * savings, with the ₦5,000 minimum balance applied.
 *
 * WHY THIS PATH DID NOT EXIST
 * ---------------------------
 * Three pots, and until now only two of them could pay a loan:
 *
 *   submitRepaymentAction        records a bank transfer that already arrived
 *   processLoanRepaymentAction   debits the WALLET
 *   (nothing)                    cooperative savingsBalance
 *
 * WHAT THESE TESTS ARE REALLY ABOUT
 * ---------------------------------
 * There is no transaction spanning "take from savings" and "credit the loan" —
 * runTransaction in this codebase takes no lock. So the ORDER of the steps is
 * the entire safety argument, and the two orders fail differently:
 *
 *   debit, then claim   two concurrent submissions both debit, one credits.
 *                       The member pays twice for one instalment.
 *
 *   claim, then debit   the loser returns before touching money.
 *
 * The implementation claims first. `claims the key before debiting` is the test
 * that holds that in place, and it is the one that would catch a later
 * refactor quietly reordering the two calls.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BORROWER = 'member-1';
const OTHER_MEMBER = 'member-2';
const ADMIN = 'admin-1';

/** Call order across both primitives, to assert the sequence rather than counts. */
const callOrder: string[] = [];

const mockClaimKey = jest.fn() as jest.Mock<any>;
const mockDebitFloor = jest.fn() as jest.Mock<any>;
const mockClaimPayment = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimIdempotencyKey: (...a: any[]) => { callOrder.push('claim'); return mockClaimKey(...a); },
    debitJsonbBalanceWithFloor: (...a: any[]) => { callOrder.push('debit'); return mockDebitFloor(...a); },
    claimPaymentOnce: (...a: any[]) => { callOrder.push('record'); return mockClaimPayment(...a); },
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), claimVersionedUpdate: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true, status: 'x' })),
    claimStatusTransitionFromAny: jest.fn(),
}));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, roles } },
        error: null,
    }));
}

/**
 * A member with `savings` in the pot, and an unpaid instalment on a loan they
 * own. The same stub serves the member read and the instalment read.
 */
function setDocs(savings: number) {
    const snap = {
        exists: true,
        empty: false,
        docs: [],
        data: () => ({
            // #276 added a canTransactAsMember guard to this action: existing
            // is not the same as may-transact, and this moves savings. The
            // fixture describes a member with money in the pot and a live
            // instalment, which in production means an approved membership —
            // it just never said so, so the new guard refused every case here
            // and the action looked broken. Stating it makes the fixture the
            // member it always described.
            membershipStatus: 'active',
            savingsBalance: savings,
            loanId: 'loan-1',
            userId: BORROWER,
            installmentNumber: 1,
            dueDate: { toDate: () => new Date(Date.now() + 7 * 24 * 3600 * 1000) },
            totalAmount: 10_000,
            paidAmount: 0,
            status: 'pending',
            amount: 100_000,
        }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

async function repay(amount: number, caller: { id: string; roles?: string[] } = { id: BORROWER }) {
    setSession(caller.id, caller.roles ?? []);
    const { repayLoanFromSavingsAction } = await import('@/app/actions/cooperative/_loans_repayments');
    return repayLoanFromSavingsAction({
        loanId: 'loan-1',
        installmentId: 'inst-1',
        userId: BORROWER,
        amount,
    });
}

describe('repayLoanFromSavingsAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        callOrder.length = 0;
        setDocs(50_000);
        mockClaimKey.mockResolvedValue({ claimed: true });
        mockDebitFloor.mockResolvedValue({ ok: true, balance: 40_000 });
        mockClaimPayment.mockResolvedValue({ claimed: true, status: 'loan_repayment' });
    });

    describe('the ₦5,000 floor', () => {
        it('enforces the floor in the debit itself, not only in a read', async () => {
            // The read before it is a UX fast path. THIS is the guard, and it has
            // to travel with the deduction — a floor checked in JavaScript and
            // applied in SQL is two operations that concurrency can separate.
            await repay(10_000);

            expect(mockDebitFloor).toHaveBeenCalledWith(expect.objectContaining({
                table: 'cooperative_members',
                field: 'savingsBalance',
                floor: 5000,
                amount: 10_000,
            }));
        });

        it('refuses a repayment that would breach the floor', async () => {
            setDocs(12_000); // repaying 10,000 would leave 2,000

            const r: any = await repay(10_000);

            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/minimum balance/i);
        });

        it('does not claim the key when the floor refusal is known up front', async () => {
            // No primitive releases a claimed key. If the ordinary refusal spent
            // it, a member who topped up their savings could never retry that
            // exact repayment.
            setDocs(12_000);

            await repay(10_000);

            expect(mockClaimKey).not.toHaveBeenCalled();
            expect(mockDebitFloor).not.toHaveBeenCalled();
        });

        it('allows a repayment landing exactly on the floor', async () => {
            // Boundary: the rule is "must keep 5,000", not "must keep more than".
            setDocs(15_000);

            const r: any = await repay(10_000);

            expect(r.success).toBe(true);
        });

        it('reports below_floor differently from insufficient_funds', async () => {
            // A member with a healthy balance told they have insufficient funds
            // would simply be misinformed.
            mockDebitFloor.mockResolvedValue({ ok: false, reason: 'below_floor', balance: 12_000 });

            const r: any = await repay(10_000);

            expect(String(r.error)).toMatch(/minimum balance/i);
            expect(String(r.error)).not.toMatch(/insufficient/i);
        });

        it('never offers a negative amount as available', async () => {
            // A member already under the floor. "Available: ₦-3,000" reads as a
            // debt the member does not have.
            mockDebitFloor.mockResolvedValue({ ok: false, reason: 'below_floor', balance: 2_000 });

            const r: any = await repay(1_000);

            expect(String(r.error)).toContain('₦0');
            expect(String(r.error)).not.toMatch(/₦-/);
        });
    });

    describe('ordering and idempotency', () => {
        it('claims the key BEFORE debiting', async () => {
            // The whole safety argument. Reversed, two concurrent submissions
            // both debit and only one credits: the member pays twice.
            await repay(10_000);

            expect(callOrder.indexOf('claim')).toBeGreaterThanOrEqual(0);
            expect(callOrder.indexOf('claim')).toBeLessThan(callOrder.indexOf('debit'));
        });

        it('does not debit when the key was already claimed', async () => {
            // The second of two concurrent submissions, or a double-click.
            mockClaimKey.mockResolvedValue({ claimed: false });

            const r: any = await repay(10_000);

            expect(r.success).toBe(true); // rule 3: already applied is success
            expect(mockDebitFloor).not.toHaveBeenCalled();
        });

        it('uses a reference that is stable across attempts', async () => {
            // Rule 2. A reference varying per attempt is not an idempotency key.
            await repay(10_000);
            const first = (mockClaimKey.mock.calls[0] as [any])[0].key;

            jest.clearAllMocks();
            mockClaimKey.mockResolvedValue({ claimed: true });
            mockDebitFloor.mockResolvedValue({ ok: true, balance: 40_000 });
            mockClaimPayment.mockResolvedValue({ claimed: true, status: 'loan_repayment' });
            await repay(10_000);
            const second = (mockClaimKey.mock.calls[0] as [any])[0].key;

            expect(first).toBe(second);
            expect(first).toContain('inst-1');
        });

        it('distinguishes two different amounts on the same instalment', async () => {
            // Two genuine partial payments must not collapse into one key.
            await repay(4_000);
            const a = (mockClaimKey.mock.calls[0] as [any])[0].key;

            jest.clearAllMocks();
            mockClaimKey.mockResolvedValue({ claimed: true });
            mockDebitFloor.mockResolvedValue({ ok: true, balance: 40_000 });
            mockClaimPayment.mockResolvedValue({ claimed: true, status: 'loan_repayment' });
            await repay(6_000);
            const b = (mockClaimKey.mock.calls[0] as [any])[0].key;

            expect(a).not.toBe(b);
        });

        it('records the repayment where every other repayment is recorded', async () => {
            // Not "completed" — platform_revenue_totals() sums completed rows as
            // revenue, and money repaid into a loan is not platform revenue.
            await repay(10_000);

            const [args] = mockClaimPayment.mock.calls[0] as [any];
            expect(args.type).toBe('loan_repayment');
            expect(args.status).not.toBe('completed');
            expect(args.userId).toBe(BORROWER);
        });

        it('reports a debit that succeeded without the instalment being credited', async () => {
            // The one unrecoverable ordering. It must not be reported as success,
            // and the message must carry the reference support needs.
            mockClaimPayment.mockResolvedValue({ claimed: false, status: 'loan_repayment' });
            (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
                exists: false, empty: true, docs: [], data: () => undefined,
            }));

            const r: any = await repay(10_000);

            expect(r.success).toBe(false);
        });
    });

    describe('who may spend the savings', () => {
        it('lets the borrower repay their own loan', async () => {
            const r: any = await repay(10_000, { id: BORROWER });

            expect(r.success).toBe(true);
            expect(mockDebitFloor).toHaveBeenCalledTimes(1);
        });

        it('refuses another member', async () => {
            // This action spends someone else's savings. Widening the guard to
            // "any authenticated user" would be the vendor-ownership defect with
            // a bigger blast radius.
            const r: any = await repay(10_000, { id: OTHER_MEMBER });

            expect(r.success).toBe(false);
            expect(mockDebitFloor).not.toHaveBeenCalled();
        });

        it('lets an admin repay on the borrower behalf', async () => {
            const r: any = await repay(10_000, { id: ADMIN, roles: ['admin'] });

            expect(r.success).toBe(true);
        });

        it('debits the borrower savings, never the admin own', async () => {
            await repay(10_000, { id: ADMIN, roles: ['admin'] });

            expect(mockDebitFloor).toHaveBeenCalledWith(expect.objectContaining({ id: BORROWER }));
        });

        it('refuses a non-positive amount before anything is claimed', async () => {
            const r: any = await repay(0);

            expect(r.success).toBe(false);
            expect(mockClaimKey).not.toHaveBeenCalled();
        });
    });
});
