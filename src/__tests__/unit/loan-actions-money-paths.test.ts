/**
 * @jest-environment node
 */

/**
 * The money paths in src/app/actions/loan-actions.ts.
 *
 * WHAT WAS WRONG
 * --------------
 * 1. DUAL CONTROL DID NOT APPLY HERE AT ALL.
 *    Three actions approve a loan by writing `status: "approved"` to
 *    LOAN_APPLICATIONS. Two of them — admin.ts and cooperative/_loans.ts —
 *    require a second admin above ₦1,000,000. This one, reached from
 *    /loans/approve, required only `roles.includes('admin')`, so a single
 *    admin could approve a loan of any size through it. A control present in
 *    two doors of three is not a control.
 *
 * 2. Every state change was a check-then-write inside runTransaction, which
 *    takes no lock:
 *      - approval read "pending" and wrote "approved"
 *      - disbursement read "approved", wrote "disbursed" and CREDITED THE
 *        WALLET, so two disbursements arriving together paid the borrower twice
 *      - repayment read the wallet balance, checked sufficiency and debited, so
 *        two repayments together took the wallet negative
 *
 * The first test in each block is the one that matters; it asserts on the money
 * or on the claim, never on a returned message, because a reassuring message
 * over a double payment is exactly what shipped.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Typed loosely on purpose: jest.fn() from @jest/globals infers its resolved
// type as `never`, so mockResolvedValue would not compile.
const mockClaimFromAny = jest.fn() as jest.Mock<any>;
const mockCreditWalletOnce = jest.fn() as jest.Mock<any>;
const mockDebitWalletLocked = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: (...args: any[]) => mockClaimFromAny(...args),
}));

jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: (...args: any[]) => mockCreditWalletOnce(...args),
    debitWalletLocked: (...args: any[]) => mockDebitWalletLocked(...args),
}));

const HIGH_VALUE = 2_000_000;
const LOW_VALUE = 50_000;

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['admin'] } },
        error: null,
    }));
}

/** The loan application as loanRef.get() returns it. */
function setLoan(data: Record<string, any>) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true,
        data: () => data,
        docs: [],
    }));
}

function loan(overrides: Record<string, any> = {}) {
    return {
        userId: 'borrower-1',
        amount: HIGH_VALUE,
        status: 'pending',
        ...overrides,
    };
}

describe('approveLoanApplication — dual control', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'partially_approved' });
    });

    it('does not approve a high-value loan on one admin signature', async () => {
        // THE test. Before this change /loans/approve wrote "approved" here on
        // a single admin's click, whatever the amount.
        setSession('admin-A');
        setLoan(loan());

        const { approveLoanApplication } = await import('@/app/actions/loan-actions');
        await approveLoanApplication({ loanId: 'loan-1', approved: true });

        expect(mockClaimFromAny).toHaveBeenCalledTimes(1);
        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.to).toBe('partially_approved');
        expect(call.to).not.toBe('approved');
        expect(call.patch.approvalChain.firstApprover).toBe('admin-A');
    });

    it('refuses to let the first approver also be the second', async () => {
        setSession('admin-A');
        setLoan(loan({
            status: 'partially_approved',
            approvalChain: { firstApprover: 'admin-A', firstApproverName: 'admin-A' },
        }));

        const { approveLoanApplication } = await import('@/app/actions/loan-actions');
        const result = await approveLoanApplication({ loanId: 'loan-1', approved: true });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/cannot verify your own approval/i);
        expect(mockClaimFromAny).not.toHaveBeenCalled();
    });

    it('approves on a genuine second signature, keeping the maker on record', async () => {
        // The CAS patch shallow-merges, so writing only secondApprover would
        // erase who made the first approval.
        setSession('admin-B');
        setLoan(loan({
            status: 'partially_approved',
            approvalChain: { firstApprover: 'admin-A', firstApproverName: 'admin-A' },
        }));
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'approved' });

        const { approveLoanApplication } = await import('@/app/actions/loan-actions');
        await approveLoanApplication({ loanId: 'loan-1', approved: true });

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['partially_approved']);
        expect(call.to).toBe('approved');
        expect(call.patch.approvalChain.firstApprover).toBe('admin-A');
        expect(call.patch.approvalChain.secondApprover).toBe('admin-B');
    });

    it('claims the transition for a low-value loan rather than checking then writing', async () => {
        setSession('admin-A');
        setLoan(loan({ amount: LOW_VALUE }));
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'approved' });

        const { approveLoanApplication } = await import('@/app/actions/loan-actions');
        await approveLoanApplication({ loanId: 'loan-1', approved: true });

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['pending', 'reviewing']);
        expect(call.to).toBe('approved');
    });

    it('reports the loss when another admin won the claim', async () => {
        setSession('admin-B');
        setLoan(loan({ amount: LOW_VALUE }));
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'approved' });

        const { approveLoanApplication } = await import('@/app/actions/loan-actions');
        const result = await approveLoanApplication({ loanId: 'loan-1', approved: true });

        expect(result.success).toBe(false);
    });

    it('claims the rejection too', async () => {
        setSession('admin-A');
        setLoan(loan());
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'rejected' });

        const { approveLoanApplication } = await import('@/app/actions/loan-actions');
        await approveLoanApplication({ loanId: 'loan-1', approved: false, rejectionReason: 'No' });

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.to).toBe('rejected');
        expect(call.patch.rejectionReason).toBe('No');
    });
});

describe('disburseLoan', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'disbursed' });
        mockCreditWalletOnce.mockResolvedValue({ claimed: true, balance: HIGH_VALUE });
    });

    it('does not credit the wallet when the disbursement claim is lost', async () => {
        // THE test. Two admins disbursing together both read "approved" and
        // both credited: the borrower was paid twice.
        setSession('admin-A');
        setLoan(loan({ status: 'approved' }));
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'disbursed' });

        const { disburseLoan } = await import('@/app/actions/loan-actions');
        const result = await disburseLoan('loan-1');

        expect(mockCreditWalletOnce).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
    });

    it('claims approved → disbursed before crediting', async () => {
        setSession('admin-A');
        setLoan(loan({ status: 'approved' }));

        const { disburseLoan } = await import('@/app/actions/loan-actions');
        await disburseLoan('loan-1');

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['approved']);
        expect(call.to).toBe('disbursed');
        expect(mockCreditWalletOnce).toHaveBeenCalledTimes(1);
    });

    it('keys the credit on the loan id so a retry cannot pay twice', async () => {
        setSession('admin-A');
        setLoan(loan({ status: 'approved' }));

        const { disburseLoan } = await import('@/app/actions/loan-actions');
        await disburseLoan('loan-1');

        const credit = mockCreditWalletOnce.mock.calls[0][0] as any;
        expect(credit.reference).toBe('LOAN-DISB-loan-1');
        expect(credit.userId).toBe('borrower-1');
        expect(credit.amount).toBe(HIGH_VALUE);
    });

    it('does not record the disbursement as revenue', async () => {
        // platform_revenue_totals() sums processed_payments rows whose status is
        // "completed". Money paid OUT to a borrower is not income, and recording
        // it as completed would inflate revenue by every loan disbursed.
        setSession('admin-A');
        setLoan(loan({ status: 'approved' }));

        const { disburseLoan } = await import('@/app/actions/loan-actions');
        await disburseLoan('loan-1');

        const credit = mockCreditWalletOnce.mock.calls[0][0] as any;
        expect(credit.status).toBe('disbursement');
        expect(credit.status).not.toBe('completed');
    });
});

describe('processLoanRepaymentAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDebitWalletLocked.mockResolvedValue({ ok: true, balance: 0, reason: null });
    });

    it('debits under a row lock instead of reading the balance and writing it back', async () => {
        // THE test. Two repayments together both passed the sufficiency check
        // and both debited, taking the wallet negative.
        setSession('borrower-1');
        setLoan(loan({ status: 'disbursed', amount: 100_000, repaidAmount: 0 }));

        const { processLoanRepaymentAction } = await import('@/app/actions/loan-actions');
        await processLoanRepaymentAction('loan-1', 40_000);

        expect(mockDebitWalletLocked).toHaveBeenCalledWith({ userId: 'borrower-1', amount: 40_000 });
    });

    it('leaves the loan untouched when funds are short', async () => {
        setSession('borrower-1');
        setLoan(loan({ status: 'disbursed', amount: 100_000, repaidAmount: 0 }));
        mockDebitWalletLocked.mockResolvedValue({ ok: false, balance: 10, reason: 'insufficient_funds' });

        const { processLoanRepaymentAction } = await import('@/app/actions/loan-actions');
        const result = await processLoanRepaymentAction('loan-1', 40_000);

        expect(result.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('refuses a repayment against somebody else\'s loan before any money moves', async () => {
        setSession('not-the-borrower');
        setLoan(loan({ status: 'disbursed', amount: 100_000 }));

        const { processLoanRepaymentAction } = await import('@/app/actions/loan-actions');
        const result = await processLoanRepaymentAction('loan-1', 40_000);

        expect(result.success).toBe(false);
        expect(mockDebitWalletLocked).not.toHaveBeenCalled();
    });

    it('marks the loan repaid once instalments reach the total', async () => {
        // The old check compared this single payment to the loan total, so a
        // loan settled in two halves stayed DISBURSED for ever even though
        // repaidAmount had reached the full amount.
        setSession('borrower-1');
        setLoan(loan({ status: 'disbursed', amount: 100_000, repaidAmount: 60_000 }));

        const { processLoanRepaymentAction } = await import('@/app/actions/loan-actions');
        await processLoanRepaymentAction('loan-1', 40_000);

        const update = (global as any).mockFirestoreUpdate.mock.calls[0][1];
        expect(update.status).toBe('repaid');
    });

    it('leaves a partly repaid loan disbursed', async () => {
        setSession('borrower-1');
        setLoan(loan({ status: 'disbursed', amount: 100_000, repaidAmount: 10_000 }));

        const { processLoanRepaymentAction } = await import('@/app/actions/loan-actions');
        await processLoanRepaymentAction('loan-1', 40_000);

        const update = (global as any).mockFirestoreUpdate.mock.calls[0][1];
        expect(update.status).toBe('disbursed');
        expect(update.repaidAt).toBeUndefined();
    });
});
