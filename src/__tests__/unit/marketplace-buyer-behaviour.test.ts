/**
 * @jest-environment node
 */

/**
 * The buyer's own order actions, EXECUTED — browse, confirm receipt, cancel.
 *
 * _buyer.ts was at 27.5% statements and 11.7% branches. One finding came out of
 * running it:
 *
 *   #107 Both cancel paths restocked unconditionally, and the buyer's one can
 *        only cancel from "pending_payment" — the state in which NO stock has
 *        been reserved. The Paystack creator writes the order without touching
 *        availableQuantity; the reservation happens later, at verification. So
 *        placing an order, not paying, and cancelling INCREASED the seller's
 *        stock by the order quantity. Repeatable, cumulative, and it oversells
 *        afterwards, because the reservation succeeds against the inflated
 *        figure and the seller cannot ship.
 *
 * The rest executes rules earlier findings asserted structurally: the claimed
 * transition rather than a check-then-write, the shared confirmable set with
 * its dead "in_transit" entry removed, and confirming receipt touching only the
 * escrow that is still live.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

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

jest.mock('@/lib/marketplace-notifications', () => ({
    notifyOrderCancelled: jest.fn(async () => undefined),
    notifyPaymentReceived: jest.fn(async () => undefined),
    // #391. Added when confirmOrderReceiptAction began announcing the
    // delivery. A partial module mock is a real hazard here: the missing
    // export was `undefined`, calling it threw, and the throw turned a
    // COMMITTED confirmation into "Failed to confirm receipt". The action
    // now guards against that too — see the note there — but the mock has
    // to carry every export the file under test reaches for, or the suite
    // tests a shape production never has.
    notifyOrderDelivered: jest.fn(async () => undefined),
}));

/**
 * A stateful stand-in for the two claim primitives: they read the row, check
 * the from-set, and write only on a match. An always-claimed stub would make
 * every "cannot do it twice" test pass without the guard existing.
 */
let store: FakeDbHandle;
const claimFrom = jest.fn(async (p: any) => {
    const current = store.get(p.collection, p.id);
    if (!current) return { claimed: false, status: null };
    const status = String(current.status ?? '');
    const allowed: string[] = p.fromAny ?? [p.from];
    if (!allowed.includes(status)) return { claimed: false, status };
    store.seed(p.collection, p.id, { ...current, ...(p.patch ?? {}), status: p.to });
    // The real primitive reports the status AFTER the call.
    return { claimed: true, status: p.to };
});
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (p: unknown) => claimFrom(p),
    claimStatusTransitionFromAny: (p: unknown) => claimFrom(p),
}));

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ORDER = 'order-1';

const ORDERS = COLLECTIONS.MARKETPLACE_ORDERS;
const ESCROWS = COLLECTIONS.ESCROW_TRANSACTIONS;
const PRODUCTS = COLLECTIONS.PRODUCTS;

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles: ['general_user'], email: 'ada@example.com' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(BUYER);
});

async function actions() {
    return import('@/app/actions/marketplace/_buyer');
}

const confirm = async (id = ORDER) =>
    (await (await actions()).confirmOrderReceiptAction(id)) as any;
const cancel = async (id = ORDER) =>
    (await (await actions()).cancelOrderAction(id)) as any;

const seedOrder = (status: string, extra: Record<string, unknown> = {}) =>
    store.seed(ORDERS, ORDER, {
        orderId: ORDER, buyerId: BUYER, sellerId: SELLER, status,
        items: [{ productId: 'p1', quantity: 3, sellerId: SELLER, pricePerUnit: 1000 }],
        ...extra,
    });

const stockOf = (id = 'p1') => store.get(PRODUCTS, id)?.availableQuantity;

// ─────────────────────────────────────────────────────────────────────────────
describe('confirmOrderReceiptAction', () => {
    beforeEach(() => {
        seedOrder('shipped');
        store.seed(ESCROWS, 'ESC-1', { orderId: ORDER, status: 'funded', amount: 3000 });
    });

    /**
     *   #391. notifyOrderDelivered existed and NOTHING CALLED IT — not this
     *   half of the transition and not the admin half. Confirming receipt
     *   starts the clock on the seller's payout (#389/#390), and neither party
     *   was told it had started.
     *
     *   Asserted on the module mock rather than on a notification row: the
     *   claim under test is that this action reaches for the announcement, and
     *   what the helper then writes is that module's business.
     */
    it('#391 ANNOUNCES THE DELIVERY to the buyer and the seller', async () => {
        const { notifyOrderDelivered } = jest.requireMock('@/lib/marketplace-notifications') as any;
        notifyOrderDelivered.mockClear();

        expect(await confirm()).toMatchObject({ success: true });

        expect(notifyOrderDelivered).toHaveBeenCalledTimes(1);
        expect(notifyOrderDelivered).toHaveBeenCalledWith(
            expect.objectContaining({ orderId: ORDER }),
        );
    });

    it('#391 and a notification that throws does NOT undo a confirmation already written', async () => {
        // The .catch alone would not have covered this: a synchronous throw
        // from the call reaches the action's outer catch, and the buyer is
        // told "Failed to confirm receipt" about a transition that has been
        // claimed — after which retrying says it is already confirmed. Found
        // by this suite's own module mock during #391.
        const { notifyOrderDelivered } = jest.requireMock('@/lib/marketplace-notifications') as any;
        notifyOrderDelivered.mockImplementationOnce(() => { throw new Error('notifier is down'); });

        expect(await confirm()).toMatchObject({ success: true });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await confirm()).toMatchObject({ success: false });
        expect(store.get(ORDERS, ORDER)?.status).toBe('shipped');
    });

    it('refuses an order that does not exist', async () => {
        expect(await confirm('nope')).toMatchObject({ success: false, error: 'Order not found' });
    });

    it('refuses somebody else\'s order', async () => {
        seedOrder('shipped', { buyerId: 'somebody-else' });
        expect(await confirm()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.get(ORDERS, ORDER)?.status).toBe('shipped');
    });

    it.each(['processing', 'shipped'])('confirms from %s — the shared set', async (status) => {
        // The list was ["in_transit", "processing", "shipped"], and "in_transit"
        // is an ESCROW status no order ever holds — a dead entry that read as
        // though a fourth state were supported.
        seedOrder(status);

        expect(await confirm()).toMatchObject({ success: true });
        expect(store.get(ORDERS, ORDER)).toMatchObject({
            status: 'delivered', buyerConfirmed: true,
        });
    });

    it.each(['pending_payment', 'delivered', 'cancelled', 'disputed'])(
        'refuses from %s, naming the state', async (status) => {
            seedOrder(status);

            const res = await confirm();
            expect(res.success).toBe(false);
            expect(res.error).toContain(status === 'delivered' ? 'delivered' : status);
        });

    it('cannot be confirmed twice', async () => {
        expect((await confirm()).success).toBe(true);
        expect((await confirm()).success).toBe(false);
    });

    it('moves the LIVE escrow to delivered', async () => {
        await confirm();
        expect(store.get(ESCROWS, 'ESC-1')?.status).toBe('delivered');
    });

    it('and leaves a settled escrow exactly as it was', async () => {
        // This updated EVERY escrow row matching the orderId, including ones
        // already released or refunded — writing "delivered" over a settled
        // status and making a finished transaction look unfinished.
        store.seedAll(ESCROWS, {
            done: { orderId: ORDER, status: 'released', amount: 1000 },
            refunded: { orderId: ORDER, status: 'refunded', amount: 1000 },
            live: { orderId: ORDER, status: 'funded', amount: 1000 },
        });

        await confirm();

        expect(store.get(ESCROWS, 'done')?.status).toBe('released');
        expect(store.get(ESCROWS, 'refunded')?.status).toBe('refunded');
        expect(store.get(ESCROWS, 'live')?.status).toBe('delivered');
    });

    it('succeeds even when the order has no escrow at all', async () => {
        store.seed(ESCROWS, 'ESC-1', { orderId: 'another-order', status: 'funded' });
        expect(await confirm()).toMatchObject({ success: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cancelOrderAction', () => {
    beforeEach(() => {
        store.seed(PRODUCTS, 'p1', { sellerId: SELLER, title: 'Cocoa', availableQuantity: 10 });
        seedOrder('pending_payment');
        store.seed(ESCROWS, 'ESC-1', { orderId: ORDER, status: 'pending', amount: 3000 });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await cancel()).toMatchObject({ success: false });
    });

    it('refuses an order that does not exist', async () => {
        expect(await cancel('nope')).toMatchObject({ success: false, error: 'Order not found' });
    });

    it('refuses somebody else\'s order', async () => {
        seedOrder('pending_payment', { buyerId: 'somebody-else' });
        expect(await cancel()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.get(ORDERS, ORDER)?.status).toBe('pending_payment');
    });

    it.each(['processing', 'shipped', 'delivered', 'completed'])(
        'refuses to cancel a %s order', async (status) => {
            seedOrder(status);

            expect(await cancel()).toMatchObject({
                success: false, error: 'Only pending orders can be cancelled',
            });
            expect(stockOf()).toBe(10);
        });

    it('cancels the order and its pending escrow', async () => {
        expect(await cancel()).toMatchObject({ success: true });

        expect(store.get(ORDERS, ORDER)).toMatchObject({
            status: 'cancelled', paymentStatus: 'cancelled',
        });
        expect(store.get(ESCROWS, 'ESC-1')?.status).toBe('cancelled');
    });

    it('PUTS BACK NO STOCK, because none was ever taken', async () => {
        // #107. The only cancellable status is pending_payment, and
        // _initializeOrderPaymentAction writes that order without touching
        // availableQuantity — the reservation happens at verification. This
        // restocked unconditionally, so an unpaid cancel handed the seller three
        // units they never had.
        expect(await cancel()).toMatchObject({ success: true });
        expect(stockOf()).toBe(10);
    });

    it('and repeating it cannot inflate the shelf', async () => {
        // The compounding half: repeatable and cumulative, and the inflated
        // figure then oversells.
        for (let i = 0; i < 5; i++) {
            seedOrder('pending_payment');
            await cancel();
        }

        expect(stockOf()).toBe(10);
    });

    it('cannot be cancelled twice', async () => {
        expect((await cancel()).success).toBe(true);
        expect((await cancel()).success).toBe(false);
    });
});
