/**
 * Marketplace Reviews — Server Actions
 */

"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { withSafeAction } from "@/lib/safe-action";
import type { ActionResponse } from "@/lib/safe-action";
import {
    recalculateProductRating,
    reviewerIdentityFields,
    hasExistingReview,
    isReviewableOrderStatus,
} from "@/lib/product-rating";

// ---------------------------------------------------------------------------
// SUBMIT: Product Review (buyer, post-delivery)
// ---------------------------------------------------------------------------

async function _submitProductReviewAction(data: { 
    productId: string;
    orderId: string;
    rating: number; // 1–5
    comment?: string;
    imageUrls?: string[]; 
}): Promise<ActionResponse<null>> { 
    let sessionResult;
    try {
        if (data.rating < 1 || data.rating > 5) {
            return { success: false as const, error: "Rating must be between 1 and 5", data: null };
        }

        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const buyerId = session.user.id;

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(data.orderId).get();
        if (!orderDoc.exists) return { success: false as const, error: "Order not found", data: null };

        const orderData = orderDoc.data()!;
        if (orderData.buyerId !== buyerId) { 
            return { success: false as const, error: "Unauthorized: not your order", data: null };
        }
        // The same rule createReviewAction now uses. That one required
        // "completed" only, so a delivered order was reviewable here and not
        // there. See REVIEWABLE_ORDER_STATUSES.
        if (!isReviewableOrderStatus(orderData.status)) {
            return { success: false as const, error: "You can only review orders that have been delivered", data: null };
        }

        // The product has to have been IN the order.
        //
        // Everything above checks the order — the buyer owns it, it was
        // delivered — and then productId was taken from the caller and never
        // compared to what the order contained. One delivered order therefore
        // licensed a review of any product on the platform, written with
        // `verified: true` and fed straight into _recalculateProductRating,
        // which moves that product's public average.
        //
        // It works in both directions: one-star a competitor, or buy anything
        // once and five-star your own listings as a verified purchase. The
        // duplicate guard is per (buyer, order, product), so a single order
        // covered the entire catalogue, one review each.
        //
        // submitSellerReviewAction, two screens below, already does exactly this
        // check — `if (!sellerIds.includes(data.sellerId))`. Only the product
        // path was missing it.
        const orderItems: any[] = Array.isArray(orderData.items) ? orderData.items : [];
        const orderedProductIds = orderItems
            .map((item) => String(item?.productId ?? item?.id ?? ""))
            .filter(Boolean);

        if (!orderedProductIds.includes(String(data.productId))) {
            return { success: false as const, error: "That product was not part of this order", data: null };
        }

        // Checked against BOTH identity spellings.
        //
        // This queried `buyerId` and createReviewAction's guard queried `userId`,
        // because the two modules write a different field for the same person. So
        // each guard was blind to the other's reviews and a buyer could leave one
        // review per product per order through EACH page.
        if (await hasExistingReview(db as any, {
            userId: buyerId,
            productId: String(data.productId),
            orderId: String(data.orderId),
        })) {
            return { success: false as const, error: "You have already reviewed this product for this order", data: null };
        }

        const reviewRef = db.collection(COLLECTIONS.PRODUCT_REVIEWS).doc();
        await reviewRef.set({
            productId: data.productId,
            // Both spellings, so createReviewAction's duplicate guard finds this
            // row too, and so updateReviewAction's ownership check — which reads
            // `userId` — does not refuse this review's own author.
            ...reviewerIdentityFields(buyerId),
            orderId: data.orderId,
            rating: data.rating,
            comment: data.comment || null,
            imageUrls: data.imageUrls || [],
            helpful: 0,
            verified: true,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0 
        });

        await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(data.orderId).update({ 
            reviewSubmitted: true,
            reviewId: reviewRef.id,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1) 
        });

        await _recalculateProductRating(data.productId);

        return { error: null, success: true as const, data: null };
    } catch (err: any) { 
        logger.error("submitProductReviewAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: err instanceof Error ? err.message : String(err)
        });
        return { success: false as const, error: "Failed to submit review", data: null };
    }
}
export const submitProductReviewAction = withSafeAction("submitProductReviewAction", _submitProductReviewAction);

// ---------------------------------------------------------------------------
// SUBMIT: Seller Review (buyer, post-delivery)
// ---------------------------------------------------------------------------

async function _submitSellerReviewAction(data: { 
    sellerId: string;
    orderId: string;
    rating: number; // 1–5
    comment?: string; 
}): Promise<ActionResponse<null>> { 
    let sessionResult;
    try {
        if (data.rating < 1 || data.rating > 5) {
            return { success: false as const, error: "Rating must be between 1 and 5", data: null };
        }

        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const buyerId = session.user.id;

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(data.orderId).get();
        if (!orderDoc.exists) return { success: false as const, error: "Order not found", data: null };

        const orderData = orderDoc.data()!;
        if (orderData.buyerId !== buyerId) { 
            return { success: false as const, error: "Unauthorized: not your order", data: null };
        }
        // The shared rule, same as the product path above.
        if (!isReviewableOrderStatus(orderData.status)) {
            return { success: false as const, error: "You can only review orders that have been delivered", data: null };
        }

        const sellerIds = orderData.sellerIds || [];
        if (!sellerIds.includes(data.sellerId)) { 
            return { success: false as const, error: "Seller does not match this order", data: null };
        }

        const existingSnap = await db.collection(COLLECTIONS.SELLER_REVIEWS)
            .where("buyerId", "==", buyerId)
            .where("orderId", "==", data.orderId)
            .where("sellerId", "==", data.sellerId)
            .limit(1)
            .get();

        if (!existingSnap.empty) { 
            return { success: false as const, error: "You have already reviewed this seller for this order", data: null };
        }

        const reviewRef = db.collection(COLLECTIONS.SELLER_REVIEWS).doc();
        await reviewRef.set({ 
            sellerId: data.sellerId,
            buyerId,
            orderId: data.orderId,
            rating: data.rating,
            comment: data.comment || null,
            verified: true,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0 
        });

        return { error: null, success: true as const, data: null };
    } catch (err: any) { 
        logger.error("submitSellerReviewAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: err instanceof Error ? err.message : String(err)
        });
        return { success: false as const, error: "Failed to submit seller review", data: null };
    }
}
export const submitSellerReviewAction = withSafeAction("submitSellerReviewAction", _submitSellerReviewAction);

// ---------------------------------------------------------------------------
// GET: Product Reviews (public)
// ---------------------------------------------------------------------------

async function _getProductReviewsAction(
    productId: string,
    options?: { limit?: number; status?: "approved" | "pending" | "rejected" }
): Promise<ActionResponse<{ reviews: any[] }>> { 
    let sessionResult;
    try {
        // Public action, session is optional
        sessionResult = await requireSession().catch(() => ({ session: null }));

        // Only an admin may ask for anything but approved reviews.
        //
        // `status` came from the caller and went straight into the query. The
        // default is "approved", and any caller could pass "pending" or
        // "rejected" instead — so reviews a moderator had not approved, and ones
        // they had explicitly REJECTED, were publicly readable with their
        // comments and images. The pending queue two functions below is
        // admin-gated; this served the same rows to anyone who asked.
        //
        // _getSellerReviewSummaryAction hardcodes "approved" and was never
        // exposed this way — the same two-siblings-disagree shape as everything
        // else in this cluster.
        const requested = options?.status || "approved";
        const callerIsAdmin = isAdmin((sessionResult as any)?.session?.user?.roles);
        const status = requested === "approved" || callerIsAdmin ? requested : "approved";

        const pageSize = options?.limit || 20;

        const snap = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("productId", "==", productId)
            .where("status", "==", status)
            .orderBy("createdAt", "desc")
            .limit(pageSize)
            .get();

        const reviews = serializeDocs(snap.docs);

        return { error: null, success: true as const, data: { reviews } };
    } catch (err: any) { 
        logger.error("getProductReviewsAction error:", { 
            productId, 
            userId: sessionResult?.session?.user?.id,
            error: err instanceof Error ? err.message : String(err) 
        });
        return { error: "Action failed", success: false as const, data: null };
    }
}
export const getProductReviewsAction = withSafeAction("getProductReviewsAction", _getProductReviewsAction);

// ---------------------------------------------------------------------------
// GET: Seller Review Summary (public)
// ---------------------------------------------------------------------------

async function _getSellerReviewSummaryAction(sellerId: string): Promise<ActionResponse<{ summary: any }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession().catch(() => ({ session: null }));

        const snap = await db.collection(COLLECTIONS.SELLER_REVIEWS)
            .where("sellerId", "==", sellerId)
            .where("status", "==", "approved")
            .get();

        if (snap.empty) {
            return {
                error: null,
                success: true as const,
                data: {
                    summary: {
                        averageRating: 0,
                        totalReviews: 0,
                        distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }
                    }
                }
            };
        }

        const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
        let total = 0;

        snap.docs.forEach((d) => { 
            const r = d.data().rating as number;
            total += r;
            const key = String(Math.round(r));
            if (distribution[key] !== undefined) distribution[key]++;
        });

        const averageRating = Math.round((total / snap.size) * 10) / 10;
        return { error: null, success: true as const, data: { summary: { averageRating, totalReviews: snap.size, distribution } } };
    } catch (err: any) { 
        logger.error("getSellerReviewSummaryAction error:", { 
            sellerId, 
            userId: sessionResult?.session?.user?.id,
            error: err instanceof Error ? err.message : String(err) 
        });
        return { error: "Action failed", success: false as const, data: null };
    }
}
export const getSellerReviewSummaryAction = withSafeAction("getSellerReviewSummaryAction", _getSellerReviewSummaryAction);

// ---------------------------------------------------------------------------
// ADMIN: Moderate a review (approve / reject)
// ---------------------------------------------------------------------------

async function _moderateReviewAction(
    reviewId: string,
    collection: "product_reviews" | "seller_reviews",
    action: "approved" | "rejected",
    note?: string
): Promise<ActionResponse<null>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const adminId = sessionResult.session.user.id;

        if (!hasAdminPermission(sessionResult.session.user.roles, "marketplace:moderate_reviews")) { 
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // `action` is typed as "approved" | "rejected", which is a compile-time
        // claim only — a server action is reachable with any argument. It is
        // written straight into `status`, and a review in an unrecognised status
        // is invisible to both the pending queue and the public list: not lost,
        // but unreachable by anyone who would look for it.
        //
        // `collection` needs no such check: the ternary below maps anything that
        // is not "product_reviews" to seller_reviews, so an arbitrary string
        // cannot reach an arbitrary table.
        if (action !== "approved" && action !== "rejected") {
            return { success: false as const, error: "Moderation action must be approved or rejected", data: null };
        }

        const collectionName = collection === "product_reviews"
            ? COLLECTIONS.PRODUCT_REVIEWS
            : COLLECTIONS.SELLER_REVIEWS;

        const reviewRef = db.collection(collectionName).doc(reviewId);
        const reviewSnap = await reviewRef.get();
        if (!reviewSnap.exists) return { success: false as const, error: "Review not found", data: null };

        await reviewRef.update({ 
            status: action,
            moderatedBy: adminId,
            moderatedAt: FieldValue.serverTimestamp(),
            adminNote: note || null,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1) 
        });

        // Recalculate on EITHER decision, not only on approval.
        //
        // Rejecting a review that had already been approved left its contribution
        // in the product's average, so a moderator removing a fake five-star
        // changed nothing a buyer could see — the one thing this queue is for.
        if (collection === "product_reviews") {
            const productId = reviewSnap.data()?.productId;
            if (productId) await _recalculateProductRating(productId);
        }

        return { error: null, success: true as const, data: null };
    } catch (err: any) { 
        logger.error("moderateReviewAction error:", {
            reviewId,
            collection,
            action,
            userId: sessionResult?.session?.user?.id,
            error: err instanceof Error ? err.message : String(err)
        });
        return { success: false as const, error: "Failed to moderate review", data: null };
    }
}
export const moderateReviewAction = withSafeAction("moderateReviewAction", _moderateReviewAction);

// ---------------------------------------------------------------------------
// ADMIN: Get pending reviews for moderation
// ---------------------------------------------------------------------------

async function _getPendingReviewsAction(options?: { limit?: number; }): Promise<ActionResponse<{ productReviews: any[], sellerReviews: any[] }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        if (!isAdmin(sessionResult.session.user.roles)) return { success: false as const, error: "Unauthorized", data: null };

        const pageSize = options?.limit || 30;

        const [prodSnap, sellerSnap] = await Promise.all([
            db.collection(COLLECTIONS.PRODUCT_REVIEWS)
                .where("status", "==", "pending")
                .orderBy("createdAt", "asc")
                .limit(pageSize)
                .get(),
            db.collection(COLLECTIONS.SELLER_REVIEWS)
                .where("status", "==", "pending")
                .orderBy("createdAt", "asc")
                .limit(pageSize)
                .get(),
        ]);

        return { 
            error: null, 
            success: true as const, 
            data: { 
                productReviews: serializeDocs(prodSnap.docs), 
                sellerReviews: serializeDocs(sellerSnap.docs) 
            }
        };
    } catch (err: any) { 
        logger.error("getPendingReviewsAction error:", { 
            userId: sessionResult?.session?.user?.id,
            error: err instanceof Error ? err.message : String(err) 
        });
        return { error: "Action failed", success: false as const, data: null };
    }
}
export const getPendingReviewsAction = withSafeAction("getPendingReviewsAction", _getPendingReviewsAction);

// ---------------------------------------------------------------------------
// Internal: Recalculate and denormalize product average rating
// ---------------------------------------------------------------------------

/**
 * Delegates to the shared implementation.
 *
 * This function WAS the only code anywhere that wrote `products.rating` — and it
 * was reachable only from this file's moderateReviewAction, which no page calls.
 * The admin reviews page uses the moderator in actions/reviews.ts, which did not
 * recalculate at all, so no product's rating was ever written.
 *
 * It also had two bugs of its own, both fixed in the shared version: it returned
 * early on `count === 0`, so withdrawing the last approved review left the old
 * rating in place permanently; and it was invoked only on approval, so rejecting
 * an already-approved review left its contribution in the average.
 *
 * Kept as a thin wrapper rather than deleted, because the two call sites in this
 * file read better with the local name and removing it would make this diff
 * larger than the fix.
 */
async function _recalculateProductRating(productId: string): Promise<void> {
    await recalculateProductRating(db as any, productId);
}

