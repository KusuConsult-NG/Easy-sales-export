/**
 * @jest-environment node
 */

/**
 *   #342 A MARKETPLACE ORDER IS ONE DOCUMENT AND A BASKET IS MANY SELLERS.
 *
 *        Both order creators write a single MARKETPLACE_ORDERS row per
 *        checkout — `sellerIds`, every seller's `items`, and the whole basket's
 *        subtotal / deliveryFee / totalAmount — and then create a SEPARATE
 *        ESCROW ROW PER SELLER, because the money is per seller.
 *
 *        Three seller-side readers never made that distinction. Each queries
 *
 *            .where("sellerIds", "array-contains", userId)
 *
 *        which is correctly scoped, and then returns or sums the whole
 *        document:
 *
 *          marketplace/_mp_seller_dashboard.ts  getSellerOrdersAction
 *          order-management.ts                  getSellerOrdersAction
 *          marketplace/_mp_seller_dashboard.ts  getSellerAnalyticsAction
 *
 *        SCOPE IS NOT PAYLOAD, AND THE EARLIER SWEEP CONFLATED THEM. The
 *        duplicate-action-names examination looked at this very pair and
 *        recorded, verbatim:
 *
 *            getSellerOrdersAction: 2,  // both filter sellerIds
 *                                       // array-contains session id; the
 *                                       // UNWIRED one additionally requires
 *                                       // the seller role — stricter, not
 *                                       // weaker
 *
 *        Every word true, and it answered "may this seller see this ORDER"
 *        while the defect was "what of the order may they see". #340 came out
 *        of the same error in the same file, on getPropertyByIdAction, and both
 *        notes are corrected there.
 *
 *        WHAT IT COST, ON THREE SCREENS
 *
 *          seller/orders     `{order.items.map(i => i.productTitle).join(", ")}`
 *                            and `{order.items.length} Items` — another
 *                            merchant's products, listed as this seller's,
 *                            under "Please pack and ship the items."
 *          seller/dashboard  `{order.items.length} items •
 *                            {formatCurrency(order.totalAmount)}`
 *          the tiles         totalSales and monthlyRevenue summed the whole
 *                            basket, delivery fee included, over every order
 *                            the seller appears in — the figure a seller judges
 *                            their business by, against a payout computed from
 *                            their escrow row.
 *
 *        The split is not invented: lib/order-scope.ts reproduces exactly what
 *        _payment_orders.ts already computes to size each seller's escrow row —
 *        their items at the recorded unit price, plus deliveryFee divided by
 *        the number of sellers.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    isMultiSellerOrder,
    sellerItems,
    sellerOrderAmount,
    scopeOrderToSeller,
} from '@/lib/order-scope';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

declare const global: any;

const ME = 'seller-a';
const RIVAL = 'seller-b';

let store: FakeDbHandle;

function actAs(id: string, roles: string[] = ['seller']) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com` } },
        error: null,
    }));
}

/**
 * A two-seller basket, priced so every figure is distinguishable:
 *
 *   seller-a   2 x 1,000  =  2,000
 *   seller-b   1 x 5,000  =  5,000
 *   delivery              =  1,000  (500 each)
 *   totalAmount           =  8,000
 */
const SHARED_ORDER = {
    orderId: 'ORD-1',
    buyerId: 'buyer-1',
    buyerEmail: 'buyer@example.com',
    buyerPhone: '08011111111',
    sellerIds: [ME, RIVAL],
    sellerId: ME,
    items: [
        { sellerId: ME, productId: 'p-a', productTitle: 'My Yams', pricePerUnit: 1000, quantity: 2 },
        { sellerId: RIVAL, productId: 'p-b', productTitle: "Rival's Rice", pricePerUnit: 5000, quantity: 1 },
    ],
    productIds: ['p-a', 'p-b'],
    subtotal: 7000,
    deliveryFee: 1000,
    totalAmount: 8000,
    status: 'processing',
    paymentStatus: 'paid',
    deliveryAddress: { recipientName: 'A Buyer', city: 'Jos', state: 'Plateau' },
    createdAt: '2026-09-01T00:00:00.000Z',
};

const SOLO_ORDER = {
    orderId: 'ORD-2',
    buyerId: 'buyer-2',
    sellerIds: [ME],
    sellerId: ME,
    items: [{ sellerId: ME, productId: 'p-a', productTitle: 'My Yams', pricePerUnit: 1000, quantity: 3 }],
    productIds: ['p-a'],
    subtotal: 3000,
    deliveryFee: 500,
    totalAmount: 3500,
    status: 'delivered',
    paymentStatus: 'paid',
    createdAt: '2026-09-02T00:00:00.000Z',
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(ME);
});

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#342 — the split, and where it comes from', () => {
    it("THE SELLER'S SHARE IS THEIR ITEMS PLUS THEIR SHARE OF DELIVERY", () => {
        // THE test. 2 x 1,000 + 1,000/2 = 2,500 — not the basket's 8,000.
        expect(sellerOrderAmount(SHARED_ORDER, ME)).toBe(2500);
        expect(sellerOrderAmount(SHARED_ORDER, RIVAL)).toBe(5500);
    });

    it('and the two shares add up to the whole order', () => {
        expect(sellerOrderAmount(SHARED_ORDER, ME) + sellerOrderAmount(SHARED_ORDER, RIVAL))
            .toBe(SHARED_ORDER.totalAmount);
    });

    it('THE SAME ARITHMETIC THE ESCROW ROW IS SIZED WITH', () => {
        // The claim, pinned against the creator. If the escrow split changes
        // and this helper does not, a seller's dashboard stops agreeing with
        // their payout — which is the defect one level along.
        const creator = source('src/app/actions/marketplace/_payment_orders.ts');

        /**
         * #409 RELAXED FROM A LITERAL TO THE RULE, ON PURPOSE.
         *
         * This asserted the exact text
         *
         *     const deliveryFeePerSeller = calculatedDeliveryFee / uniqueSellers.length
         *
         * and #409 replaced that line: the raw divide produced NaN when the fee
         * was unreadable or the seller list empty, and the escrow write below it
         * had no amount check to stop the NaN reaching the ledger.
         *
         * What #342 actually needs is that the escrow row is sized by the SAME
         * two-part rule this helper implements — each seller's items, plus an
         * equal share of one delivery fee. That is what is pinned now. Pinning
         * the sentence rather than the rule is how a correct repair gets read as
         * a regression, and it nearly did here.
         */
        expect(creator).toMatch(/deliveryFeePerSeller\s*=[\s\S]{0,200}?uniqueSellers\.length/);
        expect(creator).toContain('sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + itemTotal');
        expect(creator).toContain('sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + deliveryFeePerSeller');

        // And the divide is guarded, so the share can never be NaN — the
        // helper above returns numbers, and the escrow row must too.
        expect(creator).toMatch(/Number\.isFinite\([\s\S]{0,40}?uniqueSellers\.length > 0/);
    });

    it('a single-seller order is returned untouched', () => {
        // The counterpart guard. Scoping a solo order to "the seller's items"
        // must be the identity, and scoping a legacy row whose items carry no
        // sellerId must NOT empty the seller's own order list.
        expect(isMultiSellerOrder(SOLO_ORDER)).toBe(false);
        expect(scopeOrderToSeller(SOLO_ORDER, ME)).toBe(SOLO_ORDER);
        expect(sellerOrderAmount(SOLO_ORDER, ME)).toBe(3500);
    });

    it('and so is a legacy row whose items never carried a sellerId', () => {
        const legacy = { sellerIds: [ME], items: [{ productId: 'p', pricePerUnit: 900, quantity: 1 }], totalAmount: 900 };

        expect(isMultiSellerOrder(legacy)).toBe(false);
        expect(sellerItems(legacy, ME)).toHaveLength(1);
        expect(sellerOrderAmount(legacy, ME)).toBe(900);
    });

    it('coerces a non-numeric amount rather than propagating NaN', () => {
        const bad = { sellerIds: [ME], items: [], totalAmount: 'not a number' };
        expect(sellerOrderAmount(bad, ME)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#342 — what the seller now receives', () => {
    it("THE RIVAL'S PRODUCT IS NOT IN THIS SELLER'S ORDER", () => {
        const scoped = scopeOrderToSeller(SHARED_ORDER, ME) as any;

        expect(scoped.items).toHaveLength(1);
        expect(scoped.items[0].productTitle).toBe('My Yams');
        expect(JSON.stringify(scoped)).not.toContain("Rival's Rice");
        expect(JSON.stringify(scoped)).not.toContain(RIVAL);
        expect(scoped.productIds).toEqual(['p-a']);
    });

    it('and the money on it is theirs', () => {
        const scoped = scopeOrderToSeller(SHARED_ORDER, ME) as any;

        expect(scoped.subtotal).toBe(2000);
        expect(scoped.deliveryFee).toBe(500);
        expect(scoped.totalAmount).toBe(2500);
    });

    it("but the buyer's delivery details stay — the seller has to ship it", () => {
        // The counterpart guard: this is a projection, not a redaction of the
        // seller's own business.
        const scoped = scopeOrderToSeller(SHARED_ORDER, ME) as any;

        expect(scoped.buyerEmail).toBe('buyer@example.com');
        expect(scoped.buyerPhone).toBe('08011111111');
        expect(scoped.deliveryAddress.city).toBe('Jos');
        expect(scoped.status).toBe('processing');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#342 — BOTH actions named getSellerOrdersAction, executed', () => {
    it('the wired one returns only this seller\'s lines', async () => {
        store.seed(COLLECTIONS.MARKETPLACE_ORDERS, 'ORD-1', SHARED_ORDER);
        const { getSellerOrdersAction } =
            await import('@/app/actions/marketplace/_mp_seller_dashboard');

        const res = (await getSellerOrdersAction({})) as any;
        expect(res.success).toBe(true);
        expect(res.data.orders).toHaveLength(1);        // vacuity guard

        const order = res.data.orders[0];
        expect(order.items).toHaveLength(1);
        expect(order.totalAmount).toBe(2500);
        expect(JSON.stringify(res)).not.toContain("Rival's Rice");
    });

    it('and so does the other one, in order-management.ts', async () => {
        store.seed(COLLECTIONS.USERS, ME, { roles: ['seller'] });
        store.seed(COLLECTIONS.MARKETPLACE_ORDERS, 'ORD-1', SHARED_ORDER);
        const { getSellerOrdersAction } = await import('@/app/actions/order-management');

        const res = (await getSellerOrdersAction()) as any;
        expect(res.success).toBe(true);
        expect(res.data.orders).toHaveLength(1);        // vacuity guard

        expect(res.data.orders[0].items).toHaveLength(1);
        expect(res.data.orders[0].totalAmount).toBe(2500);
        expect(JSON.stringify(res)).not.toContain("Rival's Rice");
    });

    it("THE BUYER'S copy is untouched — the whole basket is what they bought", async () => {
        actAs('buyer-1', ['buyer']);
        store.seed(COLLECTIONS.MARKETPLACE_ORDERS, 'ORD-1', SHARED_ORDER);
        const { getBuyerOrdersAction } = await import('@/app/actions/order-management');

        const res = (await getBuyerOrdersAction()) as any;
        expect(res.data.orders[0].items).toHaveLength(2);
        expect(res.data.orders[0].totalAmount).toBe(8000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#342 — and the revenue tiles', () => {
    it("TOTAL SALES IS THIS SELLER'S SHARE, NOT THE BASKET", async () => {
        store.seed(COLLECTIONS.MARKETPLACE_ORDERS, 'ORD-1', SHARED_ORDER);
        store.seed(COLLECTIONS.MARKETPLACE_ORDERS, 'ORD-2', SOLO_ORDER);
        const { getSellerAnalyticsAction } =
            await import('@/app/actions/marketplace/_mp_seller_dashboard');

        const res = (await getSellerAnalyticsAction()) as any;
        expect(res.success).toBe(true);

        // 2,500 from the shared basket + 3,500 from the solo order.
        // It was 8,000 + 3,500 = 11,500.
        expect(res.data.analytics.totalSales).toBe(6000);
        // Vacuity guard: both orders were counted, so the figure fell because
        // the share is right, not because an order was dropped.
        expect(res.data.analytics.monthlyRevenue + res.data.analytics.prevTotalSales)
            .toBe(6000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#342 — one rule, and every seller-side reader uses it', () => {
    it('all three call the shared helper', () => {
        // The ratchet. A fourth reader summing data.totalAmount over
        // `sellerIds array-contains` is the defect coming back.
        expect(source('src/app/actions/marketplace/_mp_seller_dashboard.ts'))
            .toContain('scopeOrderToSeller(doc.data(), userId)');
        expect(source('src/app/actions/marketplace/_mp_seller_dashboard.ts'))
            .toContain('sellerOrderAmount(data, userId)');
        expect(source('src/app/actions/order-management.ts'))
            .toContain('scopeOrderToSeller(o as any, userId)');
    });

    it('and none of them still sums the whole basket', () => {
        const dash = source('src/app/actions/marketplace/_mp_seller_dashboard.ts');

        expect(dash).not.toContain('orderAmount(data)');
    });
});
