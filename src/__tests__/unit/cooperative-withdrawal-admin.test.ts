/**
 * @jest-environment node
 */

/**
 * Admin approval and rejection of cooperative withdrawals.
 *
 * WHAT WAS WRONG
 * --------------
 * Both actions read the withdrawal status, compared it to "pending", and then
 * wrote — inside runTransaction, which takes no lock. This is the same defect
 * the wallet withdrawal state machine had, and it is worse here because the two
 * actions compete for the same field:
 *
 *   - approve + reject arriving together: both read "pending", both proceeded.
 *     The member's locked funds were released AND refunded to savings.
 *   - reject + reject: both credited savingsBalance, so the member's savings
 *     grew by twice what was ever withdrawn. Migration 010 made that reliable
 *     rather than lossy — before it one increment was silently dropped, which
 *     accidentally hid the double refund.
 *
 * The claim is what fixes it, and the claim must come BEFORE the money moves.
 * The tests below assert on that order, not on the returned message.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockClaim = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...args: any[]) => mockClaim(...args),
    claimStatusTransitionFromAny: jest.fn(),
}));

jest.mock('@/lib/email-notifications', () => ({
    sendWithdrawalApprovedEmail: jest.fn(() => Promise.resolve()),
    sendWithdrawalRejectedEmail: jest.fn(() => Promise.resolve()),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['admin'] } },
        error: null,
    }));
}

/** A withdrawal old enough to clear the 24-hour hold. */
function withdrawal(overrides: Record<string, any> = {}) {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    return {
        userId: 'member-1',
        amount: 25_000,
        status: 'pending',
        requestedAt: { toDate: () => twoDaysAgo },
        ...overrides,
    };
}

function setDocs(data: Record<string, any>) {
    const snap = { exists: true, data: () => data, docs: [] };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    // The transaction spy is stubbed too, deliberately. Without it the pre-fix
    // code throws on its first transaction.get and writes nothing, which would
    // let the "claim is lost" tests below pass against the very code they exist
    // to catch.
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

describe('rejectWithdrawalAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClaim.mockResolvedValue({ claimed: true, status: 'rejected' });
        setSession('admin-A');
        setDocs(withdrawal());
    });

    it('refunds nothing when the claim is lost', async () => {
        // THE test. Two rejections both passed the status check and both
        // credited savingsBalance — the member's savings grew by twice the
        // amount ever withdrawn.
        mockClaim.mockResolvedValue({ claimed: false, status: 'rejected' });

        const { rejectWithdrawalAction } = await import('@/app/actions/cooperative/_coop_admin_money');
        const result = await rejectWithdrawalAction('wd-1', 'Insufficient documentation');

        expect(result.success).toBe(false);
        // Both spies: the old code wrote through transaction.update, so
        // asserting only on the direct-write spy would pass against the very
        // code this test exists to catch.
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreTxUpdate).not.toHaveBeenCalled();
    });

    it('claims pending → rejected before crediting savings', async () => {
        const { rejectWithdrawalAction } = await import('@/app/actions/cooperative/_coop_admin_money');
        await rejectWithdrawalAction('wd-1', 'Insufficient documentation');

        const call = mockClaim.mock.calls[0][0] as any;
        expect(call.from).toBe('pending');
        expect(call.to).toBe('rejected');
        expect(call.patch.rejectionReason).toBe('Insufficient documentation');
    });

    it('moves the refund by increment, never by an absolute write', async () => {
        const { rejectWithdrawalAction } = await import('@/app/actions/cooperative/_coop_admin_money');
        await rejectWithdrawalAction('wd-1', 'Insufficient documentation');

        const update = (global as any).mockFirestoreUpdate.mock.calls[0][1];
        expect(update.savingsBalance).toMatchObject({
            _methodName: 'FieldValue.increment',
            _operand: 25_000,
        });
        expect(update.lockedBalance).toMatchObject({
            _methodName: 'FieldValue.increment',
            _operand: -25_000,
        });
    });
});

describe('approveWithdrawalAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockClaim.mockResolvedValue({ claimed: true, status: 'approved' });
        setSession('admin-A');
        setDocs(withdrawal());
    });

    it('releases nothing when the claim is lost', async () => {
        // An approve racing a reject: both read "pending" and both proceeded,
        // so the funds were released AND refunded.
        mockClaim.mockResolvedValue({ claimed: false, status: 'rejected' });

        const { approveWithdrawalAction } = await import('@/app/actions/cooperative/_coop_admin_money');
        const result = await approveWithdrawalAction('wd-1');

        expect(result.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreTxUpdate).not.toHaveBeenCalled();
    });

    it('claims pending → approved', async () => {
        const { approveWithdrawalAction } = await import('@/app/actions/cooperative/_coop_admin_money');
        await approveWithdrawalAction('wd-1');

        const call = mockClaim.mock.calls[0][0] as any;
        expect(call.from).toBe('pending');
        expect(call.to).toBe('approved');
    });

    it('still enforces the 24-hour hold, and does not claim when it fails', async () => {
        // The hold is policy, and must stop the transition rather than be
        // undone after it.
        setDocs(withdrawal({ requestedAt: { toDate: () => new Date() } }));

        const { approveWithdrawalAction } = await import('@/app/actions/cooperative/_coop_admin_money');
        const result = await approveWithdrawalAction('wd-1');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/24-hour/i);
        expect(mockClaim).not.toHaveBeenCalled();
    });
});
