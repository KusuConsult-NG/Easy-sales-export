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
import { serializeDocs } from "@/lib/firestore-serialize";
import { z } from "zod";
import { escapeHtml } from "@/lib/utils";

const reviewSchema = z.object({ rating: z.number().min(1, "Rating must be at least 1").max(5, "Rating cannot exceed 5"),
    comment: z.string().trim().min(20, "Review must be at least 20 characters").max(500, "Review must not exceed 500 characters") });

/**
 * Create a product review
 */
export async function createReviewAction(params: { productId: string;
    orderId: string;
    rating: number;
    comment: string;
    images?: string[]; }) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { productId, orderId, rating, comment, images = [] } = params;

        // Validate with Zod
        const validation = reviewSchema.safeParse({ rating, comment });
        if (!validation.success) { return { success: false as const, error: validation.error.issues[0].message, data: null };
        }

        // Get order and verify
        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();
        if (!orderDoc.exists) { return { success: false as const, error: "Order not found", data: null };
        }

        const order = orderDoc.data() as Order;

        // Verify user is the buyer
        if (order.buyerId !== userId) { return { success: false as const, error: "Not authorized", data: null };
        }

        // Verify order is completed
        if (order.status !== "completed") { return { success: false as const, error: "Can only review completed orders", data: null };
        }

        // Verify product is in order
        const orderItem = order.items.find((item) => item.productId === productId);
        if (!orderItem) { return { success: false as const, error: "Product not found in order", data: null };
        }

        // Check if already reviewed this product from this order
        const existingReviews = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("userId", "==", userId)
            .where("productId", "==", productId)
            .where("orderId", "==", orderId)
            .get();

        if (!existingReviews.empty) { return { success: false as const, error: "You have already reviewed this product from this order", data: null };
        }

        // Get the specific product to ensure we attribute the review to the ACTUAL seller
        // This eliminates the single-seller cart assumption bug
        const productDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(productId).get();
        if (!productDoc.exists) { return { success: false as const, error: "Product no longer exists on the platform", data: null };
        }
        const productActualSellerId = productDoc.data()?.sellerId || order.sellerId;

        // Create review
        const reviewData: Partial<ProductReview> = { productId,
            sellerId: productActualSellerId, // Fetched explicitly from the product DB
            userId,
            orderId,
            rating: validation.data.rating,
            comment: escapeHtml(validation.data.comment),
            images,
            verified: true, // Purchased from platform
            status: "pending",
            createdAt: FieldValue.serverTimestamp() };

        await db.collection(COLLECTIONS.PRODUCT_REVIEWS).add(reviewData);

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Create review error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Get reviews for a product
 */
export async function getProductReviewsAction(
    productId: string,
    filters?: { rating?: number;
        verified?: boolean;
    }
) { try {
        let query = db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("productId", "==", productId)
            .where("status", "==", "approved")
            .orderBy("createdAt", "desc")
            .limit(50);

        if (filters?.rating) {
            query = query.where("rating", "==", filters.rating);
        }

        const snapshot = await query.get();
        const reviews = serializeDocs(snapshot.docs) as unknown as ProductReview[];

        // Filter by verified if specified
        const filteredReviews = filters?.verified !== undefined
            ? reviews.filter((r) => r.verified === filters.verified)
            : reviews;

        return { success: true as const, reviews: filteredReviews, error: null };
    } catch (error: any) { logger.error("Get product reviews error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Get user's own reviews
 */
export async function getUserReviewsAction() { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const reviews = serializeDocs(snapshot.docs) as unknown as ProductReview[];

        return { success: true as const, reviews, error: null };
    } catch (error: any) { logger.error("Get user reviews error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Update a review (within 30 days)
 */
export async function updateReviewAction(
    reviewId: string,
    rating: number,
    comment: string
) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Validate with Zod
        const validation = reviewSchema.safeParse({ rating, comment });
        if (!validation.success) { return { success: false as const, error: validation.error.issues[0].message, data: null };
        }

        // Get review
        const reviewRef = db.collection(COLLECTIONS.PRODUCT_REVIEWS).doc(reviewId);
        const reviewDoc = await reviewRef.get();
        if (!reviewDoc.exists) { return { success: false as const, error: "Review not found", data: null };
        }

        const review = reviewDoc.data() as ProductReview;

        // Verify ownership
        if (review.userId !== userId) { return { success: false as const, error: "Not authorized", data: null };
        }

        // Check 30-day limit
        const reviewDate = ('toDate' in review.createdAt && typeof review.createdAt.toDate === 'function')
            ? review.createdAt.toDate()
            : (review.createdAt instanceof Date ? review.createdAt : new Date());
        const daysSinceCreation = Math.floor(
            (Date.now() - reviewDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceCreation > 30) { return { success: false as const, error: "Reviews can only be edited within 30 days", data: null };
        }

        // Update review
        await reviewRef.update({ rating: validation.data.rating,
            comment: escapeHtml(validation.data.comment),
            status: "pending", // Re-trigger moderation
            updatedAt: FieldValue.serverTimestamp() });

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Update review error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Moderate a review (Admin only)
 */
export async function moderateReviewAction(
    reviewId: string,
    status: "approved" | "rejected",
    rejectionReason?: string
) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) { return { success: false as const, error: "Not authorized as admin", data: null };
        }

        // Get review
        const reviewRef = db.collection(COLLECTIONS.PRODUCT_REVIEWS).doc(reviewId);
        const reviewDoc = await reviewRef.get();
        if (!reviewDoc.exists) { return { success: false as const, error: "Review not found", data: null };
        }

        // Update review
        const updateData: any = { status,
            moderatedBy: userId,
            moderatedAt: FieldValue.serverTimestamp() };

        if (status === "rejected" && rejectionReason) { updateData.rejectionReason = rejectionReason;
        }

        await reviewRef.update(updateData);

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Moderate review error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Get seller rating statistics
 */
export async function getSellerRatingAction(sellerId: string) { try {
        const snapshot = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("sellerId", "==", sellerId)
            .where("status", "==", "approved")
            .get();

        const reviews: ProductReview[] = snapshot.docs.map((doc) => doc.data()) as ProductReview[];

        if (reviews.length === 0) {
            return { error: null, success: true as const, stats: {
                    averageRating: 0, totalReviews: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 , data: null } , data: null } , data: null };
        }

        // Calculate average
        const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
        const averageRating = sum / reviews.length;

        // Calculate distribution
        const distribution = { 5: reviews.filter((r) => r.rating === 5).length,
            4: reviews.filter((r) => r.rating === 4).length,
            3: reviews.filter((r) => r.rating === 3).length,
            2: reviews.filter((r) => r.rating === 2).length,
            1: reviews.filter((r) => r.rating === 1).length };

        return { error: null, success: true as const, stats: {
                averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
                totalReviews: reviews.length, distribution , data: null }
        , data: null };
    } catch (error: any) { logger.error("Get seller rating error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Get all reviews for admin moderation
 */
export async function getAdminReviewsAction(options: { statusFilter?: "all" | "pending" | "approved" | "rejected";
    limit?: number;
    lastDocId?: string;
    sortOrder?: "asc" | "desc"; } = {}) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error, data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) { return { success: false as const, error: "Not authorized as admin", data: null };
        }

        const fetchLimit = options.limit || 20;
        const sortDirection = options.sortOrder || "desc";

        let query = db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .orderBy("createdAt", sortDirection);

        if (options.statusFilter && options.statusFilter !== "all") { query = db.collection(COLLECTIONS.PRODUCT_REVIEWS)
                .where("status", "==", options.statusFilter)
                .orderBy("createdAt", sortDirection);
        }

        if (options.lastDocId) { const lastDoc = await db.collection(COLLECTIONS.PRODUCT_REVIEWS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.limit(fetchLimit + 1).get();
        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        const reviews = serializeDocs(docs) as unknown as ProductReview[];
        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;

        // Fetch exact counts if no lastDocId (first page)
        let stats = undefined;
        if (!options.lastDocId) { const allRef = db.collection(COLLECTIONS.PRODUCT_REVIEWS);
            const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
                allRef.where("status", "==", "pending").count().get(),
                allRef.where("status", "==", "approved").count().get(),
                allRef.where("status", "==", "rejected").count().get(),
            ]);

            stats = {
                pending: pendingCount.data().count,
                approved: approvedCount.data().count,
                rejected: rejectedCount.data().count };
        }

        return { error: null, success: true as const, reviews, stats, lastDocId: nextCursor, hasMore
 , data: null };
    } catch (error: any) { logger.error("Get admin reviews error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}
