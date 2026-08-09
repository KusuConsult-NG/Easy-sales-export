/**
 * @jest-environment node
 */

/**
 * Dual control on high-value loan approval.
 *
 * WHAT WAS WRONG
 * --------------
 * Two defects, and the first is the one that moved money.
 *
 * 1. The maker's own approval disbursed the loan. The maker branch returned
 *    `makerApproval: true` and nothing checked it before the Paystack payout —
 *    the `return` that should have stopped there was missing. One admin
 *    approving a ≥₦1,000,000 loan paid it out alone, and the status then became
 *    "disbursed", so the second approver's attempt returned "already
 *    processed". Dual control never happened and the threshold was decorative.
 *
 * 2. `if (!approvalChain.firstApprover)` and the self-approval check ran inside
 *    runTransaction, which takes no lock. Two admins approving together both
 *    read an empty chain; two checkers both passed and both reached the payout.
 *
 * The first test below is the one that matters: a first approval must not pay
 * anybody. It is asserted on the payout itself rather than on the returned
 * message, because a reassuring message with a completed transfer behind it is
 * exactly what shipped.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Typed loosely on purpose: jest.fn() from @jest/globals infers its resolved
// type as `never`, so mockResolvedValue would not compile.
const mockClaimFromAny = jest.fn() as jest.Mock<any>;
const mockPaystackPayout = jest.fn() as jest.Mock<any>;
const mockAuditLog = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: (...args: any[]) => mockClaimFromAny(...args),
}));

jest.mock('@/lib/paystack-transfer', () => ({
    paystackPayout: (...args: any[]) => mockPaystackPayout(...args),
}));

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (...args: any[]) => mockAuditLog(...args),
    logAdminAction: jest.fn(),
}));

const HIGH_VALUE = 2_000_000;
const LOW_VALUE = 50_000;

/** A loan application as the pre-checks would have read it. */
function loan(overrides: Record<string, any> = {}) {
    return {
        userId: 'borrower-1',
        userEmail: 'borrower@example.com',
        amount: HIGH_VALUE,
        contributionAmount: HIGH_VALUE, // keeps the tier check happy
        durationMonths: 6,
        interestRate: 10,
        monthlyPayment: 100_000,
        totalRepayment: 600_000,
        status: 'pending',
        ...overrides,
    };
}

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['super_admin'] } },
        error: null,
    }));
}

/** No other loans exist, so the double-lending check passes. */
function setLoanReads(data: Record<string, any>) {
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true,
        data: () => data,
        docs: [],
    }));
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true,
        data: () => ({ bankAccountNumber: '0123456789', bankCode: '058', name: 'Borrower' }),
        docs: [],
    }));
}

describe('high-value loan approval', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'partially_approved' });
        mockPaystackPayout.mockResolvedValue({ success: true, transferCode: 'TRF_1' });
    });

    it('does not disburse on the first approval', async () => {
        // THE test. This is what was broken: one admin's approval paid the loan.
        setSession('admin-A');
        setLoanReads(loan());

        const { approveLoanApplication } = await import('@/app/actions/admin');
        const result = await approveLoanApplication('loan-1');

        expect(mockPaystackPayout).not.toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it('claims the transition rather than checking then writing', async () => {
        // Two admins approving together both read an empty chain. Only a claim
        // stops both becoming the maker.
        setSession('admin-A');
        setLoanReads(loan());

        const { approveLoanApplication } = await import('@/app/actions/admin');
        await approveLoanApplication('loan-1');

        expect(mockClaimFromAny).toHaveBeenCalledTimes(1);
        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['pending', 'reviewing']);
        expect(call.to).toBe('partially_approved');
        expect(call.patch.approvalChain.firstApprover).toBe('admin-A');
    });

    it('reports the loss rather than disbursing when the claim is lost', async () => {
        // Another admin got there first.
        setSession('admin-B');
        setLoanReads(loan());
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'partially_approved' });

        const { approveLoanApplication } = await import('@/app/actions/admin');
        const result = await approveLoanApplication('loan-1');

        expect(result.success).toBe(false);
        expect(mockPaystackPayout).not.toHaveBeenCalled();
    });

    it('refuses to let the first approver also be the second', async () => {
        setSession('admin-A');
        setLoanReads(loan({
            status: 'partially_approved',
            approvalChain: { firstApprover: 'admin-A', firstApproverName: 'admin-A' },
        }));

        const { approveLoanApplication } = await import('@/app/actions/admin');
        const result = await approveLoanApplication('loan-1');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/cannot verify your own approval/i);
        expect(mockPaystackPayout).not.toHaveBeenCalled();
        expect(mockClaimFromAny).not.toHaveBeenCalled();
    });

    it('disburses only on a genuine second approval', async () => {
        setSession('admin-B');
        setLoanReads(loan({
            status: 'partially_approved',
            approvalChain: { firstApprover: 'admin-A', firstApproverName: 'admin-A' },
        }));
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'approved' });

        const { approveLoanApplication } = await import('@/app/actions/admin');
        await approveLoanApplication('loan-1');

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['partially_approved']);
        expect(call.to).toBe('approved');
        expect(mockPaystackPayout).toHaveBeenCalledTimes(1);
    });

    it('keeps the maker on the record when the checker approves', async () => {
        // The CAS patch shallow-merges, so writing only secondApprover would
        // drop firstApprover and erase who made the first approval.
        setSession('admin-B');
        setLoanReads(loan({
            status: 'partially_approved',
            approvalChain: { firstApprover: 'admin-A', firstApproverName: 'admin-A' },
        }));
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'approved' });

        const { approveLoanApplication } = await import('@/app/actions/admin');
        await approveLoanApplication('loan-1');

        const chain = (mockClaimFromAny.mock.calls[0][0] as any).patch.approvalChain;
        expect(chain.firstApprover).toBe('admin-A');
        expect(chain.secondApprover).toBe('admin-B');
    });

    it('does not disburse when a second approver loses the claim', async () => {
        // Two checkers approving together both passed the self-approval check
        // and BOTH reached the payout.
        setSession('admin-C');
        setLoanReads(loan({
            status: 'partially_approved',
            approvalChain: { firstApprover: 'admin-A' },
        }));
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'approved' });

        const { approveLoanApplication } = await import('@/app/actions/admin');
        const result = await approveLoanApplication('loan-1');

        expect(result.success).toBe(false);
        expect(mockPaystackPayout).not.toHaveBeenCalled();
    });
});

describe('low-value loan approval', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPaystackPayout.mockResolvedValue({ success: true, transferCode: 'TRF_1' });
    });

    it('needs no second approver but still claims the transition', async () => {
        // Below the threshold one approval is enough — but two admins clicking
        // together must still not disburse twice.
        setSession('admin-A');
        setLoanReads(loan({ amount: LOW_VALUE, contributionAmount: LOW_VALUE }));
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'approved' });

        const { approveLoanApplication } = await import('@/app/actions/admin');
        await approveLoanApplication('loan-1');

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['pending', 'reviewing']);
        expect(call.to).toBe('approved');
        expect(mockPaystackPayout).toHaveBeenCalledTimes(1);
    });

    it('does not disburse when the claim is lost', async () => {
        setSession('admin-B');
        setLoanReads(loan({ amount: LOW_VALUE, contributionAmount: LOW_VALUE }));
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'approved' });

        const { approveLoanApplication } = await import('@/app/actions/admin');
        const result = await approveLoanApplication('loan-1');

        expect(result.success).toBe(false);
        expect(mockPaystackPayout).not.toHaveBeenCalled();
    });
});
