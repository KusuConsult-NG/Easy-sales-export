/**
 * @jest-environment node
 */

/**
 * The marketplace order verifier and the escrow chat, EXECUTED.
 *
 * _payment_verify.ts was at 11.8% statements and 0% BRANCHES — not one
 * conditional in the platform's highest-volume money path had ever been taken
 * in a test. _escrow_messages.ts was at 9.1% / 0%. Two findings came out of
 * running them:
 *
 *   #102 The verifier claims the payment and then does ~200 lines of writes
 *        inside a runTransaction the adapter does not roll back. Its catch
 *        logged and returned a generic error — the ONLY claimed-payment path in
 *        the codebase that never called markFulfilmentFailed. And both early
 *        returns looked the order up and then ignored its status, so a buyer
 *        retrying after a failed fulfilment was told "Order payment
 *        successful!" while the order sat at paymentStatus "pending" with no
 *        escrow, no seller notified, and stock already gone.
 *
 *   #103 _escrow_messages.ts asked who is an admin two different ways. The two
 *        message functions used isAdmin() — true for all ten admin roles — so
 *        an academy_admin or a support agent could read a buyer-seller escrow
 *        conversation and POST INTO IT, while the two escrow-record readers in
 *        the same file refused them. The permissive pair was the one that
 *        writes.
 *
 * WHAT IS MOCKED
 * --------------
 * Paystack, and the Postgres primitives the fake deliberately does not
 * implement — claimPaymentOnce, decrementManyOrFail and markFulfilmentFailed
 * (see KNOWN_DIVERGENCES). Everything the actions decide runs for real.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { resetFallbackLimit } from '@/lib/rate-limiter-fallback';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const verifyPaystackPayment = jest.fn(async (_r: string) => ({
    status: true,
    data: { status: 'success', amount: 0, metadata: {} as Record<string, unknown> },
}));
jest.mock('@/lib/paystack-server', () => ({
    verifyPaystackPayment: (r: string) => verifyPaystackPayment(r),
    initializePaystackPayment: jest.fn(),
}));

const claimPaymentOnce = jest.fn(async (_p: unknown) => ({ claimed: true } as { claimed: boolean }));
const decrementManyOrFail = jest.fn(async (_i: unknown) => ({ ok: true } as
    { ok: boolean; failedId?: string; reason?: string }));
const markFulfilmentFailed = jest.fn(async (_r: string, _m: string) => undefined);
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (p: unknown) => claimPaymentOnce(p),
    decrementManyOrFail: (i: unknown) => decrementManyOrFail(i),
    markFulfilmentFailed: (r: string, m: string) => markFulfilmentFailed(r, m),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
}));

jest.mock('@/lib/system-settings', () => ({
    getPlatformFees: async () => ({
        platformFeePercentage: 0.1, minOrderAmount: 1000, maxOrderAmount: 10_000_000,
    }),
}));

jest.mock('@/lib/marketplace-notifications', () => ({
    notifyPaymentReceived: jest.fn(async () => undefined),
}));

jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: jest.fn(async () => undefined),
}));

let store: FakeDbHandle;

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const REF = 'MKT-REF-1';
const ORDER_DOC = 'ORD-1';

const ORDERS = COLLECTIONS.MARKETPLACE_ORDERS;
const ESCROWS = COLLECTIONS.ESCROW_TRANSACTIONS;
const PAYMENTS = COLLECTIONS.PROCESSED_PAYMENTS;

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles, email: 'ada@example.com', name: 'Ada Obi' } }, error: null },
    ));
}

const paystackSays = (naira: number, metadata: Record<string, unknown>, status = 'success') =>
    verifyPaystackPayment.mockImplementation(async () => ({
        status: true, data: { status, amount: Math.round(naira * 100), metadata },
    }));

beforeEach(() => {
    jest.clearAllMocks();
    claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
    decrementManyOrFail.mockImplementation(async () => ({ ok: true }));
    store = installFakeDb();
    actAs(BUYER);
    resetFallbackLimit(`payment:${BUYER}`);
});

async function actions() {
    return import('@/app/actions/marketplace/_payment_verify');
}

const verify = async (ref = REF) =>
    (await (await actions()).verifyOrderPaymentAction(ref)) as any;

/** An order as _payment_orders.ts writes it: paymentStatus "pending". */
const seedOrder = (extra: Record<string, unknown> = {}) =>
    store.seed(ORDERS, ORDER_DOC, {
        orderId: ORDER_DOC,
        buyerId: BUYER,
        sellerId: SELLER,
        sellerIds: [SELLER],
        paymentReference: REF,
        paymentStatus: 'pending',
        status: 'pending_payment',
        subtotal: 45_000,
        deliveryFee: 5_000,
        totalAmount: 50_000,
        items: [{
            productId: 'p1', productTitle: 'Cocoa', sellerId: SELLER,
            quantity: 2, pricePerUnit: 22_500, totalPrice: 45_000, isFlashSale: false,
        }],
        ...extra,
    });

const order = () => store.get(ORDERS, ORDER_DOC) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('verifyOrderPaymentAction — the guards', () => {
    beforeEach(() => {
        seedOrder();
        store.seed(COLLECTIONS.PRODUCTS, 'p1', { sellerId: SELLER, title: 'Cocoa', availableQuantity: 10 });
        store.seedAll(COLLECTIONS.USERS, {
            [BUYER]: { email: 'ada@example.com' },
            [SELLER]: { email: 'bola@example.com' },
        });
        paystackSays(50_000, { userId: BUYER, type: 'marketplace_order' });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await verify()).toMatchObject({ success: false });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('is rate limited, in its own key space', async () => {
        for (let i = 0; i < 10; i++) {
            store.seed(ORDERS, ORDER_DOC, { ...order(), paymentStatus: 'pending' });
            await verify();
        }
        const refused = await verify();
        expect(refused.success).toBe(false);
        expect(refused.error).toContain('Too many payment verification attempts');
    });

    it('refuses a Paystack transaction that did not succeed', async () => {
        paystackSays(50_000, { userId: BUYER }, 'abandoned');

        expect(await verify()).toMatchObject({ success: false });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
        expect(order().paymentStatus).toBe('pending');
    });

    it('refuses a payment whose metadata names a DIFFERENT user', async () => {
        paystackSays(50_000, { userId: 'somebody-else' });

        expect(await verify()).toMatchObject({
            success: false, error: 'Payment verification failed: User mismatch',
        });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('refuses when no order carries the reference', async () => {
        store.clear();
        expect(await verify()).toMatchObject({ success: false, error: 'Order record not found' });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('REFUSES an underpayment against the ORDER total, not the gateway metadata', async () => {
        // The old check compared against metadata.totalAmount and refused in
        // both directions, while the webhook compared against the order and
        // refused only underpayment — same payment, two answers, decided by
        // whichever path arrived first.
        paystackSays(40_000, { userId: BUYER, totalAmount: 40_000 });

        const res = await verify();
        expect(res.success).toBe(false);
        expect(claimPaymentOnce).not.toHaveBeenCalled();
        expect(order().paymentStatus).toBe('pending');
    });

    it('and ACCEPTS an overpayment rather than stranding a charged buyer', async () => {
        paystackSays(60_000, { userId: BUYER });
        expect(await verify()).toMatchObject({ success: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('verifyOrderPaymentAction — fulfilment', () => {
    beforeEach(() => {
        seedOrder();
        store.seed(COLLECTIONS.PRODUCTS, 'p1', { sellerId: SELLER, title: 'Cocoa', description: 'Fine cocoa', availableQuantity: 10 });
        store.seedAll(COLLECTIONS.USERS, {
            [BUYER]: { email: 'ada@example.com' },
            [SELLER]: { email: 'bola@example.com' },
        });
        paystackSays(50_000, { userId: BUYER, type: 'marketplace_order' });
    });

    it('moves the order to escrow_held and records what was paid', async () => {
        expect(await verify()).toMatchObject({ success: true });

        expect(order()).toMatchObject({
            paymentStatus: 'escrow_held', status: 'processing', paidAmount: 50_000,
        });
    });

    it('reserves stock BEFORE fulfilling, all or nothing', async () => {
        await verify();

        expect(decrementManyOrFail).toHaveBeenCalledWith([{
            collection: COLLECTIONS.PRODUCTS, id: 'p1',
            field: 'availableQuantity', amount: 2,
        }]);
    });

    it('funds one escrow per seller, net of the platform fee', async () => {
        await verify();

        const escrows = store.all(ESCROWS);
        expect(escrows).toHaveLength(1);
        const [id, escrow] = escrows[0];
        expect(id).toBe(`ESC-${ORDER_DOC}-${SELLER.substring(0, 5)}`);
        expect(escrow).toMatchObject({
            orderId: ORDER_DOC, buyerId: BUYER, sellerId: SELLER,
            // 45,000 of goods + the whole 5,000 delivery fee, one seller.
            amount: 50_000, grossAmount: 50_000,
            platformFee: 5_000, netAmount: 45_000,
            status: 'funded', productName: 'Cocoa',
        });
        expect(escrow.participants).toEqual([BUYER, SELLER]);
    });

    it('splits the delivery fee across sellers, and the escrows sum to the order', async () => {
        seedOrder({
            sellerIds: [SELLER, 'seller-2'],
            items: [
                { productId: 'p1', sellerId: SELLER, quantity: 1, pricePerUnit: 30_000, productTitle: 'Cocoa' },
                { productId: 'p2', sellerId: 'seller-2', quantity: 1, pricePerUnit: 15_000, productTitle: 'Sesame' },
            ],
        });
        store.seed(COLLECTIONS.PRODUCTS, 'p2', { sellerId: 'seller-2', title: 'Sesame', availableQuantity: 5 });

        await verify();

        const amounts = store.all(ESCROWS).map(([, e]) => e.amount).sort((a, b) => b - a);
        expect(amounts).toEqual([32_500, 17_500]);
        expect(amounts[0] + amounts[1]).toBe(50_000);
    });

    it('GIVES TWO SELLERS TWO ESCROWS even when their ids share a prefix', async () => {
        // #104. The id was `ESC-${orderId}-${sellerId.substring(0, 5)}` in all
        // four escrow writers. Two sellers whose ids agree on five characters
        // produced the SAME document id, and the funding write is a full set(),
        // so the second silently OVERWROTE the first — one seller's escrow
        // disappeared and they were never paid, with nothing recording the loss.
        seedOrder({
            sellerIds: ['seller-alpha', 'seller-beta'],
            items: [
                { productId: 'p1', sellerId: 'seller-alpha', quantity: 1, pricePerUnit: 30_000, productTitle: 'Cocoa' },
                { productId: 'p2', sellerId: 'seller-beta', quantity: 1, pricePerUnit: 15_000, productTitle: 'Sesame' },
            ],
        });
        store.seed(COLLECTIONS.PRODUCTS, 'p2', { sellerId: 'seller-beta', title: 'Sesame', availableQuantity: 5 });

        await verify();

        const escrows = store.all(ESCROWS);
        expect(escrows).toHaveLength(2);
        expect(escrows.map(([, e]) => e.sellerId).sort()).toEqual(['seller-alpha', 'seller-beta']);
        // Every naira of the order is held for somebody.
        expect(escrows.reduce((sum, [, e]) => sum + e.amount, 0)).toBe(50_000);
    });

    it('and keeps the SHORT id when there is no collision — no migration window', async () => {
        // The whole point of only lengthening on collision: every existing
        // escrow, and all but one in a million future ones, keeps the id it
        // already has. A deploy must not orphan the pending row written at
        // placement.
        await verify();

        expect(store.all(ESCROWS).map(([id]) => id)).toEqual([`ESC-${ORDER_DOC}-selle`]);
    });

    it('writes the payment record and the global ledger row', async () => {
        await verify();

        expect(store.get(COLLECTIONS.PAYMENTS, `PAY-${ORDER_DOC}`)).toMatchObject({
            userId: BUYER, amount: 50_000, paymentReference: REF,
            status: 'success', purpose: 'escrow_payment',
        });
        expect(store.get(COLLECTIONS.TRANSACTIONS, REF)).toMatchObject({
            userId: BUYER, type: 'marketplace_order', module: 'marketplace',
            amount: 50_000, status: 'completed',
        });
    });

    it('claims the payment BEFORE reserving stock or fulfilling', async () => {
        let stockTouchedYet = false;
        claimPaymentOnce.mockImplementation(async () => {
            stockTouchedYet = decrementManyOrFail.mock.calls.length > 0;
            return { claimed: true };
        });

        await verify();
        expect(stockTouchedYet).toBe(false);
    });

    it('RECORDS A REFUND when the goods sold out after payment', async () => {
        decrementManyOrFail.mockImplementation(async () => ({ ok: false, failedId: 'p1', reason: 'insufficient' }));

        const res = await verify();
        expect(res.success).toBe(false);
        expect(res.error).toContain('sold out');

        expect(order()).toMatchObject({
            paymentStatus: 'paid_awaiting_refund',
            status: 'cancelled_out_of_stock',
            refundRequiredAmount: 50_000,
        });
        expect(String(order().refundReason)).toContain('Cocoa');
        expect(store.size(ESCROWS)).toBe(0);
    });

    it('and when the product has been delisted entirely', async () => {
        decrementManyOrFail.mockImplementation(async () => ({ ok: false, failedId: 'p1', reason: 'not_found' }));

        expect((await verify()).success).toBe(false);
        expect(String(order().refundReason)).toContain('no longer listed');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#102 — processed does not mean fulfilled', () => {
    beforeEach(() => {
        seedOrder();
        store.seed(COLLECTIONS.PRODUCTS, 'p1', { sellerId: SELLER, title: 'Cocoa', availableQuantity: 10 });
        store.seedAll(COLLECTIONS.USERS, {
            [BUYER]: { email: 'ada@example.com' }, [SELLER]: { email: 'bola@example.com' },
        });
        paystackSays(50_000, { userId: BUYER });
    });

    it('the fast path reports success when the webhook DID fulfil the order', async () => {
        store.seed(PAYMENTS, REF, { reference: REF, status: 'completed' });
        seedOrder({ paymentStatus: 'escrow_held', status: 'processing' });

        expect(await verify()).toMatchObject({
            success: true, data: { orderId: ORDER_DOC, message: 'Order payment successful!' },
        });
        // Not re-verified, not re-claimed.
        expect(verifyPaystackPayment).not.toHaveBeenCalled();
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('and REFUSES when the payment is claimed but the order never moved', async () => {
        // The buyer was told "Order payment successful!" on the strength of the
        // marker alone, while the order sat at "pending" with no escrow.
        store.seed(PAYMENTS, REF, { reference: REF, status: 'completed' });

        const res = await verify();
        expect(res.success).toBe(false);
        expect(res.error).toContain('could not be completed');
        expect(res.error).toContain('do not pay again');
        expect(markFulfilmentFailed).toHaveBeenCalledWith(REF, expect.any(String));
    });

    it('and when the claimed payment has no order at all', async () => {
        store.clear();
        store.seed(PAYMENTS, REF, { reference: REF, status: 'completed' });

        expect((await verify()).success).toBe(false);
        expect(markFulfilmentFailed).toHaveBeenCalled();
    });

    it('a LOST CLAIM reports success only when the winner actually fulfilled', async () => {
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));
        seedOrder({ paymentStatus: 'escrow_held', status: 'processing' });

        expect(await verify()).toMatchObject({
            success: true, data: { orderId: ORDER_DOC },
        });
        expect(markFulfilmentFailed).not.toHaveBeenCalled();
    });

    it('and refuses when the concurrent winner did NOT fulfil', async () => {
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        const res = await verify();
        expect(res.success).toBe(false);
        expect(res.error).toContain('could not be completed');
        expect(markFulfilmentFailed).toHaveBeenCalledWith(REF, expect.any(String));
    });

    it('MARKS THE FULFILMENT FAILED when the work throws after the claim', async () => {
        // Everything past the claim is one runTransaction the adapter does not
        // roll back. This was the only claimed-payment path that recorded
        // nothing when it died — leaving a row that says "completed" for a
        // payment that delivered nothing.
        decrementManyOrFail.mockImplementation(async () => { throw new Error('postgres exploded'); });

        const res = await verify();
        expect(res.success).toBe(false);
        expect(res.error).toContain('could not be completed');
        expect(markFulfilmentFailed).toHaveBeenCalledWith(REF, 'postgres exploded');
    });

    it('but NOT when the throw happened before any money was taken here', async () => {
        // A pre-claim failure took nothing on this path, and must not mark
        // somebody else's completed payment as failed.
        verifyPaystackPayment.mockImplementation(async () => { throw new Error('paystack unreachable'); });

        const res = await verify();
        expect(res.success).toBe(false);
        expect(res.error).toContain('Failed to verify payment');
        expect(markFulfilmentFailed).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#103 — who may read and WRITE an escrow conversation', () => {
    const ESCROW = 'ESC-1';

    async function escrowActions() {
        return import('@/app/actions/marketplace/_escrow_messages');
    }

    const send = async (text = 'hello', senderId?: string) =>
        (await (await escrowActions()).sendEscrowMessageAction({
            escrowId: ESCROW,
            senderId: senderId ?? (await currentId()),
            senderName: 'whatever the caller claims',
            message: text,
        })) as any;

    let acting = BUYER;
    const currentId = async () => acting;
    const act = (id: string | null, roles: string[] = ['general_user']) => {
        acting = id ?? '';
        actAs(id, roles);
    };

    const readMessages = async () =>
        (await (await escrowActions()).getEscrowMessagesAction(ESCROW)) as any;
    const readEscrow = async () =>
        (await (await escrowActions()).getEscrowTransactionByIdAction(ESCROW)) as any;
    const readByOrder = async (orderId = ORDER_DOC) =>
        (await (await escrowActions()).getEscrowTransactionByOrderIdAction(orderId)) as any;

    beforeEach(() => {
        store.seed(ESCROWS, ESCROW, {
            orderId: ORDER_DOC, buyerId: BUYER, sellerId: SELLER,
            amount: 50_000, status: 'funded',
        });
        act(BUYER);
    });

    it('lets a participant send, and refuses a stranger', async () => {
        expect(await send('hello there')).toMatchObject({ success: true });

        act('stranger-1');
        expect(await send('nosy')).toMatchObject({
            success: false, error: 'Not a participant of this escrow',
        });
        expect(store.size(COLLECTIONS.ESCROW_MESSAGES)).toBe(1);
    });

    it('refuses a caller impersonating another sender', async () => {
        act(BUYER);
        expect(await send('hi', SELLER)).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('DERIVES the sender name rather than trusting the caller', async () => {
        // The chat renders senderName verbatim, so a participant could post as
        // "EasySales Support" while senderId recorded them correctly.
        await send('hello');

        expect(store.all(COLLECTIONS.ESCROW_MESSAGES)[0][1]).toMatchObject({
            senderId: BUYER, senderName: 'Ada Obi', message: 'hello', read: false,
        });
    });

    it.each([
        ['academy_admin'], ['wave_admin'], ['export_admin'],
        ['farm_nation_admin'], ['cooperative_admin'], ['support'], ['moderator'],
    ])('REFUSES a %s — they could read the chat AND post into it', async (role) => {
        // #103. sendEscrowMessageAction and getEscrowMessagesAction used
        // isAdmin(), true for all ten admin roles, while the two escrow-record
        // readers in the same file admitted only three. The permissive pair was
        // the one that writes.
        act('other-admin', [role]);

        expect(await send('official notice')).toMatchObject({ success: false });
        expect((await readMessages()).success).toBe(false);
        expect((await readEscrow()).success).toBe(false);
        expect((await readByOrder()).success).toBe(false);
        expect(store.size(COLLECTIONS.ESCROW_MESSAGES)).toBe(0);
    });

    it.each([['admin'], ['super_admin'], ['marketplace_admin']])(
        'ADMITS a %s to all four, which is what the strict pair already did', async (role) => {
            act('mkt-admin', [role]);

            expect(await send('support here')).toMatchObject({ success: true });
            expect((await readMessages()).success).toBe(true);
            expect((await readEscrow()).success).toBe(true);
            expect((await readByOrder()).success).toBe(true);
        });

    it('returns the conversation oldest first to a participant', async () => {
        store.seedAll(COLLECTIONS.ESCROW_MESSAGES, {
            m2: { escrowId: ESCROW, message: 'second', createdAt: '2026-02-01T00:00:00.000Z' },
            m1: { escrowId: ESCROW, message: 'first', createdAt: '2026-01-01T00:00:00.000Z' },
            other: { escrowId: 'ESC-OTHER', message: 'not this one', createdAt: '2026-03-01T00:00:00.000Z' },
        });

        expect((await readMessages()).data.map((m: any) => m.id)).toEqual(['m1', 'm2']);
    });

    it('picks the ACTIVE escrow when an order has several', async () => {
        // The query was .limit(1) with no ordering, so it returned an arbitrary
        // row and the participant check ran against THAT one.
        store.clear();
        store.seedAll(ESCROWS, {
            settled: { orderId: ORDER_DOC, buyerId: BUYER, sellerId: SELLER, status: 'refunded' },
            live: { orderId: ORDER_DOC, buyerId: BUYER, sellerId: SELLER, status: 'funded' },
        });

        expect((await readByOrder()).data.id).toBe('live');
    });

    it('reports not-found for an order with no escrow', async () => {
        expect(await readByOrder('no-such-order')).toMatchObject({
            success: false, error: 'Escrow transaction not found',
        });
    });
});
