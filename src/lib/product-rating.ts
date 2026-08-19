/**
 * A product's average rating — one implementation, called from every moderation
 * path.
 *
 * THE DEFECT THIS EXISTS FOR
 * -------------------------
 * There are TWO complete review subsystems writing the same collection:
 *
 *   actions/reviews.ts               createReviewAction, from
 *                                    /dashboard/reviews/new. Writes `userId`,
 *                                    requires the order to be "completed".
 *
 *   actions/marketplace/_reviews.ts  submitProductReviewAction, from
 *                                    /marketplace/buyer/orders/[id]/review.
 *                                    Writes `buyerId`, accepts "delivered" or
 *                                    "completed".
 *
 * Both are live, from different pages. They also each export a
 * `moderateReviewAction` with a different signature.
 *
 * `_recalculateProductRating` — the only code anywhere that wrote
 * `products.rating` and `products.reviewCount` — lived in _reviews.ts and was
 * called from ITS moderator. That moderator has no caller: the admin reviews
 * page imports `moderateReviewAction` from actions/reviews.ts, which updates the
 * review's status and nothing else.
 *
 * So nothing in the running application ever wrote a product's rating. Every
 * real product sat at rating 0 with reviewCount 0 no matter how many approved
 * reviews it had — and the product card renders a rating only when
 * `rating > 0`, so no real product ever showed one. "Highest Rated" sorting was
 * meaningless for the entire catalogue.
 *
 * Which is a coherent story with the other half of that defect: the flash-sale
 * mappers hardcoded `rating: 5`, so the only ratings the marketplace displayed
 * were the invented ones. See lib/seller-trust.ts.
 *
 * TWO MORE THINGS THE OLD VERSION GOT WRONG
 * -----------------------------------------
 * It returned early on `count === 0`. So when the last approved review went away
 * — rejected by a moderator, or edited back to "pending" — the product kept the
 * rating that review had produced, permanently. The one case where recalculating
 * matters most was the one case it skipped.
 *
 * And it was only invoked when a review was APPROVED. Rejecting a review that
 * had already been approved left its contribution in the average, so a moderator
 * removing a fake five-star review changed nothing a buyer could see. That is
 * precisely what the moderation queue exists to do.
 */

import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";

/** The subset of the db adapter this needs, so the module is testable without one. */
export interface RatingQuery {
    /** Chainable, because both queries here apply two or three filters. */
    where(field: string, op: string, value: any): RatingQuery;
    /**
     * `size` is optional on purpose.
     *
     * The real adapter returns both, but not every snapshot shape in this
     * codebase does — the test harness returns `empty` and `docs` and no `size`,
     * and the first version of this module counted with `snap.size`, so
     * `undefined > 0` was false and the duplicate-review guard silently stopped
     * detecting duplicates. An existing test caught it. `docs.length` is the
     * count either way, so that is what both functions below use.
     */
    get(): Promise<{ size?: number; docs: Array<{ data(): any }> }>;
}

export interface RatingDb {
    collection(name: string): RatingQuery & {
        doc(id: string): { update(patch: Record<string, any>): Promise<any> };
    };
}

export interface RatingResult {
    rating: number;
    reviewCount: number;
}

/**
 * Recomputes a product's average from its APPROVED reviews and writes it back.
 *
 * Call this after ANY change to a review's status — approve, reject, or a return
 * to pending. Not only on approve: see the note above.
 *
 * Never throws. A rating that failed to denormalise is a display problem; making
 * it fail the moderation decision that triggered it would be worse, and the
 * decision itself is already committed by the time this runs.
 */
export async function recalculateProductRating(
    db: RatingDb,
    productId: string,
): Promise<RatingResult | null> {
    try {
        if (!productId) return null;

        const snap = await db
            .collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("productId", "==", productId)
            .where("status", "==", "approved")
            .get();

        const docs = snap.docs ?? [];
        const count = docs.length;

        // No early return on zero. Writing 0/0 is the whole point when the last
        // approved review is withdrawn — otherwise the product keeps a rating
        // nothing supports.
        const total = count === 0
            ? 0
            : docs.reduce((sum: number, d: { data(): any }) => {
                const r = Number(d.data()?.rating);
                return sum + (Number.isFinite(r) ? r : 0);
            }, 0);

        const rating = count === 0 ? 0 : Math.round((total / count) * 10) / 10;

        await db.collection(COLLECTIONS.PRODUCTS).doc(productId).update({
            rating,
            reviewCount: count,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        });

        return { rating, reviewCount: count };
    } catch (err) {
        logger.error("recalculateProductRating error:", {
            productId,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/**
 * The reviewer identity fields, both of them.
 *
 * actions/reviews.ts writes `userId`. actions/marketplace/_reviews.ts writes
 * `buyerId`. Each one's "have you already reviewed this?" guard queried only its
 * own field, so each was blind to the other's reviews — and a buyer could submit
 * one review per product per order through EACH page, which the duplicate check
 * in both was written to prevent.
 *
 * Both fields are written on both paths now, and both are checked. Choosing one
 * and migrating the other would be the cleaner end state; it needs a backfill of
 * the existing rows, which is a separate piece of work with a data migration in
 * it. Writing both is correct in the meantime and makes the guard actually hold.
 */
export function reviewerIdentityFields(userId: string): { userId: string; buyerId: string } {
    return { userId, buyerId: userId };
}

/**
 * Has this reviewer already reviewed this product on this order?
 *
 * Checks BOTH identity spellings, so a review left through either page is found.
 */
export async function hasExistingReview(
    db: RatingDb,
    params: { userId: string; productId: string; orderId: string },
): Promise<boolean> {
    const { userId, productId, orderId } = params;

    for (const field of ["userId", "buyerId"] as const) {
        const snap = await db
            .collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where(field, "==", userId)
            .where("productId", "==", productId)
            .where("orderId", "==", orderId)
            .get();

        if ((snap.docs?.length ?? snap.size ?? 0) > 0) return true;
    }

    return false;
}

/**
 * Order statuses from which a buyer may review what they received.
 *
 * actions/reviews.ts accepted "completed" only; _reviews.ts accepted "delivered"
 * or "completed". So whether a delivered-but-not-completed order could be
 * reviewed depended on which page the buyer happened to be on.
 *
 * Unified on the more permissive pair, which is what the marketplace page already
 * allowed: delivery is the point at which a buyer can actually judge the goods,
 * and narrowing to "completed" would take away something that works today.
 */
export const REVIEWABLE_ORDER_STATUSES: readonly string[] = ["delivered", "completed"];

export function isReviewableOrderStatus(status: unknown): boolean {
    return REVIEWABLE_ORDER_STATUSES.includes(String(status ?? ""));
}

/**
 * Is this a rating a review may carry?
 *
 * Both submit actions checked `rating < 1 || rating > 5`, which is a comparison
 * and not a validation. A server action's parameter types are erased at the
 * wire, so `rating` arrives as whatever was sent:
 *
 *   - `NaN`  — both comparisons are FALSE, so it passed. It then reaches
 *     recalculateProductRating, where `total += NaN` makes the product's whole
 *     average NaN, and every reader that formats it shows nothing at all.
 *   - `"5"`  — a string. `"5" < 1` and `"5" > 5` are both false, so it passed
 *     too, and getSellerReviewSummaryAction's `total += r` CONCATENATES it:
 *     two five-star reviews become "055", and the average 27.5 out of 5.
 *   - `4.7`  — accepted silently, so the star distribution rounds it into a
 *     bucket the reviewer did not choose.
 *
 * One rule now, and it is a whole number from one to five.
 */
export function isValidReviewRating(rating: unknown): boolean {
    return typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

/** The product ids an order actually contains, both item spellings. */
export function orderedProductIds(order: unknown): string[] {
    const items = (order as { items?: unknown })?.items;
    if (!Array.isArray(items)) return [];

    return items
        .map((item) => String((item as Record<string, unknown>)?.productId ?? (item as Record<string, unknown>)?.id ?? ""))
        .filter(Boolean);
}

/**
 * Which products on this order has anybody already reviewed?
 *
 * The order carried a single boolean, `reviewSubmitted`, set to true by the
 * first review of any item — see the comment at its write site. This reads the
 * reviews themselves, so the flag it feeds is recomputed from the source rather
 * than accumulated, and a lost race self-heals on the next review.
 */
export async function reviewedProductIdsForOrder(
    db: RatingDb,
    orderId: string,
): Promise<string[]> {
    const snap = await db
        .collection(COLLECTIONS.PRODUCT_REVIEWS)
        .where("orderId", "==", orderId)
        .get();

    const ids = new Set<string>();
    for (const doc of snap.docs ?? []) {
        const productId = String(doc.data()?.productId ?? "");
        if (productId) ids.add(productId);
    }

    return [...ids];
}
