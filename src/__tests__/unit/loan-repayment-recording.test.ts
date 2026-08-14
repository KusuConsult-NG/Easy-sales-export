/**
 * @jest-environment node
 */

/**
 * Recording a loan repayment that arrived as a bank transfer.
 *
 * WHAT WAS WRONG
 * --------------
 * Repayments are collected by bank transfer and reconciled by hand.
 * `submitRepaymentAction` was built for exactly that — it claims the bank
 * reference through claimPaymentOnce, so recording the same transfer twice is a
 * no-op rather than crediting the borrower twice.
 *
 * It had no caller, and its authorisation was:
 *
 *     if (!session?.user?.id || session.user.id !== data.userId)
 *
 * self-only. So the admin doing the reconciling could not reach it. The action
 * was hardened and unreachable at the same time, which is the same shape as the
 * fixed-savings debit and the delivery-confirmation claim: the work was done on
 * a path nobody could take.
 *
 * The guard is now self-OR-admin, matching _getRepaymentScheduleAction directly
 * above it and the rest of the file. The borrower check is KEPT rather than
 * replaced — a member must still not be able to record a repayment against
 * somebody else's loan.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BORROWER = 'member-1';
const OTHER_MEMBER = 'member-2';
const ADMIN = 'admin-1';

const mockClaimPayment = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaimPayment(...a),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
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

/** An unpaid instalment due in the future, on a loan owned by BORROWER. */
function setDocs() {
    const snap = {
        exists: true,
        empty: false,
        docs: [],
        data: () => ({
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

async function record(caller: { id: string; roles?: string[] }) {
    setSession(caller.id, caller.roles ?? []);
    const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
    return submitRepaymentAction({
        loanId: 'loan-1',
        installmentId: 'inst-1',
        userId: BORROWER,
        amount: 10_000,
        paymentReference: 'FT26081012345678',
    });
}

describe('submitRepaymentAction — who may record a repayment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setDocs();
        mockClaimPayment.mockResolvedValue({ claimed: true, status: 'loan_repayment' });
    });

    it('lets an admin record a repayment on the borrower behalf', async () => {
        // THE test. This is what the admin UI needs, and it was refused before.
        const r: any = await record({ id: ADMIN, roles: ['admin'] });

        expect(r.success).toBe(true);
        expect(mockClaimPayment).toHaveBeenCalledTimes(1);
    });

    it('still lets the borrower record their own', async () => {
        const r: any = await record({ id: BORROWER });

        expect(r.success).toBe(true);
    });

    it('still refuses another member', async () => {
        // The borrower check is kept, not replaced. Widening it to "any
        // authenticated user" would have been the vendor-ownership defect again.
        const r: any = await record({ id: OTHER_MEMBER });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('claims the bank reference, keyed on the borrower', async () => {
        // The reference is the idempotency key and the row belongs to whoever
        // owes the money — not to the admin who typed it in.
        await record({ id: ADMIN, roles: ['admin'] });

        const [args] = mockClaimPayment.mock.calls[0] as [any];
        expect(args.reference).toBe('FT26081012345678');
        expect(args.userId).toBe(BORROWER);
        expect(args.type).toBe('loan_repayment');
    });

    it('does not record a repayment as revenue', async () => {
        // platform_revenue_totals() sums processed_payments rows with status
        // "completed". Whether repayments count as revenue is a real question
        // and not one this path gets to answer silently.
        await record({ id: ADMIN, roles: ['admin'] });

        const [args] = mockClaimPayment.mock.calls[0] as [any];
        expect(args.status).toBe('loan_repayment');
        expect(args.status).not.toBe('completed');
    });

    it('treats a re-recorded transfer as success without crediting again', async () => {
        // The failure mode of a manual process is entering the same transfer
        // twice. A lost claim means the money already moved — a success, per
        // rule 3 in wallet-ledger.ts, not an error the admin should retry.
        mockClaimPayment.mockResolvedValue({ claimed: false, status: 'loan_repayment' });

        const r: any = await record({ id: ADMIN, roles: ['admin'] });

        expect(r.success).toBe(true);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('refuses a non-positive amount', async () => {
        setSession(ADMIN, ['admin']);
        const { submitRepaymentAction } = await import('@/app/actions/cooperative/_loans_repayments');
        const r: any = await submitRepaymentAction({
            loanId: 'loan-1', installmentId: 'inst-1', userId: BORROWER,
            amount: 0, paymentReference: 'FT-X',
        });

        expect(r.success).toBe(false);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });
});
