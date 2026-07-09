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
import { isAdmin } from "@/lib/admin-permissions";
import { withSafeAction } from "@/lib/safe-action";
import type { ActionResponse } from "@/lib/safe-action";

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
        if (orderData.status !== "delivered" && orderData.status !== "completed") { 
            return { success: false as const, error: "You can only review orders that have been delivered", data: null };
        }

        const existingSnap = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("buyerId", "==", buyerId)
            .where("orderId", "==", data.orderId)
            .where("productId", "==", data.productId)
            .limit(1)
            .get();

        if (!existingSnap.empty) { 
            return { success: false as const, error: "You have already reviewed this product for this order", data: null };
        }

        const reviewRef = db.collection(COLLECTIONS.PRODUCT_REVIEWS).doc();
        await reviewRef.set({ 
            productId: data.productId,
            buyerId,
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
        if (orderData.status !== "delivered" && orderData.status !== "completed") { 
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
        
        const status = options?.status || "approved";
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

        if (!isAdmin(sessionResult.session.user.roles)) { 
            return { success: false as const, error: "Unauthorized", data: null };
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

        // If approving a product review, recalculate rating
        if (action === "approved" && collection === "product_reviews") { 
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

async function _recalculateProductRating(productId: string): Promise<void> { 
    try {
        const snap = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("productId", "==", productId)
            .where("status", "==", "approved")
            .get();

        const count = snap.size;
        if (count === 0) return;

        const total = snap.docs.reduce((sum, d) => sum + (d.data().rating || 0), 0);
        const avg = Math.round((total / count) * 10) / 10;

        await db.collection(COLLECTIONS.PRODUCTS).doc(productId).update({
            rating: avg,
            reviewCount: count,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1) 
        });
    } catch (err) { 
        logger.error("_recalculateProductRating error:", err);
    }
}

