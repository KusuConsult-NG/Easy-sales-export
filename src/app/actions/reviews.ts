/**
 * Server Actions for Product Reviews System
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { ProductReview, Order } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { serializeDocs } from "@/lib/firestore-serialize";
import { z } from "zod";
import { ActionResponse } from "@/lib/safe-action";
import { escapeHtml } from "@/lib/utils";
import { toDateOrNull } from "@/lib/date-utils";

const reviewSchema = z.object({ rating: z.number().min(1, "Rating must be at least 1").max(5, "Rating cannot exceed 5"),
    comment: z.string().trim().min(20, "Review must be at least 20 characters").max(500, "Review must not exceed 500 characters") });

/** How many pictures a single review may carry. */
const MAX_REVIEW_IMAGES = 8;

/**
 * Is this string something that can only ever resolve to an image location?
 *
 * Rejects `javascript:`, `data:` and every other scheme by allowing exactly two
 * shapes: an absolute https URL, or a root-relative path on this site.
 * Protocol-relative ("//evil.example") is rejected too — it reads as a path and
 * behaves as a URL.
 */
function isSafeImageReference(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;

    if (trimmed.startsWith("//")) return false;
    if (trimmed.startsWith("/")) return true;

    try {
        return new URL(trimmed).protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Create a product review
 */
export async function createReviewAction(params: { 
    productId: string;
    orderId: string;
    rating: number;
    comment: string;
    images?: string[]; 
}): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
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

        // `images` arrived from the caller and was stored exactly as sent — any
        // number of them, any string. These are rendered beside a review, so an
        // unbounded list of arbitrary URIs is both a layout problem and a way to
        // put `javascript:` or `data:` into an attribute, depending on how a
        // future component uses them.
        //
        // Bounded, and restricted to shapes that can only ever be a picture:
        // an https URL, or a path within this site.
        if (!Array.isArray(images)) {
            return { success: false as const, error: "Images must be a list", data: null };
        }
        if (images.length > MAX_REVIEW_IMAGES) {
            return { success: false as const, error: `A review may have at most ${MAX_REVIEW_IMAGES} images`, data: null };
        }
        for (const image of images) {
            if (typeof image !== "string" || image.length > 2000 || !isSafeImageReference(image)) {
                return { success: false as const, error: "Images must be https URLs or site paths", data: null };
            }
        }

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
            createdAt: FieldValue.serverTimestamp() as any };

        await db.collection(COLLECTIONS.PRODUCT_REVIEWS).add(reviewData);

        return { success: true as const, data: null, error: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Create review error:", error);
        return { success: false as const, error: message, data: null };
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
): Promise<ActionResponse<{ reviews: ProductReview[] }>> { 
    try {
        const baseQuery = db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("productId", "==", productId)
            .where("status", "==", "approved");

        let query = baseQuery;
        if (filters?.rating) {
            query = query.where("rating", "==", filters.rating);
        }

        let snapshot;
        let needsMemorySort = false;
        try {
            snapshot = await query.orderBy("createdAt", "desc").limit(50).get();
        } catch (e: any) {
            const errMsg = e.message ? e.message.toLowerCase() : "";
            if (errMsg.includes("index") || errMsg.includes("failed_precondition") || String(e.code) === "9" || errMsg.includes("precondition")) {
                logger.warn("getProductReviewsAction failed due to missing index. Falling back to in-memory sorting.");
                // Fetch without orderBy, limit to 200 to sort in memory
                snapshot = await query.limit(200).get();
                needsMemorySort = true;
            } else {
                throw e;
            }
        }

        const reviews = serializeDocs(snapshot.docs) as unknown as ProductReview[];

        // Filter by verified if specified
        let filteredReviews = filters?.verified !== undefined
            ? reviews.filter((r) => r.verified === filters.verified)
            : reviews;

        if (needsMemorySort) {
            filteredReviews.sort((a, b) => {
                let aMs = 0;
                let bMs = 0;
                const aTime = a.createdAt;
                const bTime = b.createdAt;

                if (aTime) {
                    if (aTime instanceof Date) {
                        aMs = aTime.getTime();
                    } else if (typeof aTime === 'object' && 'toDate' in aTime && typeof (aTime as any).toDate === 'function') {
                        aMs = (aTime as any).toDate().getTime();
                    } else if (typeof aTime === 'object' && 'seconds' in aTime) {
                        aMs = (aTime as any).seconds * 1000;
                    } else if (typeof aTime === 'object' && '_seconds' in aTime) {
                        aMs = (aTime as any)._seconds * 1000;
                    } else {
                        aMs = new Date(aTime as any).getTime() || 0;
                    }
                }

                if (bTime) {
                    if (bTime instanceof Date) {
                        bMs = bTime.getTime();
                    } else if (typeof bTime === 'object' && 'toDate' in bTime && typeof (bTime as any).toDate === 'function') {
                        bMs = (bTime as any).toDate().getTime();
                    } else if (typeof bTime === 'object' && 'seconds' in bTime) {
                        bMs = (bTime as any).seconds * 1000;
                    } else if (typeof bTime === 'object' && '_seconds' in bTime) {
                        bMs = (bTime as any)._seconds * 1000;
                    } else {
                        bMs = new Date(bTime as any).getTime() || 0;
                    }
                }

                return bMs - aMs;
            });
            // Apply limit after sorting
            filteredReviews = filteredReviews.slice(0, 50);
        }

        return { success: true as const, data: { reviews: filteredReviews }, error: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Get product reviews error:", error);
        return { success: false as const, error: message, data: null };
    }
}

/**
 * Get user's own reviews
 */
export async function getUserReviewsAction(): Promise<ActionResponse<{ reviews: ProductReview[] }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const baseQuery = db.collection(COLLECTIONS.PRODUCT_REVIEWS).where("userId", "==", userId);
        
        let snapshot;
        let needsMemorySort = false;
        try {
            snapshot = await baseQuery.orderBy("createdAt", "desc").get();
        } catch (e: any) {
            const errMsg = e.message ? e.message.toLowerCase() : "";
            if (errMsg.includes("index") || errMsg.includes("failed_precondition") || String(e.code) === "9" || errMsg.includes("precondition")) {
                logger.warn("getUserReviewsAction failed due to missing index. Falling back to in-memory sorting.");
                snapshot = await baseQuery.get();
                needsMemorySort = true;
            } else {
                throw e;
            }
        }

        const reviews = serializeDocs(snapshot.docs) as unknown as ProductReview[];

        if (needsMemorySort) {
            reviews.sort((a, b) => {
                let aMs = 0;
                let bMs = 0;
                const aTime = a.createdAt;
                const bTime = b.createdAt;

                if (aTime) {
                    if (aTime instanceof Date) {
                        aMs = aTime.getTime();
                    } else if (typeof aTime === 'object' && 'toDate' in aTime && typeof (aTime as any).toDate === 'function') {
                        aMs = (aTime as any).toDate().getTime();
                    } else if (typeof aTime === 'object' && 'seconds' in aTime) {
                        aMs = (aTime as any).seconds * 1000;
                    } else if (typeof aTime === 'object' && '_seconds' in aTime) {
                        aMs = (aTime as any)._seconds * 1000;
                    } else {
                        aMs = new Date(aTime as any).getTime() || 0;
                    }
                }

                if (bTime) {
                    if (bTime instanceof Date) {
                        bMs = bTime.getTime();
                    } else if (typeof bTime === 'object' && 'toDate' in bTime && typeof (bTime as any).toDate === 'function') {
                        bMs = (bTime as any).toDate().getTime();
                    } else if (typeof bTime === 'object' && 'seconds' in bTime) {
                        bMs = (bTime as any).seconds * 1000;
                    } else if (typeof bTime === 'object' && '_seconds' in bTime) {
                        bMs = (bTime as any)._seconds * 1000;
                    } else {
                        bMs = new Date(bTime as any).getTime() || 0;
                    }
                }

                return bMs - aMs;
            });
        }

        return { success: true as const, data: { reviews }, error: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Get user reviews error:", error);
        return { success: false as const, error: message, data: null };
    }
}

/**
 * Update a review (within 30 days)
 */
export async function updateReviewAction(
    reviewId: string,
    rating: number,
    comment: string
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
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
        //
        // This handled only a Timestamp with .toDate() and a real Date, and fell
        // back to `new Date()` for everything else — so an unrecognised
        // createdAt made the review zero days old and permanently editable. The
        // read paths in this same file coerce `seconds`, `_seconds`, Date and
        // string forms explicitly, which is the evidence that those shapes
        // occur here.
        //
        // Worse than the bypass: `'toDate' in review.createdAt` THROWS on a
        // string or a null, because `in` needs an object. A review whose
        // createdAt had been serialised to an ISO string could not be edited at
        // all, failing with a generic error from the outer catch.
        //
        // toDateOrNull handles every shape and returns null when it genuinely
        // cannot tell. A window rule must fail CLOSED there: "we cannot tell
        // when this was written" is not "it was written just now".
        const reviewDate = toDateOrNull(review.createdAt);
        if (!reviewDate) {
            logger.warn("[updateReviewAction] Review has an unreadable createdAt; refusing the edit", { reviewId });
            return { success: false as const, error: "This review's date cannot be determined, so it can no longer be edited", data: null };
        }
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

        return { success: true as const, data: null, error: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Update review error:", error);
        return { success: false as const, error: message, data: null };
    }
}

/**
 * Moderate a review (Admin only)
 */
export async function moderateReviewAction(
    reviewId: string,
    status: "approved" | "rejected",
    rejectionReason?: string
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        // A super_admin who does not also hold the plain 'admin' role was
        // refused here. hasRole is a literal includes(), so this is the same
        // lockout fixed in #115, #122 and #134 — and #122 fixed it in
        // assignDisputeAction, in this very codebase, while leaving these
        // siblings. The #138 ratchet did not catch them because it matches the
        // `roles.includes("admin")` spelling and these say `hasRole(...)`.
        //
        // Deliberately NOT switched to isAdmin(), which also admits moderator,
        // support and every module admin. Widening review moderation while
        // fixing a lockout would be a bad trade made quietly.
        const callerRoles = userData?.roles || [];
        if (!hasRole(callerRoles, "admin") && !hasRole(callerRoles, "super_admin")) {
            return { success: false as const, error: "Not authorized as admin", data: null };
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

        return { success: true as const, data: null, error: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Moderate review error:", error);
        return { success: false as const, error: message, data: null };
    }
}

/**
 * Get seller rating statistics
 */
export async function getSellerRatingAction(sellerId: string): Promise<ActionResponse<{ averageRating: number; totalReviews: number; distribution: Record<number, number> }>> { 
    try {
        const snapshot = await db.collection(COLLECTIONS.PRODUCT_REVIEWS)
            .where("sellerId", "==", sellerId)
            .where("status", "==", "approved")
            .get();

        const reviews: ProductReview[] = snapshot.docs.map((doc) => doc.data()) as ProductReview[];

        if (reviews.length === 0) {
            return { error: null, success: true as const, data: {
                    averageRating: 0, totalReviews: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
                }
            };
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

        return { error: null, success: true as const, data: {
                averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
                totalReviews: reviews.length, 
                distribution
            }
        };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Get seller rating error:", error);
        return { success: false as const, error: message, data: null };
    }
}

/**
 * Get all reviews for admin moderation
 */
export async function getAdminReviewsAction(options: { 
    statusFilter?: "all" | "pending" | "approved" | "rejected";
    limit?: number;
    lastDocId?: string;
    sortOrder?: "asc" | "desc"; 
} = {}): Promise<ActionResponse<{ 
    reviews: ProductReview[]; 
    stats?: { pending: number; approved: number; rejected: number }; 
    lastDocId?: string; 
    hasMore: boolean 
}>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        // A super_admin who does not also hold the plain 'admin' role was
        // refused here. hasRole is a literal includes(), so this is the same
        // lockout fixed in #115, #122 and #134 — and #122 fixed it in
        // assignDisputeAction, in this very codebase, while leaving these
        // siblings. The #138 ratchet did not catch them because it matches the
        // `roles.includes("admin")` spelling and these say `hasRole(...)`.
        //
        // Deliberately NOT switched to isAdmin(), which also admits moderator,
        // support and every module admin. Widening review moderation while
        // fixing a lockout would be a bad trade made quietly.
        const callerRoles = userData?.roles || [];
        if (!hasRole(callerRoles, "admin") && !hasRole(callerRoles, "super_admin")) {
            return { success: false as const, error: "Not authorized as admin", data: null };
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

        return { 
            error: null, 
            success: true as const, 
            data: { reviews, stats, lastDocId: nextCursor, hasMore }
        };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Get admin reviews error:", error);
        return { success: false as const, error: message, data: null };
    }
}
