/**
 * Server Actions for Product Reviews System
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { ProductReview, Order } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Create a product review
 */
export async function createReviewAction(params: {
    productId: string;
    orderId: string;
    rating: number;
    comment: string;
    images?: string[];
}) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        const userId = session.user.id;

        const { productId, orderId, rating, comment, images = [] } = params;

        // Validate rating
        if (rating < 1 || rating > 5) {
            return { success: false, error: "Rating must be between 1 and 5" };
        }

        // Validate comment length
        if (comment.trim().length < 20) {
            return { success: false, error: "Review must be at least 20 characters" };
        }

        if (comment.length > 500) {
            return { success: false, error: "Review must not exceed 500 characters" };
        }

        // Get order and verify
        const orderDoc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();
        if (!orderDoc.exists) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;

        // Verify user is the buyer
        if (order.buyerId !== userId) {
            return { success: false, error: "Not authorized" };
        }

        // Verify order is completed
        if (order.status !== "completed") {
            return { success: false, error: "Can only review completed orders" };
        }

        // Verify product is in order
        const orderItem = order.items.find((item) => item.productId === productId);
        if (!orderItem) {
            return { success: false, error: "Product not found in order" };
        }

        // Check if already reviewed this product from this order
        const existingReviews = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("userId", "==", userId)
            .where("productId", "==", productId)
            .where("orderId", "==", orderId)
            .get();

        if (!existingReviews.empty) {
            return { success: false, error: "You have already reviewed this product from this order" };
        }

        // Create review
        const reviewData: Partial<ProductReview> = {
            productId,
            sellerId: order.sellerId, // Get from order, not item
            userId,
            orderId,
            rating,
            comment: comment.trim(),
            images,
            verified: true, // Purchased from platform
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
        };

        await db.collection(COLLECTIONS.PRODUCT_REVIEWS).add(reviewData);

        return { success: true };
    } catch (error: any) {
        logger.error("Create review error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get reviews for a product
 */
export async function getProductReviewsAction(
    productId: string,
    filters?: {
        rating?: number;
        verified?: boolean;
    }
) {
    try {
        let query = db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("productId", "==", productId)
            .where("status", "==", "approved")
            .orderBy("createdAt", "desc")
            .limit(50);

        if (filters?.rating) {
            query = query.where("rating", "==", filters.rating);
        }

        const snapshot = await query.get();
        const reviews: ProductReview[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            };
        }) as ProductReview[];

        // Filter by verified if specified
        const filteredReviews = filters?.verified !== undefined
            ? reviews.filter((r) => r.verified === filters.verified)
            : reviews;

        return { success: true, reviews: filteredReviews };
    } catch (error: any) {
        logger.error("Get product reviews error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get user's own reviews
 */
export async function getUserReviewsAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const reviews: ProductReview[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            };
        }) as ProductReview[];

        return { success: true, reviews };
    } catch (error: any) {
        logger.error("Get user reviews error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update a review (within 30 days)
 */
export async function updateReviewAction(
    reviewId: string,
    rating: number,
    comment: string
) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        const userId = session.user.id;

        // Validate
        if (rating < 1 || rating > 5) {
            return { success: false, error: "Rating must be between 1 and 5" };
        }

        if (comment.trim().length < 20) {
            return { success: false, error: "Review must be at least 20 characters" };
        }

        if (comment.length > 500) {
            return { success: false, error: "Review must not exceed 500 characters" };
        }

        // Get review
        const reviewRef = db.collection(COLLECTIONS.PRODUCT_REVIEWS).doc(reviewId);
        const reviewDoc = await reviewRef.get();
        if (!reviewDoc.exists) {
            return { success: false, error: "Review not found" };
        }

        const review = reviewDoc.data() as ProductReview;

        // Verify ownership
        if (review.userId !== userId) {
            return { success: false, error: "Not authorized" };
        }

        // Check 30-day limit
        const reviewDate = ('toDate' in review.createdAt && typeof review.createdAt.toDate === 'function')
            ? review.createdAt.toDate()
            : (review.createdAt instanceof Date ? review.createdAt : new Date());
        const daysSinceCreation = Math.floor(
            (Date.now() - reviewDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceCreation > 30) {
            return { success: false, error: "Reviews can only be edited within 30 days" };
        }

        // Update review
        await reviewRef.update({
            rating,
            comment: comment.trim(),
            status: "pending", // Re-trigger moderation
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Update review error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Moderate a review (Admin only)
 */
export async function moderateReviewAction(
    reviewId: string,
    status: "approved" | "rejected",
    rejectionReason?: string
) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        const userId = session.user.id;

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) {
            return { success: false, error: "Not authorized as admin" };
        }

        // Get review
        const reviewRef = db.collection(COLLECTIONS.PRODUCT_REVIEWS).doc(reviewId);
        const reviewDoc = await reviewRef.get();
        if (!reviewDoc.exists) {
            return { success: false, error: "Review not found" };
        }

        // Update review
        const updateData: any = {
            status,
            moderatedBy: userId,
            moderatedAt: FieldValue.serverTimestamp(),
        };

        if (status === "rejected" && rejectionReason) {
            updateData.rejectionReason = rejectionReason;
        }

        await reviewRef.update(updateData);

        return { success: true };
    } catch (error: any) {
        logger.error("Moderate review error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get seller rating statistics
 */
export async function getSellerRatingAction(sellerId: string) {
    try {
        const snapshot = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("sellerId", "==", sellerId)
            .where("status", "==", "approved")
            .get();

        const reviews: ProductReview[] = snapshot.docs.map((doc) => doc.data()) as ProductReview[];

        if (reviews.length === 0) {
            return {
                success: true,
                stats: {
                    averageRating: 0,
                    totalReviews: 0,
                    distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
                },
            };
        }

        // Calculate average
        const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
        const averageRating = sum / reviews.length;

        // Calculate distribution
        const distribution = {
            5: reviews.filter((r) => r.rating === 5).length,
            4: reviews.filter((r) => r.rating === 4).length,
            3: reviews.filter((r) => r.rating === 3).length,
            2: reviews.filter((r) => r.rating === 2).length,
            1: reviews.filter((r) => r.rating === 1).length,
        };

        return {
            success: true,
            stats: {
                averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
                totalReviews: reviews.length,
                distribution,
            },
        };
    } catch (error: any) {
        logger.error("Get seller rating error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get all reviews for admin moderation
 */
export async function getAdminReviewsAction(statusFilter?: "pending" | "approved" | "rejected") {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        const userId = session.user.id;

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) {
            return { success: false, error: "Not authorized as admin" };
        }

        let query = db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .orderBy("createdAt", "desc")
            .limit(100);

        if (statusFilter) {
            query = db.collection(COLLECTIONS.PRODUCT_REVIEWS)
                .where("status", "==", statusFilter)
                .orderBy("createdAt", "desc")
                .limit(100);
        }

        const snapshot = await query.get();
        const reviews: ProductReview[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            };
        }) as ProductReview[];

        return { success: true, reviews };
    } catch (error: any) {
        logger.error("Get admin reviews error:", error);
        return { success: false, error: error.message };
    }
}
