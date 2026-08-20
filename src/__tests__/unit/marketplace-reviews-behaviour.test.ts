/**
 * @jest-environment node
 */

/**
 * marketplace/_reviews.ts, EXECUTED — submit, read, summarise, moderate.
 *
 * reviews-behaviour.test.ts drives the OTHER review subsystem (actions/reviews.ts).
 * This file was at 68.8% statements and had never been run end to end. Three
 * findings came out of doing that:
 *
 *   #122 `reviewSubmitted` on the order was set to true by the first review of
 *        ANY item, and the order detail page reads
 *        `canReview = delivered && !reviewSubmitted`. So on a multi-item order
 *        the buyer reviewed one product and the control disappeared — the rest
 *        could never be reviewed, while this action's own duplicate guard is per
 *        (buyer, order, PRODUCT) and plainly expects one review each. The
 *        control's link was hardcoded to `items[0]` as well, so both halves had
 *        to move: the flag now means "every item reviewed", and the link walks
 *        to the next unreviewed item.
 *
 *   #123 `if (rating < 1 || rating > 5)` is a comparison, not a validation.
 *        NaN passes both tests, and so does the STRING "5" — and a server
 *        action's parameter types are erased at the wire. A NaN makes a
 *        product's whole average NaN; a string makes
 *        getSellerReviewSummaryAction's `total += r` CONCATENATE, so two
 *        five-star reviews became an average of 27.5 out of 5.
 *
 *   #124 The pending-review queue was gated on isAdmin(), true for all ten admin
 *        roles, while moderating those same rows requires
 *        "marketplace:moderate_reviews". getProductReviewsAction used isAdmin()
 *        the same way to decide who may ask for pending and REJECTED reviews.
 *        The reader was wider than the writer on the same data.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { isValidReviewRating, orderedProductIds } from '@/lib/product-rating';

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

let store: FakeDbHandle;

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const ORDER = 'order-1';

const ORDERS = COLLECTIONS.MARKETPLACE_ORDERS;
const PRODUCT_REVIEWS = COLLECTIONS.PRODUCT_REVIEWS;
const SELLER_REVIEWS = COLLECTIONS.SELLER_REVIEWS;
const PRODUCTS = COLLECTIONS.PRODUCTS;

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(BUYER);
});

const reviews = () => import('@/app/actions/marketplace/_reviews');

/** A delivered order for two products from one seller. */
const seedOrder = (over: Record<string, unknown> = {}) =>
    store.seed(ORDERS, ORDER, {
        orderId: ORDER, buyerId: BUYER, sellerId: SELLER, sellerIds: [SELLER],
        status: 'delivered',
        items: [
            { productId: 'p1', quantity: 1, sellerId: SELLER, pricePerUnit: 1000 },
            { productId: 'p2', quantity: 2, sellerId: SELLER, pricePerUnit: 500 },
        ],
        reviewSubmitted: false,
        ...over,
    });

const seedProducts = () => {
    store.seed(PRODUCTS, 'p1', { sellerId: SELLER, title: 'Cocoa', rating: 0, reviewCount: 0 });
    store.seed(PRODUCTS, 'p2', { sellerId: SELLER, title: 'Yam', rating: 0, reviewCount: 0 });
};

const submitProduct = async (over: Record<string, unknown> = {}) =>
    (await (await reviews()).submitProductReviewAction({
        productId: 'p1', orderId: ORDER, rating: 5, comment: 'Excellent', ...over,
    } as never)) as any;

const submitSeller = async (over: Record<string, unknown> = {}) =>
    (await (await reviews()).submitSellerReviewAction({
        sellerId: SELLER, orderId: ORDER, rating: 4, comment: 'Good seller', ...over,
    } as never)) as any;

const order = () => store.get(ORDERS, ORDER) as Record<string, any>;

// ─────────────────────────────────────────────────────────────────────────────
describe('the rating rule itself', () => {
    it.each([1, 2, 3, 4, 5])('accepts %p', (r) => {
        expect(isValidReviewRating(r)).toBe(true);
    });

    it.each([0, 6, -1, 4.7, NaN, Infinity, '5', '', null, undefined, {}])(
        'refuses %p', (r) => {
            expect(isValidReviewRating(r)).toBe(false);
        });

    it('reads both item spellings when listing an order\'s products', () => {
        expect(orderedProductIds({ items: [{ productId: 'a' }, { id: 'b' }, {}] })).toEqual(['a', 'b']);
        expect(orderedProductIds({})).toEqual([]);
        expect(orderedProductIds(null)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitProductReviewAction', () => {
    beforeEach(() => { seedOrder(); seedProducts(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await submitProduct()).toMatchObject({ success: false });
        expect(store.size(PRODUCT_REVIEWS)).toBe(0);
    });

    it('refuses an order that does not exist', async () => {
        expect(await submitProduct({ orderId: 'nope' })).toMatchObject({
            success: false, error: 'Order not found',
        });
    });

    it('refuses somebody else\'s order', async () => {
        seedOrder({ buyerId: 'another-buyer' });
        expect(await submitProduct()).toMatchObject({ success: false, error: 'Unauthorized: not your order' });
    });

    it.each(['pending_payment', 'processing', 'shipped', 'cancelled'])(
        'refuses to review a %s order', async (status) => {
            seedOrder({ status });
            expect(await submitProduct()).toMatchObject({ success: false });
            expect(store.size(PRODUCT_REVIEWS)).toBe(0);
        });

    it.each(['delivered', 'completed'])('reviews from %s — the shared set', async (status) => {
        seedOrder({ status });
        expect(await submitProduct()).toMatchObject({ success: true });
    });

    it('refuses a product that was not in the order', async () => {
        // One delivered order used to license a review of any product on the
        // platform, written with verified: true.
        expect(await submitProduct({ productId: 'not-in-this-order' })).toMatchObject({
            success: false, error: 'That product was not part of this order',
        });
        expect(store.size(PRODUCT_REVIEWS)).toBe(0);
    });

    // ── #123 ────────────────────────────────────────────────────────────────
    it.each([NaN, '5' as unknown as number, 4.7, 0, 6, null as unknown as number])(
        'REFUSES THE RATING %p', async (rating) => {
            const res = await submitProduct({ rating });

            expect(res.success).toBe(false);
            expect(String(res.error)).toMatch(/whole number between 1 and 5/i);
            expect(store.size(PRODUCT_REVIEWS)).toBe(0);
        });

    it('writes the review pending, verified, under both identity spellings', async () => {
        expect(await submitProduct()).toMatchObject({ success: true });

        const [, review] = store.all(PRODUCT_REVIEWS)[0];
        expect(review).toMatchObject({
            productId: 'p1', orderId: ORDER, rating: 5,
            userId: BUYER, buyerId: BUYER,
            status: 'pending', verified: true, helpful: 0,
        });
    });

    it('cannot review the same product on the same order twice', async () => {
        expect((await submitProduct()).success).toBe(true);
        expect((await submitProduct()).success).toBe(false);
        expect(store.size(PRODUCT_REVIEWS)).toBe(1);
    });

    // ── #122 ────────────────────────────────────────────────────────────────
    it('LEAVES THE ORDER REVIEWABLE WHILE AN ITEM IS UNREVIEWED', async () => {
        // reviewSubmitted was set true by the first review of any item, and the
        // order page reads it as "nothing left to review" — so the second
        // product could never be reviewed.
        await submitProduct({ productId: 'p1' });

        expect(order().reviewSubmitted).toBe(false);
        expect(order().reviewedProductIds).toEqual(['p1']);
    });

    it('and marks it done only when every item has been reviewed', async () => {
        await submitProduct({ productId: 'p1' });
        await submitProduct({ productId: 'p2' });

        expect(order().reviewSubmitted).toBe(true);
        expect((order().reviewedProductIds as string[]).sort()).toEqual(['p1', 'p2']);
    });

    it('marks a single-item order done on its one review', async () => {
        seedOrder({ items: [{ productId: 'p1', quantity: 1, sellerId: SELLER }] });

        await submitProduct({ productId: 'p1' });

        expect(order().reviewSubmitted).toBe(true);
    });

    it('recomputes the flag from the reviews, so a lost write self-heals', async () => {
        // The flag is derived, not accumulated: a review that landed without
        // updating the order is picked up by the next one.
        store.seed(PRODUCT_REVIEWS, 'orphan', {
            productId: 'p1', orderId: ORDER, userId: 'someone', buyerId: 'someone',
            rating: 4, status: 'approved',
        });

        await submitProduct({ productId: 'p2' });

        expect((order().reviewedProductIds as string[]).sort()).toEqual(['p1', 'p2']);
        expect(order().reviewSubmitted).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitSellerReviewAction', () => {
    beforeEach(() => { seedOrder(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await submitSeller()).toMatchObject({ success: false });
    });

    it('refuses a seller who was not on the order', async () => {
        expect(await submitSeller({ sellerId: 'another-seller' })).toMatchObject({
            success: false, error: 'Seller does not match this order',
        });
    });

    it.each([NaN, '4' as unknown as number, 3.5, 0, 6])('REFUSES THE RATING %p', async (rating) => {
        expect(await submitSeller({ rating })).toMatchObject({ success: false });
        expect(store.size(SELLER_REVIEWS)).toBe(0);
    });

    it('writes it pending and verified', async () => {
        expect(await submitSeller()).toMatchObject({ success: true });

        const [, review] = store.all(SELLER_REVIEWS)[0];
        expect(review).toMatchObject({
            sellerId: SELLER, buyerId: BUYER, orderId: ORDER,
            rating: 4, status: 'pending', verified: true,
        });
    });

    it('cannot review the same seller on the same order twice', async () => {
        expect((await submitSeller()).success).toBe(true);
        expect((await submitSeller()).success).toBe(false);
        expect(store.size(SELLER_REVIEWS)).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getProductReviewsAction', () => {
    const read = async (status?: string) =>
        (await (await reviews()).getProductReviewsAction(
            'p1',
            // Deliberately untyped: a server action's parameters are erased at
            // the wire, which is the whole point of the status test below.
            (status ? { status } : undefined) as never,
        )) as any;

    beforeEach(() => {
        store.seedAll(PRODUCT_REVIEWS, {
            ok: { productId: 'p1', rating: 5, status: 'approved', comment: 'Great', createdAt: '2026-03-01T00:00:00.000Z' },
            waiting: { productId: 'p1', rating: 1, status: 'pending', comment: 'Unmoderated', createdAt: '2026-03-02T00:00:00.000Z' },
            refused: { productId: 'p1', rating: 1, status: 'rejected', comment: 'Rejected slur', createdAt: '2026-03-03T00:00:00.000Z' },
        });
    });

    it('serves approved reviews to anybody', async () => {
        actAs(null);
        const res = await read();
        expect(res.data.reviews.map((r: any) => r.id)).toEqual(['ok']);
    });

    // ── #124 ────────────────────────────────────────────────────────────────
    it.each(['pending', 'rejected'])(
        'REFUSES TO SERVE %s REVIEWS TO A CALLER WHO CANNOT MODERATE', async (status) => {
            // `status` went from the caller straight into the query, so anybody
            // could read reviews awaiting moderation and ones a moderator had
            // explicitly rejected.
            actAs('nosy-1');

            const res = await read(status);
            expect(res.data.reviews.map((r: any) => r.id)).toEqual(['ok']);
        });

    it('refuses an admin role without the moderation permission too', async () => {
        // isAdmin() is true for all ten admin roles.
        actAs('academy-1', ['academy_admin']);

        expect((await read('pending')).data.reviews.map((r: any) => r.id)).toEqual(['ok']);
    });

    it('serves them to a moderator', async () => {
        actAs('mod-1', ['marketplace_admin']);

        expect((await read('pending')).data.reviews.map((r: any) => r.id)).toEqual(['waiting']);
        expect((await read('rejected')).data.reviews.map((r: any) => r.id)).toEqual(['refused']);
    });

    it('shows only this product\'s reviews', async () => {
        store.seed(PRODUCT_REVIEWS, 'other', { productId: 'p2', rating: 5, status: 'approved' });

        actAs(null);
        expect((await read()).data.reviews.map((r: any) => r.id)).toEqual(['ok']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getSellerReviewSummaryAction', () => {
    const summary = async (sellerId = SELLER) =>
        (await (await reviews()).getSellerReviewSummaryAction(sellerId)) as any;

    it('reports zero for a seller with no approved reviews', async () => {
        const res = await summary();
        expect(res.data.summary).toMatchObject({ averageRating: 0, totalReviews: 0 });
    });

    it('averages the approved ones only', async () => {
        store.seedAll(SELLER_REVIEWS, {
            a: { sellerId: SELLER, rating: 5, status: 'approved' },
            b: { sellerId: SELLER, rating: 4, status: 'approved' },
            pending: { sellerId: SELLER, rating: 1, status: 'pending' },
            rejected: { sellerId: SELLER, rating: 1, status: 'rejected' },
        });

        const res = await summary();
        expect(res.data.summary).toMatchObject({
            averageRating: 4.5, totalReviews: 2,
            distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 1 },
        });
    });

    // ── #123, the reading half ──────────────────────────────────────────────
    it('DOES NOT CONCATENATE A RATING STORED AS A STRING', async () => {
        // `total += d.data().rating` on the string "5" is string concatenation:
        // two five-star reviews made total "055" and the average 27.5 out of 5.
        store.seedAll(SELLER_REVIEWS, {
            a: { sellerId: SELLER, rating: '5', status: 'approved' },
            b: { sellerId: SELLER, rating: '5', status: 'approved' },
        });

        expect((await summary()).data.summary.averageRating).toBe(5);
    });

    it('skips a rating it cannot read at all', async () => {
        store.seedAll(SELLER_REVIEWS, {
            a: { sellerId: SELLER, rating: 4, status: 'approved' },
            broken: { sellerId: SELLER, rating: 'four', status: 'approved' },
        });

        const res = await summary();
        expect(res.data.summary).toMatchObject({ averageRating: 4, totalReviews: 1 });
    });

    it('never reports another seller\'s reviews', async () => {
        store.seed(SELLER_REVIEWS, 'other', { sellerId: 'seller-2', rating: 1, status: 'approved' });

        expect((await summary()).data.summary.totalReviews).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('moderateReviewAction', () => {
    const moderate = async (
        id = 'rev-1',
        collection = 'product_reviews',
        action = 'approved',
        note?: string,
    ) => (await (await reviews()).moderateReviewAction(id as never, collection as never, action as never, note)) as any;

    beforeEach(() => {
        actAs('mod-1', ['marketplace_admin']);
        seedProducts();
        store.seed(PRODUCT_REVIEWS, 'rev-1', {
            productId: 'p1', orderId: ORDER, userId: BUYER, buyerId: BUYER,
            rating: 5, status: 'pending', comment: 'Great',
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await moderate()).toMatchObject({ success: false });
    });

    it('refuses an admin role without the moderation permission', async () => {
        actAs('academy-1', ['academy_admin']);
        expect(await moderate()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.get(PRODUCT_REVIEWS, 'rev-1')?.status).toBe('pending');
    });

    it.each(['deleted', 'spam', '', 'APPROVED'])('refuses the moderation action %p', async (action) => {
        const res = await moderate('rev-1', 'product_reviews', action);
        expect(res.success).toBe(false);
        expect(store.get(PRODUCT_REVIEWS, 'rev-1')?.status).toBe('pending');
    });

    it('refuses a review that does not exist', async () => {
        expect(await moderate('nope')).toMatchObject({ success: false, error: 'Review not found' });
    });

    it('approves, recording who and when', async () => {
        expect(await moderate('rev-1', 'product_reviews', 'approved', 'Looks genuine')).toMatchObject({ success: true });

        expect(store.get(PRODUCT_REVIEWS, 'rev-1')).toMatchObject({
            status: 'approved', moderatedBy: 'mod-1', adminNote: 'Looks genuine',
        });
    });

    it('writes the product rating on approval', async () => {
        await moderate();

        expect(store.get(PRODUCTS, 'p1')).toMatchObject({ rating: 5, reviewCount: 1 });
    });

    it('AND TAKES IT BACK OUT ON REJECTION', async () => {
        // Recalculating only on approval left a rejected review's contribution
        // in the average, so removing a fake five-star changed nothing a buyer
        // could see — the one thing this queue is for.
        await moderate('rev-1', 'product_reviews', 'approved');
        expect(store.get(PRODUCTS, 'p1')?.rating).toBe(5);

        await moderate('rev-1', 'product_reviews', 'rejected');

        expect(store.get(PRODUCTS, 'p1')).toMatchObject({ rating: 0, reviewCount: 0 });
    });

    it('records the decision in the audit log', async () => {
        await moderate('rev-1', 'product_reviews', 'rejected', 'Fake');

        expect((globalThis as unknown as { mockRecordAdminAction: jest.Mock<any> }).mockRecordAdminAction)
            .toHaveBeenCalledWith(expect.objectContaining({
                action: 'review_moderate', userId: 'mod-1', targetId: 'rev-1',
            }));
    });

    it('moderates a seller review without touching any product rating', async () => {
        store.seed(SELLER_REVIEWS, 'srev-1', { sellerId: SELLER, buyerId: BUYER, rating: 4, status: 'pending' });

        expect(await moderate('srev-1', 'seller_reviews', 'approved')).toMatchObject({ success: true });
        expect(store.get(SELLER_REVIEWS, 'srev-1')?.status).toBe('approved');
        expect(store.get(PRODUCTS, 'p1')?.rating).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getPendingReviewsAction', () => {
    const pending = async () => (await (await reviews()).getPendingReviewsAction()) as any;

    beforeEach(() => {
        store.seed(PRODUCT_REVIEWS, 'rev-1', { productId: 'p1', rating: 1, status: 'pending', comment: 'Unmoderated' });
        store.seed(SELLER_REVIEWS, 'srev-1', { sellerId: SELLER, rating: 1, status: 'pending' });
        store.seed(PRODUCT_REVIEWS, 'done', { productId: 'p1', rating: 5, status: 'approved' });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await pending()).toMatchObject({ success: false });
    });

    it('refuses an ordinary user', async () => {
        expect(await pending()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    // ── #124 ────────────────────────────────────────────────────────────────
    it.each(['academy_admin', 'export_admin', 'wave_admin', 'support'])(
        'REFUSES %s, WHO CANNOT MODERATE THESE ROWS', async (role) => {
            // The queue holds unmoderated buyer comments and images, and was
            // gated on isAdmin() — true for all ten admin roles — while acting
            // on them requires marketplace:moderate_reviews.
            actAs('other-admin', [role]);

            expect(await pending()).toMatchObject({ success: false, error: 'Unauthorized' });
        });

    it.each(['marketplace_admin', 'moderator', 'super_admin', 'admin'])(
        'serves %s, who can', async (role) => {
            actAs('mod-1', [role]);

            const res = await pending();
            expect(res.success).toBe(true);
            expect(res.data.productReviews.map((r: any) => r.id)).toEqual(['rev-1']);
            expect(res.data.sellerReviews.map((r: any) => r.id)).toEqual(['srev-1']);
        });
});
