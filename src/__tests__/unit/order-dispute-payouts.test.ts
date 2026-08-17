/**
 * @jest-environment node
 */

/**
 * Order completion and dispute resolution — both paid twice.
 *
 * WHAT WAS WRONG
 * --------------
 * _confirmDeliveryAction checked `status !== "delivered"` and threw, then wrote
 * "completed" — inside runTransaction, which takes no lock. Everything the
 * function does hangs off that check, and the last of those things is a
 * PAYSTACK TRANSFER to the seller, made after the block returns. A buyer
 * double-clicking Confirm Delivery had both calls read "delivered" and both
 * proceed: the seller was paid twice out of the business's money, credited
 * twice in WAVE earnings, and given two wallet_transactions rows.
 *
 * updateDisputeStatusAction read the dispute status and the escrow status and
 * credited a wallet off the back of both. Two admins resolving one dispute
 * together both passed and both credited the beneficiary.
 *
 * _updateOrderStatusAction's cancellation branch put stock BACK behind
 * `currentOrder.status !== "cancelled"`, so two cancellations restocked twice —
 * inventory conjured out of a double click.
 *
 * _createDisputeAction allowed two disputes on one order for the same reason.
 *
 * Every test below asserts on the money or on the claim, never on a message.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ESCROW_RELEASABLE_FROM, ESCROW_REFUNDABLE_FROM } from '@/lib/escrow-status';

const mockClaim = jest.fn() as jest.Mock<any>;
const mockClaimFromAny = jest.fn() as jest.Mock<any>;
const mockCreditWalletOnce = jest.fn() as jest.Mock<any>;
const mockPaystackPayout = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...args: any[]) => mockClaim(...args),
    claimStatusTransitionFromAny: (...args: any[]) => mockClaimFromAny(...args),
}));

jest.mock('@/lib/wallet-ledger', () => ({
    creditWalletOnce: (...args: any[]) => mockCreditWalletOnce(...args),
}));

jest.mock('@/lib/paystack-transfer', () => ({
    paystackPayout: (...args: any[]) => mockPaystackPayout(...args),
}));

function setSession(id: string, roles: string[] = ['user']) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles } },
        error: null,
    }));
}

function setDocs(data: Record<string, any>) {
    const snap = { exists: true, data: () => data, docs: [{ id: 'doc-1', data: () => data, ref: { update: jest.fn() } }], empty: false, id: 'doc-1' };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

describe('_confirmDeliveryAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('buyer-1');
        mockClaim.mockResolvedValue({ claimed: true, status: 'completed' });
        mockPaystackPayout.mockResolvedValue({ success: true, transferCode: 'TRF_1' });
        setDocs({
            buyerId: 'buyer-1',
            sellerId: 'seller-1',
            status: 'delivered',
            totalAmount: 100_000,
            bankAccountNumber: '0123456789',
            bankCode: '058',
            roles: [],
        });
    });

    it('does not pay the seller when the confirmation claim is lost', async () => {
        // THE test. This is the double payout: two clicks both read
        // "delivered" and both reached the Paystack transfer.
        mockClaim.mockResolvedValue({ claimed: false, status: 'completed' });

        const { confirmDeliveryAction } = await import('@/app/actions/order-management');
        const result = await confirmDeliveryAction('order-1');

        expect(mockPaystackPayout).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
    });

    it('claims delivered → completed before doing anything else', async () => {
        const { confirmDeliveryAction } = await import('@/app/actions/order-management');
        await confirmDeliveryAction('order-1');

        expect(mockClaim).toHaveBeenCalledTimes(1);
        const call = mockClaim.mock.calls[0][0] as any;
        expect(call.from).toBe('delivered');
        expect(call.to).toBe('completed');
    });

    it('refuses a confirmation from somebody who is not the buyer, without claiming', async () => {
        setSession('not-the-buyer');

        const { confirmDeliveryAction } = await import('@/app/actions/order-management');
        const result = await confirmDeliveryAction('order-1');

        expect(result.success).toBe(false);
        expect(mockClaim).not.toHaveBeenCalled();
        expect(mockPaystackPayout).not.toHaveBeenCalled();
    });
});

describe('_updateOrderStatusAction — cancellation restock', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('seller-1', ['admin']);
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'cancelled' });
        setDocs({
            sellerId: 'seller-1',
            status: 'processing',
            items: [{ productId: 'prod-a', quantity: 4 }],
        });
    });

    it('restocks nothing when the cancellation claim is lost', async () => {
        // Two cancellations both restocked, so availableQuantity gained the
        // order's quantity twice.
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'cancelled' });

        const { updateOrderStatusAction } = await import('@/app/actions/order-management');
        const result = await updateOrderStatusAction('order-1', 'cancelled');

        expect(result.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('never claims from "cancelled", so a cancelled order cannot restock again', async () => {
        const { updateOrderStatusAction } = await import('@/app/actions/order-management');
        await updateOrderStatusAction('order-1', 'cancelled');

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.to).toBe('cancelled');
        expect(call.fromAny).not.toContain('cancelled');
    });

    it('leaves non-cancel transitions alone', async () => {
        const { updateOrderStatusAction } = await import('@/app/actions/order-management');
        await updateOrderStatusAction('order-1', 'shipped');

        expect(mockClaimFromAny).not.toHaveBeenCalled();
        expect((global as any).mockFirestoreUpdate).toHaveBeenCalled();
    });
});

describe('updateDisputeStatusAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('admin-A', ['admin']);
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'released' });
        mockCreditWalletOnce.mockResolvedValue({ claimed: true, balance: 80_000 });
        setDocs({
            status: 'disputed',
            buyerId: 'buyer-1',
            sellerId: 'seller-1',
            orderId: 'order-1',
            amount: 50_000,
            // The action re-reads the caller's roles from the USERS doc rather
            // than trusting the session, so the fixture has to carry them.
            roles: ['admin'],
        });
    });

    it('credits nobody when the escrow claim is lost', async () => {
        // Two admins resolving together both read "disputed" and both credited.
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'released' });

        const { updateDisputeStatusAction } = await import('@/app/actions/disputes');
        const result = await updateDisputeStatusAction('dsp-1', 'release_seller' as any, 'ok');

        expect(mockCreditWalletOnce).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
    });

    it('claims the ESCROW transition, which is what the money hangs off', async () => {
        const { updateDisputeStatusAction } = await import('@/app/actions/disputes');
        await updateDisputeStatusAction('dsp-1', 'release_seller' as any, 'ok');

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual([...ESCROW_RELEASABLE_FROM]);
        expect(call.to).toBe('released');
    });

    it('and NEVER from an unfunded escrow', async () => {
        // The set used to be ['funded', 'disputed', 'pending'], and this test
        // pinned it verbatim. "pending" means no payment ever reached the
        // platform, while both branches below credit a wallet with the escrow's
        // `amount` — which is written at creation regardless. So a dispute on a
        // never-funded escrow paid out real money, and this assertion locked
        // that in rather than catching it.
        expect(ESCROW_RELEASABLE_FROM).not.toContain('pending');
        expect(ESCROW_REFUNDABLE_FROM).not.toContain('pending');
    });

    it('and can resolve a dispute on a delivered order', async () => {
        // The old set omitted "delivered" and "in_transit". Confirming receipt is
        // what writes "delivered", so the admin could not resolve a dispute on
        // precisely the orders disputes are usually about.
        expect(ESCROW_RELEASABLE_FROM).toContain('delivered');
        expect(ESCROW_REFUNDABLE_FROM).toContain('delivered');
    });

    it('a refund uses the refundable set, not the releasable one', async () => {
        // Two different questions. They happen to have the same members today;
        // asserting the refund path reads the refund set is what keeps them from
        // silently sharing a definition if one changes.
        mockClaimFromAny.mockClear();
        const { updateDisputeStatusAction } = await import('@/app/actions/disputes');
        await updateDisputeStatusAction('dsp-1', 'refund_buyer' as any, 'ok');

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual([...ESCROW_REFUNDABLE_FROM]);
        expect(call.to).toBe('refunded');
    });

    it('keys the credit on the dispute so a retry cannot pay twice', async () => {
        const { updateDisputeStatusAction } = await import('@/app/actions/disputes');
        await updateDisputeStatusAction('dsp-1', 'release_seller' as any, 'ok');

        const credit = mockCreditWalletOnce.mock.calls[0][0] as any;
        expect(credit.reference).toBe('DISPUTE-RES-dsp-1');
        expect(credit.userId).toBe('seller-1');
        expect(credit.amount).toBe(50_000);
    });

    it('does not record an escrow payout as platform revenue', async () => {
        const { updateDisputeStatusAction } = await import('@/app/actions/disputes');
        await updateDisputeStatusAction('dsp-1', 'refund_buyer' as any, 'ok');

        const credit = mockCreditWalletOnce.mock.calls[0][0] as any;
        expect(credit.status).toBe('refund');
        expect(credit.status).not.toBe('completed');
    });

    it('pays the buyer, not the seller, on a refund', async () => {
        const { updateDisputeStatusAction } = await import('@/app/actions/disputes');
        await updateDisputeStatusAction('dsp-1', 'refund_buyer' as any, 'ok');

        const credit = mockCreditWalletOnce.mock.calls[0][0] as any;
        expect(credit.userId).toBe('buyer-1');
        expect((mockClaimFromAny.mock.calls[0][0] as any).to).toBe('refunded');
    });
});
