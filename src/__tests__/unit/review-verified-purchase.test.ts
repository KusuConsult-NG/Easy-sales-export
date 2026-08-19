/**
 * @jest-environment node
 */

/**
 * One delivered order licensed a verified review of the entire catalogue.
 *
 * `submitProductReviewAction` checked the ORDER carefully — the buyer owns it,
 * it reached "delivered" or "completed", and there is no existing review for
 * this (buyer, order, product). Then it took `productId` from the caller and
 * never compared it to what the order actually contained.
 *
 * So a buyer with one delivered order could review any product on the platform.
 * The review is written with `verified: true` and fed straight into
 * `_recalculateProductRating`, which moves that product's public average.
 *
 * It works in both directions. One-star a competitor; or buy anything once, then
 * five-star your own listings as a verified purchase. The duplicate guard is per
 * (buyer, order, product), so a single order covered every product, one review
 * each.
 *
 * THE EVIDENCE THAT THIS WAS AN OVERSIGHT
 * ---------------------------------------
 * `submitSellerReviewAction`, two screens down the same file, already does the
 * equivalent check:
 *
 *     const sellerIds = orderData.sellerIds || [];
 *     if (!sellerIds.includes(data.sellerId)) { ... }
 *
 * The seller path verifies its subject was on the order. Only the product path
 * did not.
 *
 * ALSO FIXED, SMALLER
 * -------------------
 * `moderateReviewAction`'s `action` parameter is typed "approved" | "rejected"
 * and was written straight into `status`. A type union is a compile-time claim;
 * a server action is reachable with any argument. A review in an unrecognised
 * status is invisible to both the pending queue and the public list.
 *
 * Its `collection` parameter needs no such check, and does not get one: the
 * ternary maps anything that is not "product_reviews" to seller_reviews, so an
 * arbitrary string cannot reach an arbitrary table. Checked rather than assumed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';
const ADMIN = 'admin-1';
const ORDER = 'order-1';
const BOUGHT = 'product-bought';
const NOT_BOUGHT = 'product-never-bought';
const SELLER = 'seller-1';
const OTHER_SELLER = 'seller-2';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    recordAdminAction: jest.fn(async () => undefined),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/**
 * The order, plus empty query results for the duplicate-review lookup.
 *
 * Reads are routed by argument: a doc get receives the id, a `.where().get()`
 * receives the collection name. Returning one snapshot for both would let the
 * duplicate check see the order document and report a review that does not
 * exist.
 */
function setWorld(opts: { order?: Record<string, any> | null; existingReview?: boolean } = {}) {
    const order = opts.order === undefined
        ? {
            buyerId: BUYER,
            status: 'delivered',
            sellerIds: [SELLER],
            items: [{ productId: BOUGHT, sellerId: SELLER, quantity: 1 }],
        }
        : opts.order;

    (global as any).mockFirestoreGet.mockImplementation((idOrCollection: string) => {
        if (idOrCollection === 'product_reviews' || idOrCollection === 'seller_reviews') {
            return Promise.resolve({
                exists: false, empty: !opts.existingReview,
                docs: opts.existingReview ? [{ id: 'rev-1', data: () => ({ rating: 5 }) }] : [],
                data: () => ({}),
            });
        }
        if (idOrCollection === ORDER) {
            return Promise.resolve(
                order === null
                    ? { exists: false, empty: true, docs: [], data: () => undefined }
                    : { exists: true, empty: false, docs: [], data: () => order }
            );
        }
        return Promise.resolve({ exists: true, empty: true, docs: [], data: () => ({ productId: BOUGHT, rating: 5 }) });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => order ?? {},
    }));
}

function writtenReviews(): Record<string, any>[] {
    const g = global as any;
    return [...g.mockFirestoreSet.mock.calls, ...g.mockFirestoreAdd.mock.calls]
        .map((c: any[]) => c[c.length - 1])
        .filter((d: any) => d && 'rating' in d);
}

async function reviewProduct(productId: string, rating = 1) {
    const { submitProductReviewAction } = await import('@/app/actions/marketplace/_reviews');
    return submitProductReviewAction({ orderId: ORDER, productId, rating, comment: 'A comment' } as any);
}

async function reviewSeller(sellerId: string, rating = 1) {
    const { submitSellerReviewAction } = await import('@/app/actions/marketplace/_reviews');
    return submitSellerReviewAction({ orderId: ORDER, sellerId, rating, comment: 'A comment' } as any);
}

describe('submitProductReviewAction — you may review what you bought', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setWorld();
    });

    it('refuses a product that was not in the order', async () => {
        // THE test. This is the whole defect: a real delivered order, a real
        // buyer, and a product they never bought.
        const r: any = await reviewProduct(NOT_BOUGHT);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not part of this order/i);
        expect(writtenReviews()).toEqual([]);
    });

    it('refuses a one-star review of a competitor product', async () => {
        // The same defect stated as the thing it would be used for.
        const r: any = await reviewProduct('competitor-product', 1);

        expect(r.success).toBe(false);
        expect(writtenReviews()).toEqual([]);
    });

    it('refuses when the order has no items recorded', async () => {
        // Fails closed rather than treating an itemless order as permission for
        // everything.
        setWorld({ order: { buyerId: BUYER, status: 'delivered', sellerIds: [SELLER] } });

        const r: any = await reviewProduct(BOUGHT);

        expect(r.success).toBe(false);
    });

    it('accepts a review of a product that WAS in the order', async () => {
        // Vacuity guard. Every refusal above is satisfied by an endpoint that
        // accepts no reviews at all, which would silently end reviewing.
        const r: any = await reviewProduct(BOUGHT, 5);

        expect(r.success).toBe(true);
        const review = writtenReviews()[0];
        expect(review?.productId).toBe(BOUGHT);
        expect(review?.buyerId).toBe(BUYER);
        expect(review?.verified).toBe(true);
        expect(review?.status).toBe('pending');
    });

    it('still refuses somebody else\'s order', async () => {
        // Pre-existing guard; must survive the change.
        setSession('stranger-1');

        const r: any = await reviewProduct(BOUGHT);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not your order/i);
    });

    it('still refuses an order that has not been delivered', async () => {
        setWorld({ order: { buyerId: BUYER, status: 'processing', sellerIds: [SELLER], items: [{ productId: BOUGHT }] } });

        const r: any = await reviewProduct(BOUGHT);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/delivered/i);
    });

    it('still refuses a rating outside 1 to 5', async () => {
        const r: any = await reviewProduct(BOUGHT, 6);

        expect(r.success).toBe(false);
        expect(writtenReviews()).toEqual([]);
    });

    it('still refuses a second review of the same product on the same order', async () => {
        setWorld({ existingReview: true });

        const r: any = await reviewProduct(BOUGHT);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/already reviewed/i);
    });
});

describe('submitSellerReviewAction — the check the product path was missing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setWorld();
    });

    it('refuses a seller who was not on the order', async () => {
        // Already correct before this change, and asserted so it stays that way
        // — it is the precedent the product fix was modelled on.
        const r: any = await reviewSeller(OTHER_SELLER);

        expect(r.success).toBe(false);
        expect(writtenReviews()).toEqual([]);
    });

    it('accepts a review of a seller who was on the order', async () => {
        const r: any = await reviewSeller(SELLER, 5);

        expect(r.success).toBe(true);
    });
});

describe('moderateReviewAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
        setWorld();
    });

    async function moderate(action: string) {
        const { moderateReviewAction } = await import('@/app/actions/marketplace/_reviews');
        return moderateReviewAction('rev-1', 'product_reviews' as any, action as any);
    }

    it('refuses a moderation action outside approved and rejected', async () => {
        const r: any = await moderate('shadowbanned');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/approved or rejected/i);
    });

    it('accepts approval', async () => {
        const r: any = await moderate('approved');

        expect(r.success).toBe(true);
    });

    it('accepts rejection', async () => {
        const r: any = await moderate('rejected');

        expect(r.success).toBe(true);
    });

    it('refuses a non-admin', async () => {
        setSession(BUYER);

        const r: any = await moderate('approved');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
    });
});
