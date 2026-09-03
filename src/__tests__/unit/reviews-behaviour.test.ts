/**
 * @jest-environment node
 */

/**
 * Product and seller reviews, EXECUTED — write, read, edit, moderate, and the
 * ratings the whole marketplace displays.
 *
 * At 43.3% statements / 29.5% branches. One finding was located by running it:
 *
 *   #99  /api/marketplace/sellers/[sellerId] aggregated SELLER_REVIEWS with no
 *        status filter, so the public seller rating included reviews awaiting
 *        moderation AND reviews a moderator had rejected.
 *        getSellerReviewSummaryAction computes the same average from the same
 *        collection filtered to "approved" — two readers of one fact, with the
 *        permissive one on the public route.
 *
 * The rest of this suite executes what earlier findings only asserted
 * structurally: the two identity spellings (#47), the shared reviewable-status
 * rule, the ratings recalculation on BOTH moderation decisions, and the
 * edit-window rule failing CLOSED on an unreadable date.
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

let store: FakeDbHandle;

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const PRODUCT = 'product-1';
const ORDER = 'order-1';

const REVIEWS = COLLECTIONS.PRODUCT_REVIEWS;
const SELLER_REVIEWS = COLLECTIONS.SELLER_REVIEWS;
const PRODUCTS = COLLECTIONS.PRODUCTS;
const ORDERS = COLLECTIONS.MARKETPLACE_ORDERS;

const COMMENT = 'This is a perfectly reasonable review of the product.';

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: 'ada@example.com', name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(BUYER);
});

async function actions() {
    return import('@/app/actions/reviews');
}

const seedOrder = (status = 'delivered', extra: Record<string, unknown> = {}) =>
    store.seed(ORDERS, ORDER, {
        buyerId: BUYER, sellerId: SELLER, status,
        items: [{ productId: PRODUCT, quantity: 1 }], ...extra,
    });

const seedProduct = (extra: Record<string, unknown> = {}) =>
    store.seed(PRODUCTS, PRODUCT, { sellerId: SELLER, name: 'Cocoa', ...extra });

// ─────────────────────────────────────────────────────────────────────────────
describe('createReviewAction', () => {
    const create = async (over: Record<string, unknown> = {}) =>
        (await (await actions()).createReviewAction({
            productId: PRODUCT, orderId: ORDER, rating: 5, comment: COMMENT, ...over,
        })) as any;

    beforeEach(() => { seedOrder(); seedProduct(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await create()).toMatchObject({ success: false });
        expect(store.size(REVIEWS)).toBe(0);
    });

    it.each([0, 6, -1, 5.5, NaN])('refuses a rating of %s', async (rating) => {
        expect((await create({ rating })).success).toBe(false);
        expect(store.size(REVIEWS)).toBe(0);
    });

    it('refuses a comment under 20 characters or over 500', async () => {
        expect((await create({ comment: 'too short' })).success).toBe(false);
        expect((await create({ comment: 'x'.repeat(501) })).success).toBe(false);
        expect(store.size(REVIEWS)).toBe(0);
    });

    it('refuses an order that is not the caller\'s', async () => {
        seedOrder('delivered', { buyerId: 'somebody-else' });
        expect(await create()).toMatchObject({ success: false, error: 'Not authorized' });
    });

    it.each(['pending_payment', 'processing', 'shipped', 'cancelled'])(
        'refuses a %s order', async (status) => {
            seedOrder(status);
            expect((await create()).success).toBe(false);
            expect(store.size(REVIEWS)).toBe(0);
        });

    it.each(['delivered', 'completed'])(
        'ACCEPTS a %s order — the shared rule, not one page\'s', async (status) => {
            // This required "completed" while submitProductReviewAction, against
            // the same collection, accepted "delivered" or "completed". Whether a
            // delivered order could be reviewed depended on which page the buyer
            // was on.
            seedOrder(status);
            expect((await create()).success).toBe(true);
        });

    it('refuses a product that is not in the order', async () => {
        expect(await create({ productId: 'other-product' })).toMatchObject({
            success: false, error: 'Product not found in order',
        });
    });

    it('refuses when the product has been removed from the platform', async () => {
        store.clear();
        seedOrder();
        expect((await create()).success).toBe(false);
    });

    it('WRITES BOTH IDENTITY SPELLINGS, so either duplicate guard finds it', async () => {
        // #47. This module writes `userId` and the marketplace one writes
        // `buyerId`; each guard queried only its own field, so a buyer could
        // leave one review per product per order through EACH page.
        expect((await create()).success).toBe(true);

        const [, review] = store.all(REVIEWS)[0];
        expect(review).toMatchObject({
            productId: PRODUCT, orderId: ORDER, sellerId: SELLER,
            userId: BUYER, buyerId: BUYER,
            rating: 5, verified: true, status: 'pending',
        });
    });

    it('refuses a SECOND review of the same product on the same order', async () => {
        expect((await create()).success).toBe(true);
        expect(await create()).toMatchObject({
            success: false, error: 'You have already reviewed this product from this order',
        });
        expect(store.size(REVIEWS)).toBe(1);
    });

    it('and finds a review written under the OTHER module\'s field alone', async () => {
        // The pre-existing rows carry whichever field their path wrote.
        store.seed(REVIEWS, 'legacy', {
            buyerId: BUYER, productId: PRODUCT, orderId: ORDER, rating: 1, status: 'approved',
        });

        expect((await create()).success).toBe(false);
    });

    it('attributes the review to the PRODUCT\'s seller, not the order\'s', async () => {
        // The single-seller cart assumption: a multi-seller order would have
        // credited every review to one of them.
        seedProduct({ sellerId: 'the-real-seller' });
        await create();

        expect(store.all(REVIEWS)[0][1].sellerId).toBe('the-real-seller');
    });

    it('escapes the comment rather than storing markup', async () => {
        await create({ comment: '<script>alert(1)</script> and a long enough tail here' });
        expect(String(store.all(REVIEWS)[0][1].comment)).not.toContain('<script>');
    });

    it.each([
        ['javascript:alert(1)'],
        ['data:image/png;base64,AAAA'],
        ['//evil.example/x.png'],
        ['http://insecure.example/x.png'],
    ])('refuses an image reference of %s', async (image) => {
        expect((await create({ images: [image] })).success).toBe(false);
        expect(store.size(REVIEWS)).toBe(0);
    });

    it.each([['https://cdn.example/x.png'], ['/uploads/x.png']])(
        'accepts %s', async (image) => {
            expect((await create({ images: [image] })).success).toBe(true);
        });

    it('caps the number of images', async () => {
        const nine = Array.from({ length: 9 }, (_, i) => `https://cdn.example/${i}.png`);
        expect((await create({ images: nine })).success).toBe(false);

        expect((await create({ images: nine.slice(0, 8) })).success).toBe(true);
    });

    it('refuses images that are not a list', async () => {
        expect((await create({ images: 'https://cdn.example/x.png' })).success).toBe(false);
    });

    it('does NOT move the product rating — a new review is unmoderated', async () => {
        await create();
        expect(store.get(PRODUCTS, PRODUCT)?.rating).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getProductReviewsAction', () => {
    const read = async (filters?: Record<string, unknown>) =>
        (await (await actions()).getProductReviewsAction(PRODUCT, filters as never)) as any;

    beforeEach(() => {
        store.seedAll(REVIEWS, {
            ok: { productId: PRODUCT, status: 'approved', rating: 5, verified: true, createdAt: '2026-02-01T00:00:00.000Z' },
            alsoOk: { productId: PRODUCT, status: 'approved', rating: 3, verified: false, createdAt: '2026-03-01T00:00:00.000Z' },
            unmoderated: { productId: PRODUCT, status: 'pending', rating: 1, createdAt: '2026-04-01T00:00:00.000Z' },
            binned: { productId: PRODUCT, status: 'rejected', rating: 1, createdAt: '2026-05-01T00:00:00.000Z' },
            other: { productId: 'other', status: 'approved', rating: 5, createdAt: '2026-01-01T00:00:00.000Z' },
        });
    });

    it('is public — no session required', async () => {
        actAs(null);
        expect((await read()).success).toBe(true);
    });

    it('shows APPROVED reviews of this product only', async () => {
        expect((await read()).data.reviews.map((r: any) => r.id).sort())
            .toEqual(['alsoOk', 'ok']);
    });

    it('newest first', async () => {
        expect((await read()).data.reviews.map((r: any) => r.id)).toEqual(['alsoOk', 'ok']);
    });

    it('filters by rating', async () => {
        expect((await read({ rating: 5 })).data.reviews.map((r: any) => r.id)).toEqual(['ok']);
    });

    it('filters by verified', async () => {
        expect((await read({ verified: true })).data.reviews.map((r: any) => r.id)).toEqual(['ok']);
        expect((await read({ verified: false })).data.reviews.map((r: any) => r.id)).toEqual(['alsoOk']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getUserReviewsAction', () => {
    const mine = async () => (await (await actions()).getUserReviewsAction()) as any;

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await mine()).toMatchObject({ success: false });
    });

    it('FINDS REVIEWS UNDER EITHER IDENTITY SPELLING, once each', async () => {
        // This queried `userId` alone, so a review left through the marketplace
        // page — which carries `buyerId` — was invisible on its own author's
        // page. New rows carry both, so the dedupe is what stops them appearing
        // twice.
        store.seedAll(REVIEWS, {
            oldStyle: { userId: BUYER, rating: 5, createdAt: '2026-01-01T00:00:00.000Z' },
            otherStyle: { buyerId: BUYER, rating: 4, createdAt: '2026-02-01T00:00:00.000Z' },
            newStyle: { userId: BUYER, buyerId: BUYER, rating: 3, createdAt: '2026-03-01T00:00:00.000Z' },
            somebodyElse: { userId: 'stranger', buyerId: 'stranger', rating: 1, createdAt: '2026-04-01T00:00:00.000Z' },
        });

        const ids = (await mine()).data.reviews.map((r: any) => r.id);
        expect(ids).toEqual(['newStyle', 'otherStyle', 'oldStyle']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('updateReviewAction', () => {
    const edit = async (id = 'r1', rating = 2, comment = COMMENT) =>
        (await (await actions()).updateReviewAction(id, rating, comment)) as any;

    const daysAgo = (n: number) =>
        new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

    beforeEach(() => {
        seedProduct();
        store.seed(REVIEWS, 'r1', {
            userId: BUYER, buyerId: BUYER, productId: PRODUCT, orderId: ORDER,
            rating: 5, comment: 'original', status: 'approved', createdAt: daysAgo(2),
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await edit()).toMatchObject({ success: false });
    });

    it('refuses a review that does not exist', async () => {
        expect(await edit('nope')).toMatchObject({ success: false, error: 'Review not found' });
    });

    it('refuses somebody else\'s review', async () => {
        actAs('stranger');
        expect(await edit()).toMatchObject({ success: false, error: 'Not authorized' });
        expect(store.get(REVIEWS, 'r1')?.rating).toBe(5);
    });

    it('LETS THE AUTHOR EDIT a review written under the buyerId spelling alone', async () => {
        // The ownership test read `userId` alone, so a review carrying only
        // `buyerId` had `review.userId === undefined` and its own author was
        // refused — the check turned away the owner rather than an impostor.
        store.seed(REVIEWS, 'r1', {
            buyerId: BUYER, productId: PRODUCT, rating: 5, status: 'approved', createdAt: daysAgo(2),
        });

        expect((await edit()).success).toBe(true);
    });

    it('sends the edit back to moderation and recomputes the average WITHOUT it', async () => {
        // Otherwise editing a five-star to one star kept the five in the
        // product's average until a moderator happened to approve the new text.
        store.seed(PRODUCTS, PRODUCT, { sellerId: SELLER, rating: 5, reviewCount: 1 });

        expect((await edit('r1', 1)).success).toBe(true);

        expect(store.get(REVIEWS, 'r1')).toMatchObject({ rating: 1, status: 'pending' });
        expect(store.get(PRODUCTS, PRODUCT)).toMatchObject({ rating: 0, reviewCount: 0 });
    });

    it('refuses an edit after 30 days', async () => {
        store.seed(REVIEWS, 'r1', {
            userId: BUYER, productId: PRODUCT, rating: 5, status: 'approved', createdAt: daysAgo(31),
        });

        expect(await edit()).toMatchObject({
            success: false, error: 'Reviews can only be edited within 30 days',
        });
    });

    it('FAILS CLOSED when the date cannot be read', async () => {
        // This fell back to `new Date()` for an unrecognised createdAt, which
        // made the review zero days old and permanently editable — and `'toDate'
        // in createdAt` THREW on a string or a null, so a serialised review
        // could not be edited at all.
        for (const createdAt of [null, undefined, 'not a date', {}]) {
            store.seed(REVIEWS, 'r1', {
                userId: BUYER, productId: PRODUCT, rating: 5, status: 'approved', createdAt,
            });

            const res = await edit();
            expect(res.success).toBe(false);
            expect(res.error).toContain('cannot be determined');
        }
    });

    it('and treats an epoch NUMBER as the date it is, not as unreadable', async () => {
        // toDateOrNull reads it. 0 is 1970, which is well outside the window —
        // refused as too old rather than as unreadable, and that distinction is
        // the point of returning null only when the shape is genuinely unknown.
        store.seed(REVIEWS, 'r1', {
            userId: BUYER, productId: PRODUCT, rating: 5, status: 'approved', createdAt: 0,
        });

        expect(await edit()).toMatchObject({
            success: false, error: 'Reviews can only be edited within 30 days',
        });
    });

    it('accepts every shape the read paths in this file coerce', async () => {
        const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
        for (const createdAt of [
            recent.toISOString(),
            { seconds: Math.floor(recent.getTime() / 1000) },
            { _seconds: Math.floor(recent.getTime() / 1000) },
        ]) {
            store.seed(REVIEWS, 'r1', {
                userId: BUYER, productId: PRODUCT, rating: 5, status: 'approved', createdAt,
            });

            expect((await edit()).success).toBe(true);
        }
    });

    it('still validates the new rating and comment', async () => {
        expect((await edit('r1', 9)).success).toBe(false);
        expect((await edit('r1', 3, 'short')).success).toBe(false);
        expect(store.get(REVIEWS, 'r1')?.rating).toBe(5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('moderateReviewAction — and the product rating nobody used to write', () => {
    const moderate = async (status: 'approved' | 'rejected', id = 'r1', reason?: string) =>
        (await (await actions()).moderateReviewAction(id, status, reason)) as any;

    beforeEach(() => {
        seedProduct();
        store.seedAll(COLLECTIONS.USERS, {
            'admin-1': { roles: ['admin'] },
            'super-1': { roles: ['super_admin'] },
            'mod-1': { roles: ['moderator'] },
            'mkt-1': { roles: ['marketplace_admin'] },
            [BUYER]: { roles: ['general_user'] },
        });
        store.seed(REVIEWS, 'r1', {
            userId: BUYER, productId: PRODUCT, rating: 4, status: 'pending',
        });
        actAs('admin-1', ['admin']);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await moderate('approved')).toMatchObject({ success: false });
    });

    it.each([['mod-1', 'moderator'], ['mkt-1', 'marketplace_admin']])(
        'ADMITS %s, WHICH THE MATRIX SAYS OWNS THIS JOB', async (id, role) => {
            //   #265 These two were refused, under a note explaining that
            //        switching to isAdmin() "would admit moderator, support and
            //        every module admin". True of isAdmin(), and not the
            //        choice. marketplace:moderate_reviews is granted to
            //        super_admin, admin, moderator and marketplace_admin — not
            //        support, not every module admin. The role literally named
            //        "moderator" could not moderate.
            actAs(id, [role]);

            expect(await moderate('approved')).toMatchObject({ success: true });
            expect(store.get(REVIEWS, 'r1')?.status).toBe('approved');
        });

    it.each([[BUYER, 'general_user'], ['sup-1', 'support'], ['wave-1', 'wave_admin']])(
        'refuses %s', async (id, role) => {
            actAs(id, [role]);
            expect(await moderate('approved')).toMatchObject({ success: false });
            expect(store.get(REVIEWS, 'r1')?.status).toBe('pending');
        });

    it('admits a super_admin who does not also hold the plain admin role', async () => {
        actAs('super-1', ['super_admin']);
        expect((await moderate('approved')).success).toBe(true);
    });

    it('WRITES THE PRODUCT RATING on approval — nothing used to', async () => {
        // The moderator the admin page calls updated the review's status and
        // nothing else; the recalculation lived in the OTHER review module,
        // called from ITS moderator, which no page calls. So every product sat
        // at 0/0 however many approved reviews it had, and the card renders a
        // rating only when rating > 0.
        expect((await moderate('approved')).success).toBe(true);

        expect(store.get(REVIEWS, 'r1')).toMatchObject({
            status: 'approved', moderatedBy: 'admin-1',
        });
        expect(store.get(PRODUCTS, PRODUCT)).toMatchObject({ rating: 4, reviewCount: 1 });
    });

    it('and RECOMPUTES on rejection too', async () => {
        // Rejecting a review that had already been approved left its
        // contribution in the average, so removing a fake five-star changed
        // nothing a buyer could see.
        store.seedAll(REVIEWS, {
            r1: { productId: PRODUCT, rating: 5, status: 'approved' },
            r2: { productId: PRODUCT, rating: 1, status: 'approved' },
        });

        expect((await moderate('rejected', 'r1', 'fake')).success).toBe(true);

        expect(store.get(REVIEWS, 'r1')).toMatchObject({
            status: 'rejected', rejectionReason: 'fake',
        });
        expect(store.get(PRODUCTS, PRODUCT)).toMatchObject({ rating: 1, reviewCount: 1 });
    });

    it('writes 0/0 when the last approved review is withdrawn', async () => {
        store.seed(REVIEWS, 'r1', { productId: PRODUCT, rating: 5, status: 'approved' });
        store.seed(PRODUCTS, PRODUCT, { sellerId: SELLER, rating: 5, reviewCount: 1 });

        await moderate('rejected', 'r1');

        expect(store.get(PRODUCTS, PRODUCT)).toMatchObject({ rating: 0, reviewCount: 0 });
    });

    it('averages to one decimal place', async () => {
        store.seedAll(REVIEWS, {
            r1: { productId: PRODUCT, rating: 4, status: 'pending' },
            r2: { productId: PRODUCT, rating: 5, status: 'approved' },
            r3: { productId: PRODUCT, rating: 5, status: 'approved' },
        });

        await moderate('approved', 'r1');
        // (4 + 5 + 5) / 3 = 4.666...
        expect(store.get(PRODUCTS, PRODUCT)?.rating).toBe(4.7);
    });

    it('refuses a review that does not exist', async () => {
        expect(await moderate('approved', 'nope')).toMatchObject({
            success: false, error: 'Review not found',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getSellerRatingAction', () => {
    const rating = async (id = SELLER) =>
        (await (await actions()).getSellerRatingAction(id)) as any;

    it('is zero for a seller with no approved reviews', async () => {
        store.seed(REVIEWS, 'r1', { sellerId: SELLER, rating: 5, status: 'pending' });

        expect((await rating()).data).toEqual({
            averageRating: 0, totalReviews: 0,
            distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        });
    });

    it('averages the APPROVED ones and reports the distribution', async () => {
        store.seedAll(REVIEWS, {
            a: { sellerId: SELLER, rating: 5, status: 'approved' },
            b: { sellerId: SELLER, rating: 4, status: 'approved' },
            c: { sellerId: SELLER, rating: 1, status: 'rejected' },
            d: { sellerId: 'other', rating: 1, status: 'approved' },
        });

        expect((await rating()).data).toEqual({
            averageRating: 4.5, totalReviews: 2,
            distribution: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getAdminReviewsAction', () => {
    const list = async (options: Record<string, unknown> = {}) =>
        (await (await actions()).getAdminReviewsAction(options as never)) as any;

    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            'admin-1': { roles: ['admin'] },
            'mod-1': { roles: ['moderator'] },
        });
        store.seedAll(REVIEWS, {
            p1: { productId: PRODUCT, status: 'pending', rating: 3, createdAt: '2026-03-01T00:00:00.000Z' },
            a1: { productId: PRODUCT, status: 'approved', rating: 5, createdAt: '2026-02-01T00:00:00.000Z' },
            x1: { productId: PRODUCT, status: 'rejected', rating: 1, createdAt: '2026-01-01T00:00:00.000Z' },
        });
        actAs('admin-1', ['admin']);
    });

    it('admits a moderator, and still refuses a role without the permission', async () => {
        // #265 The queue and the moderate button are one job, so they take one
        // permission. Support is the control: a role that holds neither.
        actAs('mod-1', ['moderator']);
        expect(await list()).toMatchObject({ success: true });

        actAs('sup-1', ['support']);
        expect(await list()).toMatchObject({ success: false });
    });

    it('returns everything newest first, with exact counts on the first page', async () => {
        const res = await list();

        expect(res.data.reviews.map((r: any) => r.id)).toEqual(['p1', 'a1', 'x1']);
        expect(res.data.stats).toEqual({ pending: 1, approved: 1, rejected: 1 });
    });

    it('filters by status', async () => {
        expect((await list({ statusFilter: 'pending' })).data.reviews.map((r: any) => r.id))
            .toEqual(['p1']);
    });

    it('reports hasMore and a cursor only when a further page exists', async () => {
        const page = await list({ limit: 2 });
        expect(page.data.hasMore).toBe(true);
        expect(page.data.lastDocId).toBe('a1');

        expect((await list({ limit: 10 })).data.hasMore).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the seller rating the public API reports', () => {
    // #99. The route aggregated SELLER_REVIEWS with NO status filter, so its
    // average included reviews awaiting moderation and reviews a moderator had
    // rejected — while getSellerReviewSummaryAction, computing the same figure
    // from the same collection, filtered to "approved". Two ratings for one
    // seller, and the permissive one was the public route.
    const summary = async (id = SELLER) =>
        (await (await import('@/app/actions/marketplace/_reviews'))
            .getSellerReviewSummaryAction(id)) as any;

    beforeEach(() => {
        store.seedAll(SELLER_REVIEWS, {
            good: { sellerId: SELLER, rating: 5, status: 'approved' },
            unmoderated: { sellerId: SELLER, rating: 1, status: 'pending' },
            binned: { sellerId: SELLER, rating: 1, status: 'rejected' },
        });
    });

    it('the summary action counts only the approved one', async () => {
        const res = await summary();
        expect(res.data.summary).toMatchObject({ averageRating: 5, totalReviews: 1 });
    });

    it('and the public route now applies the SAME filter', async () => {
        // Read off the source: the route is a Next handler wired to a request,
        // and what matters is that it no longer disagrees with the action above.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const src = stripComments(readFileSync(
            join(process.cwd(), 'src/app/api/marketplace/sellers/[sellerId]/route.ts'), 'utf8'));
        const block = src.slice(src.indexOf('SELLER_REVIEWS'), src.indexOf('reviewCount = reviewSnap.size'));

        expect(block).toContain('"status", "==", "approved"');
    });
});
