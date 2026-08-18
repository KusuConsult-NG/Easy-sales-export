/**
 * @jest-environment node
 */

/**
 * The check-then-writes the priority list could not see.
 *
 * HOW THESE WERE FOUND
 * --------------------
 * The migration's priority list was built by grepping files for money
 * VOCABULARY — increment(, balance, amount, payout, escrow. That finds files
 * that talk about money. It does not find a status field that some other module
 * pays against, and it does not find a lost update written as plain arithmetic.
 *
 * Two targeted sweeps found four more:
 *
 *   1. absolute writes:  `field: someCurrentValue + n` inside an update
 *   2. status guards:    a `.status !== "x"` compare followed by a write of
 *                        that same status, with no claim in between
 *
 * THE FOUR
 * --------
 * api/admin/cooperative/approve-loan  a FOURTH door onto status "approved" in
 *   LOAN_APPLICATIONS, guarded by isAdmin() alone — no maker-checker, while the
 *   other three require two admins above the threshold. It also incremented
 *   loanBalance off the unguarded check, so two approvals recorded the member
 *   as owing twice what they borrowed.
 *
 * marketplace/_buyer.ts  cancelling an order restocked with an ABSOLUTE write,
 *   which does not merely double on a concurrent cancel — it erases any other
 *   write to availableQuantity in between, including a concurrent purchase's
 *   decrement. The shop then thinks it holds more stock than it does.
 *
 * api/admin/cooperative/mark-withdrawal-completed  no wrapper at all, which is
 *   why the runTransaction sweep never saw it. Two admins completing one payout
 *   both wrote, and the second overwrote the first's transactionReference — the
 *   reference for a real bank transfer.
 *
 * farm-nation-admin  escrow release transferred a property and queued a payout
 *   off an unguarded check.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockClaim = jest.fn() as jest.Mock<any>;
const mockClaimFromAny = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...args: any[]) => mockClaim(...args),
    claimStatusTransitionFromAny: (...args: any[]) => mockClaimFromAny(...args),
}));

function setSession(id: string, roles: string[] = ['admin', 'super_admin']) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles } },
        error: null,
    }));
}

function setDocs(data: Record<string, any>) {
    const snap = {
        exists: true,
        data: () => data,
        docs: [{ id: 'doc-1', data: () => data, ref: { update: jest.fn(), set: jest.fn() } }],
        empty: false,
        id: 'doc-1',
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

const HIGH_VALUE = 2_000_000;
const LOW_VALUE = 50_000;

describe('approve-loan API route — the fourth door', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('admin-A');
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'partially_approved' });
        setDocs({ userId: 'member-1', amount: HIGH_VALUE, status: 'pending', guarantorVerified: true });
    });

    async function post(body: any) {
        const { POST } = await import('@/app/api/admin/cooperative/approve-loan/route');
        return POST({ json: async () => body } as any);
    }

    it('does not approve a high-value loan on one admin signature', async () => {
        // THE test. This route had no maker-checker at all, while the same
        // status on the same collection required two admins everywhere else.
        const res: any = await post({ applicationId: 'loan-1' });
        const body = await res.json();

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.to).toBe('partially_approved');
        expect(call.to).not.toBe('approved');
        expect(body.success).toBe(true);
    });

    it('does not touch loanBalance on a first approval', async () => {
        await post({ applicationId: 'loan-1' });
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('refuses to let the first approver also be the second', async () => {
        setDocs({
            userId: 'member-1', amount: HIGH_VALUE, status: 'partially_approved',
            guarantorVerified: true,
            approvalChain: { firstApprover: 'admin-A' },
        });

        const res: any = await post({ applicationId: 'loan-1' });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(body.message).toMatch(/cannot verify your own approval/i);
        expect(mockClaimFromAny).not.toHaveBeenCalled();
    });

    it('does not double the member loan balance when the claim is lost', async () => {
        setDocs({ userId: 'member-1', amount: LOW_VALUE, status: 'pending', guarantorVerified: true });
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'approved' });

        const res: any = await post({ applicationId: 'loan-1' });
        const body = await res.json();

        expect(body.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('increments loanBalance once on a genuine low-value approval', async () => {
        setDocs({ userId: 'member-1', amount: LOW_VALUE, status: 'pending', guarantorVerified: true });
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'approved' });

        await post({ applicationId: 'loan-1' });

        const update = (global as any).mockFirestoreUpdate.mock.calls[0][1];
        expect(update.loanBalance).toMatchObject({
            _methodName: 'FieldValue.increment',
            _operand: LOW_VALUE,
        });
    });
});

describe('cancelOrderAction — the restock that erased other writes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('buyer-1', ['user']);
        mockClaim.mockResolvedValue({ claimed: true, status: 'cancelled' });
        setDocs({
            buyerId: 'buyer-1',
            status: 'pending_payment',
            items: [{ productId: 'prod-a', quantity: 3, sellerId: 'seller-1' }],
        });
    });

    it('restocks by increment, never by a computed total', async () => {
        // THE test. `currentQty + item.quantity` erases a concurrent
        // purchase's decrement, so the shop oversells afterwards.
        const { cancelOrderAction } = await import('@/app/actions/marketplace/_buyer');
        await cancelOrderAction('order-1');

        const updates = (global as any).mockFirestoreUpdate.mock.calls.map((c: any) => c[1]);
        const restock = updates.find((u: any) => u.availableQuantity !== undefined);
        expect(restock.availableQuantity).toMatchObject({
            _methodName: 'FieldValue.increment',
            _operand: 3,
        });
    });

    it('restocks nothing when the cancellation claim is lost', async () => {
        mockClaim.mockResolvedValue({ claimed: false, status: 'cancelled' });

        const { cancelOrderAction } = await import('@/app/actions/marketplace/_buyer');
        const result = await cancelOrderAction('order-1');

        expect(result.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });
});

describe('mark-withdrawal-completed route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('admin-A');
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'completed' });
        setDocs({ userId: 'member-1', status: 'approved_pending_payout' });
    });

    it('claims the completion rather than checking then writing', async () => {
        // No wrapper here at all, which is why the runTransaction sweep never
        // found it. Two admins both wrote, and the second overwrote the first's
        // bank transfer reference.
        const { PATCH } = await import('@/app/api/admin/cooperative/mark-withdrawal-completed/route');
        await PATCH({ json: async () => ({ withdrawalId: 'wd-1', transactionReference: 'TRF-1' }) } as any);

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.to).toBe('completed');
        expect(call.patch.transactionReference).toBe('TRF-1');
    });

    it('and accepts BOTH states an approval can leave it in', async () => {
        // It accepted only "approved_pending_payout" — the state
        // admin/_withdrawals.ts writes when its Paystack transfer FAILS.
        // cooperative/_coop_admin_money.ts approveWithdrawalAction, the screen
        // built for cooperative withdrawals, leaves them at "approved", and
        // nothing transitioned that anywhere. So a withdrawal approved there sat
        // at "approved" for ever, and the member's own history — which sums
        // `status === "completed"` — reported ₦0 withdrawn however much had been
        // paid to them.
        //
        // The WAVE equivalent already claims fromAny the same pair.
        const { PATCH } = await import('@/app/api/admin/cooperative/mark-withdrawal-completed/route');
        await PATCH({ json: async () => ({ withdrawalId: 'wd-1' }) } as any);

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['approved_pending_payout', 'approved']);
    });

    it('which is the state the cooperative approval really leaves', async () => {
        // Vacuity guard, read off the source: if approveWithdrawalAction wrote
        // "approved_pending_payout" there would have been nothing to fix.
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const src = readFileSync(
            join(process.cwd(), 'src/app/actions/cooperative/_coop_admin_money.ts'),
            'utf-8',
        );

        expect(src).toContain('from: "pending",');
        expect(src).toContain('to: "approved",');
        expect(src).not.toContain('to: "approved_pending_payout"');
    });

    it('reports a conflict when another admin already completed it', async () => {
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'completed' });

        const { PATCH } = await import('@/app/api/admin/cooperative/mark-withdrawal-completed/route');
        const res: any = await PATCH({ json: async () => ({ withdrawalId: 'wd-1' }) } as any);
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(res.status).toBe(409);
    });
});
