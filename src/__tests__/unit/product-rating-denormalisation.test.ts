/**
 * The product rating nothing ever wrote.
 *
 * TWO REVIEW SUBSYSTEMS, ONE COLLECTION
 * -------------------------------------
 *   actions/reviews.ts               createReviewAction, from
 *                                    /dashboard/reviews/new. Writes `userId`,
 *                                    required the order to be "completed".
 *
 *   actions/marketplace/_reviews.ts  submitProductReviewAction, from
 *                                    /marketplace/buyer/orders/[id]/review.
 *                                    Writes `buyerId`, accepted "delivered" or
 *                                    "completed".
 *
 * Both live, from different pages, into PRODUCT_REVIEWS. Each also exports a
 * `moderateReviewAction`, with different signatures.
 *
 * THE HEADLINE
 * ------------
 * `_recalculateProductRating` — the only code anywhere that wrote
 * `products.rating` and `products.reviewCount` — lived in _reviews.ts and was
 * called from ITS moderator. That moderator has no caller: /admin/marketplace/
 * reviews imports `moderateReviewAction` from actions/reviews.ts, which updated
 * the review's status and nothing else.
 *
 * So no product's rating was ever written. Every real product sat at 0/0 however
 * many approved reviews it had, and the card renders a rating only when
 * `rating > 0` — so no real product ever displayed one, and "Highest Rated"
 * sorting was meaningless across the whole catalogue.
 *
 * That completes the other half of the seller-trust defect: the flash-sale
 * mappers hardcoded `rating: 5`, so the only ratings the marketplace showed were
 * the invented ones.
 *
 * FOUR MORE IN THE SAME CLUSTER
 * -----------------------------
 * - `count === 0` returned early, so withdrawing the last approved review left
 *   the old rating in place permanently. The case where recalculating matters
 *   most was the one case skipped.
 * - The recalculation ran only on APPROVE. Rejecting an already-approved review
 *   left its contribution in the average, so removing a fake five-star changed
 *   nothing a buyer could see.
 * - The two duplicate guards queried different identity fields, so each was blind
 *   to the other's reviews: one review per product per order, per PAGE.
 * - updateReviewAction's ownership check read `userId` alone, so a review left
 *   through the marketplace page (which writes `buyerId`) could not be edited by
 *   its own author — the check refused the owner, not an impostor.
 * - _reviews.ts::getProductReviewsAction took `status` from the caller, so
 *   pending and REJECTED reviews were publicly readable with their comments and
 *   images, while the pending queue two functions below is admin-gated.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    recalculateProductRating,
    reviewerIdentityFields,
    hasExistingReview,
    isReviewableOrderStatus,
    REVIEWABLE_ORDER_STATUSES,
} from '@/lib/product-rating';

const LIVE = 'src/app/actions/reviews.ts';
const MARKET = 'src/app/actions/marketplace/_reviews.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** A db double that records what was written to the product. */
function fakeDb(reviews: Array<Record<string, any>>) {
    const writes: Array<Record<string, any>> = [];

    const query = (filters: Array<[string, any]>): any => ({
        where: (field: string, _op: string, value: any) => query([...filters, [field, value]]),
        get: async () => {
            const docs = reviews
                .filter((r) => filters.every(([f, v]) => r[f] === v))
                .map((r) => ({ data: () => r }));
            return { size: docs.length, docs };
        },
    });

    const db: any = {
        collection: (name: string) => ({
            ...query([]),
            doc: (id: string) => ({
                update: async (patch: Record<string, any>) => {
                    writes.push({ collection: name, id, ...patch });
                    return {};
                },
            }),
        }),
    };

    return { db, writes };
}

describe('recalculating an average', () => {
    it('writes the average of the APPROVED reviews', async () => {
        const { db, writes } = fakeDb([
            { productId: 'p1', status: 'approved', rating: 5 },
            { productId: 'p1', status: 'approved', rating: 4 },
            { productId: 'p1', status: 'pending', rating: 1 },
            { productId: 'p2', status: 'approved', rating: 1 },
        ]);

        const result = await recalculateProductRating(db, 'p1');

        expect(result).toEqual({ rating: 4.5, reviewCount: 2 });
        expect(writes[0]).toMatchObject({ id: 'p1', rating: 4.5, reviewCount: 2 });
    });

    it('writes ZERO when the last approved review is gone', async () => {
        // THE fix. The old version returned early on count 0, so a product kept
        // the rating a since-rejected review had produced, permanently.
        const { db, writes } = fakeDb([
            { productId: 'p1', status: 'rejected', rating: 5 },
        ]);

        const result = await recalculateProductRating(db, 'p1');

        expect(result).toEqual({ rating: 0, reviewCount: 0 });
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({ rating: 0, reviewCount: 0 });
    });

    it('and when there are no reviews at all', async () => {
        const { db, writes } = fakeDb([]);

        expect(await recalculateProductRating(db, 'p1')).toEqual({ rating: 0, reviewCount: 0 });
        expect(writes).toHaveLength(1);
    });

    it('ignores a review whose rating is not a number', async () => {
        // reviewCount still counts it — it is an approved review — but it must not
        // turn the average into NaN, which would render as nothing at all.
        const { db } = fakeDb([
            { productId: 'p1', status: 'approved', rating: 4 },
            { productId: 'p1', status: 'approved', rating: 'five' },
        ]);

        const result = await recalculateProductRating(db, 'p1');

        expect(Number.isFinite(result!.rating)).toBe(true);
        expect(result!.rating).toBe(2);
    });

    it('rounds to one decimal', async () => {
        const { db } = fakeDb([
            { productId: 'p1', status: 'approved', rating: 5 },
            { productId: 'p1', status: 'approved', rating: 4 },
            { productId: 'p1', status: 'approved', rating: 4 },
        ]);

        expect((await recalculateProductRating(db, 'p1'))!.rating).toBe(4.3);
    });

    it('never throws, and writes nothing, when the read fails', async () => {
        // A rating that failed to denormalise is a display problem. Failing the
        // moderation decision that triggered it would be worse, and that decision
        // is already committed by the time this runs.
        const db: any = {
            collection: () => ({
                where: () => { throw new Error('boom'); },
                doc: () => ({ update: async () => ({}) }),
            }),
        };

        await expect(recalculateProductRating(db, 'p1')).resolves.toBeNull();
    });

    it('counts from docs.length, not from snap.size', async () => {
        // Not a style point. The first version counted with `snap.size`; the test
        // harness returns `empty` and `docs` and no `size`, so `undefined > 0` was
        // false and the duplicate-review guard silently stopped detecting
        // duplicates. An existing suite caught it — this pins the lesson.
        const noSize: any = {
            collection: () => ({
                where: function () { return this; },
                get: async () => ({ docs: [{ data: () => ({ rating: 4 }) }] }), // no `size`
                doc: () => ({ update: async () => ({}) }),
            }),
        };

        expect(await recalculateProductRating(noSize, 'p1')).toEqual({ rating: 4, reviewCount: 1 });
        expect(await hasExistingReview(noSize, { userId: 'u1', productId: 'p1', orderId: 'o1' })).toBe(true);
    });

    it('does nothing for an empty productId', async () => {
        const { db, writes } = fakeDb([]);
        expect(await recalculateProductRating(db, '')).toBeNull();
        expect(writes).toHaveLength(0);
    });
});

describe('the duplicate guard sees both identity spellings', () => {
    it('finds a review written with userId', async () => {
        const { db } = fakeDb([{ userId: 'u1', productId: 'p1', orderId: 'o1' }]);
        expect(await hasExistingReview(db, { userId: 'u1', productId: 'p1', orderId: 'o1' })).toBe(true);
    });

    it('and one written with buyerId', async () => {
        // THE test. createReviewAction queried userId and never saw a review left
        // through the marketplace page, so a buyer got one review per page.
        const { db } = fakeDb([{ buyerId: 'u1', productId: 'p1', orderId: 'o1' }]);
        expect(await hasExistingReview(db, { userId: 'u1', productId: 'p1', orderId: 'o1' })).toBe(true);
    });

    it('and does not fire on a different order or product', async () => {
        // Vacuity guard: a check that returned true for everything would block
        // every review while passing both assertions above.
        const { db } = fakeDb([{ userId: 'u1', productId: 'p1', orderId: 'o1' }]);

        expect(await hasExistingReview(db, { userId: 'u1', productId: 'p1', orderId: 'o2' })).toBe(false);
        expect(await hasExistingReview(db, { userId: 'u1', productId: 'p2', orderId: 'o1' })).toBe(false);
        expect(await hasExistingReview(db, { userId: 'u2', productId: 'p1', orderId: 'o1' })).toBe(false);
    });

    it('and new reviews carry both fields', () => {
        expect(reviewerIdentityFields('u1')).toEqual({ userId: 'u1', buyerId: 'u1' });
    });
});

describe('one rule for which orders can be reviewed', () => {
    it('accepts delivered and completed', () => {
        expect(isReviewableOrderStatus('delivered')).toBe(true);
        expect(isReviewableOrderStatus('completed')).toBe(true);
    });

    it('and nothing else', () => {
        for (const s of ['pending', 'paid', 'shipped', 'cancelled', 'refunded', '', undefined, null]) {
            expect(isReviewableOrderStatus(s)).toBe(false);
        }
    });

    it('keeps the more permissive of the two the modules had', () => {
        // createReviewAction required "completed" alone. Narrowing to that would
        // take away something the marketplace page already allows.
        expect([...REVIEWABLE_ORDER_STATUSES].sort()).toEqual(['completed', 'delivered']);
    });
});

describe('the live moderation path denormalises', () => {
    it('actions/reviews.ts recalculates after moderating', () => {
        // THE test. This is the moderator /admin/marketplace/reviews calls, and it
        // did not touch the product at all.
        const src = code(LIVE);
        const fn = src.slice(src.indexOf('export async function moderateReviewAction'));

        expect(fn).toContain('recalculateProductRating(');
    });

    it('on rejection as well as approval — no status condition around it', () => {
        // The old marketplace version guarded on `action === "approved"`, so
        // rejecting an approved review left its rating in the average.
        const src = code(LIVE);
        const fn = src.slice(src.indexOf('export async function moderateReviewAction'));
        const call = fn.slice(0, fn.indexOf('recalculateProductRating('));

        expect(call).not.toMatch(/if \(status === "approved"\)/);
    });

    it('and the marketplace moderator no longer guards on approve either', () => {
        const src = code(MARKET);
        expect(src).not.toContain('if (action === "approved" && collection === "product_reviews")');
        expect(src).toContain('if (collection === "product_reviews")');
    });

    it('an edit that reopens moderation recalculates too', () => {
        // The edit sets status back to "pending", so the review leaves the
        // approved set and the average has to lose it.
        const src = code(LIVE);
        const fn = src.slice(src.indexOf('export async function updateReviewAction'));

        expect(fn.slice(0, fn.indexOf('export async function moderateReviewAction') > 0
            ? fn.indexOf('export async function moderateReviewAction')
            : fn.length)).toContain('recalculateProductRating(');
    });

    it('there is exactly one implementation', () => {
        // The marketplace copy had two bugs the shared one does not. Leaving both
        // implementations is how they came to disagree.
        expect(code(MARKET)).not.toContain('.where("status", "==", "approved")\n            .get();\n\n        const count');
        expect(code(MARKET)).toContain('await recalculateProductRating(db as any, productId);');
    });
});

describe('both submit paths share the guards', () => {
    it.each([LIVE, MARKET])('%s uses the shared duplicate check', (rel: string) => {
        expect(code(rel)).toContain('hasExistingReview(');
    });

    it.each([LIVE, MARKET])('%s uses the shared order-status rule', (rel: string) => {
        expect(code(rel)).toContain('isReviewableOrderStatus(');
    });

    it.each([LIVE, MARKET])('%s writes both identity fields', (rel: string) => {
        expect(code(rel)).toContain('reviewerIdentityFields(');
    });

    it('neither hand-writes its old single-field PRODUCT_REVIEWS guard', () => {
        // Scoped to PRODUCT_REVIEWS. The first version of this banned
        // `.where("buyerId", "==", buyerId)` outright and failed on
        // _submitSellerReviewAction, which queries SELLER_REVIEWS — a collection
        // with exactly one writer, where a single identity field is correct and
        // there is nothing to reconcile.
        for (const rel of [LIVE, MARKET]) {
            const src = code(rel);
            const productReviewQueries = src
                .split('COLLECTIONS.PRODUCT_REVIEWS')
                .slice(1)
                .map((chunk) => chunk.slice(0, 300));

            for (const chunk of productReviewQueries) {
                expect(chunk).not.toMatch(/\.where\("buyerId", "==", buyerId\)/);
                expect(chunk).not.toMatch(/\.where\("userId", "==", userId\)/);
            }
        }
    });

    it('and the seller-review path shares the order-status rule too', () => {
        const src = code(MARKET);
        const fn = src.slice(src.indexOf('async function _submitSellerReviewAction'));

        expect(fn.slice(0, 1500)).toContain('isReviewableOrderStatus(');
    });

    it('a buyer\'s own-reviews list finds reviews left through either page', () => {
        // "Get user's own reviews" queried `userId` alone, so a review left
        // through /marketplace/buyer/orders/[id]/review — which writes `buyerId`
        // — was invisible to its own author on their own page.
        const src = code(LIVE);
        const fn = src.slice(
            src.indexOf('export async function getUserReviewsAction'),
            src.indexOf('export async function updateReviewAction'),
        );

        expect(fn).toContain('runQuery("userId")');
        expect(fn).toContain('runQuery("buyerId")');
        // Deduped, or a review carrying both fields would be listed twice.
        expect(fn).toContain('if (!byId.has(doc.id)) byId.set(doc.id, doc);');
        // And re-sorted, because two separately-ordered sets concatenated are not
        // ordered.
        expect(fn).toContain('const needsMemorySort = true;');
    });

    it('the ownership check on an edit accepts either field', () => {
        // It read `userId` alone, so it refused the author of any review left
        // through the marketplace page.
        const src = code(LIVE);
        expect(src).toContain('(review as any).userId ?? (review as any).buyerId');
    });
});

describe('unapproved reviews are not public', () => {
    it('a non-admin asking for pending gets approved instead', () => {
        const src = code(MARKET);
        const fn = src.slice(src.indexOf('async function _getProductReviewsAction'));

        expect(fn).toContain('const requested = options?.status || "approved";');
        expect(fn).toContain('requested === "approved" || callerIsAdmin ? requested : "approved"');
    });

    it('and the caller\'s status no longer reaches the query directly', () => {
        const src = code(MARKET);
        const fn = src.slice(src.indexOf('async function _getProductReviewsAction'));

        expect(fn).not.toContain('const status = options?.status || "approved";');
    });

    it('the sibling summary still hardcodes approved', () => {
        // Vacuity guard: it was never exposed this way, and must not become so.
        const src = code(MARKET);
        const fn = src.slice(src.indexOf('async function _getSellerReviewSummaryAction'));

        expect(fn.slice(0, 900)).toContain('.where("status", "==", "approved")');
    });
});
