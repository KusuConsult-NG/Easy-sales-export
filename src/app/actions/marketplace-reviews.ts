/**
 * Marketplace Reviews — Server Actions
 *
 * Buyers can submit:
 *   1. A product review (post-delivery)
 *   2. A seller review (post-delivery)
 *
 * Reviews are pendingmoderation until approved by admin.
 * Product average ratings are denormalized onto the product document.
 */

"use server";

import { db } from "@/lib/firebase-admin";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import type { ProductReview, SellerReview } from "@/lib/types/marketplace";

// ---------------------------------------------------------------------------
// SUBMIT: Product Review (buyer, post-delivery)
// ---------------------------------------------------------------------------

export async function submitProductReviewAction(data: {
    productId: string;
    orderId: string;
    rating: number; // 1–5
    comment?: string;
    imageUrls?: string[];
}): Promise<{ success: boolean; reviewId?: string; error?: string }> {
    try {
        if (data.rating < 1 || data.rating > 5) {
            return { success: false, error: "Rating must be between 1 and 5" };
        }

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        const buyerId = sessionResult.session.user.id;

        // Verify the order exists, belongs to this buyer, and is delivered
        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(data.orderId).get();
        if (!orderDoc.exists) return { success: false, error: "Order not found" };

        const orderData = orderDoc.data()!;
        if (orderData.buyerId !== buyerId) {
            return { success: false, error: "Unauthorized: not your order" };
        }
        if (orderData.status !== "delivered" && orderData.status !== "completed") {
            return { success: false, error: "You can only review orders that have been delivered" };
        }

        // Prevent duplicate product reviews for same order
        const existingSnap = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("buyerId", "==", buyerId)
            .where("orderId", "==", data.orderId)
            .where("productId", "==", data.productId)
            .limit(1)
            .get();

        if (!existingSnap.empty) {
            return { success: false, error: "You have already reviewed this product for this order" };
        }

        // Create review document
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
        });

        // Mark order as reviewed
        await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(data.orderId).update({
            reviewSubmitted: true,
            reviewId: reviewRef.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Recalculate and denormalize product rating
        await _recalculateProductRating(data.productId);

        return { success: true, reviewId: reviewRef.id };
    } catch (err: any) {
        logger.error("submitProductReviewAction error:", err);
        return { success: false, error: err.message || "Failed to submit review" };
    }
}

// ---------------------------------------------------------------------------
// SUBMIT: Seller Review (buyer, post-delivery)
// ---------------------------------------------------------------------------

export async function submitSellerReviewAction(data: {
    sellerId: string;
    orderId: string;
    rating: number; // 1–5
    comment?: string;
}): Promise<{ success: boolean; reviewId?: string; error?: string }> {
    try {
        if (data.rating < 1 || data.rating > 5) {
            return { success: false, error: "Rating must be between 1 and 5" };
        }

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        const buyerId = sessionResult.session.user.id;

        // Verify the order
        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(data.orderId).get();
        if (!orderDoc.exists) return { success: false, error: "Order not found" };

        const orderData = orderDoc.data()!;
        if (orderData.buyerId !== buyerId) {
            return { success: false, error: "Unauthorized: not your order" };
        }
        if (orderData.status !== "delivered" && orderData.status !== "completed") {
            return { success: false, error: "You can only review orders that have been delivered" };
        }
        if (orderData.sellerId !== data.sellerId) {
            return { success: false, error: "Seller does not match this order" };
        }

        // Prevent duplicate seller review for same order
        const existingSnap = await db.collection(COLLECTIONS.SELLER_REVIEWS)
            .where("buyerId", "==", buyerId)
            .where("orderId", "==", data.orderId)
            .limit(1)
            .get();

        if (!existingSnap.empty) {
            return { success: false, error: "You have already reviewed this seller for this order" };
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
        });

        return { success: true, reviewId: reviewRef.id };
    } catch (err: any) {
        logger.error("submitSellerReviewAction error:", err);
        return { success: false, error: err.message || "Failed to submit seller review" };
    }
}

// ---------------------------------------------------------------------------
// GET: Product Reviews (public)
// ---------------------------------------------------------------------------

export async function getProductReviewsAction(
    productId: string,
    options?: { limit?: number; status?: "approved" | "pending" | "rejected" }
): Promise<ProductReview[]> {
    try {
        const status = options?.status || "approved";
        const pageSize = options?.limit || 20;

        const snap = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("productId", "==", productId)
            .where("status", "==", status)
            .orderBy("createdAt", "desc")
            .limit(pageSize)
            .get();

        return serializeDocs(snap.docs) as unknown as ProductReview[];
    } catch (err) {
        logger.error("getProductReviewsAction error:", err);
        return [];
    }
}

// ---------------------------------------------------------------------------
// GET: Seller Review Summary (public)
// ---------------------------------------------------------------------------

export async function getSellerReviewSummaryAction(sellerId: string): Promise<{
    averageRating: number;
    totalReviews: number;
    distribution: Record<string, number>; // "1"..5 → count
}> {
    try {
        const snap = await db.collection(COLLECTIONS.SELLER_REVIEWS)
            .where("sellerId", "==", sellerId)
            .where("status", "==", "approved")
            .get();

        if (snap.empty) {
            return { averageRating: 0, totalReviews: 0, distribution: {} };
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
        return { averageRating, totalReviews: snap.size, distribution };
    } catch (err) {
        logger.error("getSellerReviewSummaryAction error:", err);
        return { averageRating: 0, totalReviews: 0, distribution: {} };
    }
}

// ---------------------------------------------------------------------------
// ADMIN: Moderate a review (approve / reject)
// ---------------------------------------------------------------------------

export async function moderateReviewAction(
    reviewId: string,
    collection: "product_reviews" | "seller_reviews",
    action: "approved" | "rejected",
    note?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        const adminId = sessionResult.session.user.id;

        if (!isAdmin(sessionResult.session.user.roles)) {
            return { success: false, error: "Unauthorized" };
        }

        const collectionName = collection === "product_reviews"
            ? COLLECTIONS.PRODUCT_REVIEWS
            : COLLECTIONS.SELLER_REVIEWS;

        const reviewRef = db.collection(collectionName).doc(reviewId);
        const reviewSnap = await reviewRef.get();
        if (!reviewSnap.exists) return { success: false, error: "Review not found" };

        await reviewRef.update({
            status: action,
            moderatedBy: adminId,
            moderatedAt: FieldValue.serverTimestamp(),
            adminNote: note || null,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // If approving a product review, recalculate rating
        if (action === "approved" && collection === "product_reviews") {
            const productId = reviewSnap.data()?.productId;
            if (productId) await _recalculateProductRating(productId);
        }

        return { success: true };
    } catch (err: any) {
        logger.error("moderateReviewAction error:", err);
        return { success: false, error: err.message || "Failed to moderate review" };
    }
}

// ---------------------------------------------------------------------------
// ADMIN: Get pending reviews for moderation
// ---------------------------------------------------------------------------

export async function getPendingReviewsAction(options?: {
    limit?: number;
}): Promise<{
    productReviews: ProductReview[];
    sellerReviews: SellerReview[];
}> {
    try {
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
            productReviews: serializeDocs(prodSnap.docs) as unknown as ProductReview[],
            sellerReviews: serializeDocs(sellerSnap.docs) as unknown as SellerReview[],
        };
    } catch (err) {
        logger.error("getPendingReviewsAction error:", err);
        return { productReviews: [], sellerReviews: [] };
    }
}

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
        });
    } catch (err) {
        logger.error("_recalculateProductRating error:", err);
    }
}
