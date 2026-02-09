/**
 * Review Moderation Admin Actions
 * 
 * SECURITY: Critical for marketplace safety and compliance
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { logAuditAction } from "@/lib/admin-audit-log";

export interface FlaggedReview {
    id: string;
    productId: string;
    productTitle: string;
    reviewerId: string;
    reviewerName: string;
    reviewerEmail: string;
    rating: number;
    comment: string;
    flaggedBy: string[];
    flagReasons: string[];
    flagCount: number;
    createdAt: Date;
    status: "pending" | "approved" | "rejected";
}

/**
 * Get flagged reviews (Admin only)
 */
export async function getFlaggedReviewsAction(options?: {
    status?: "pending" | "approved" | "rejected" | "all";
    minFlags?: number;
    limit?: number;
}): Promise<{
    success: boolean;
    data?: FlaggedReview[];
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:moderate_reviews")) {
            return { success: false, error: "Unauthorized: Permission required - marketplace:moderate_reviews" };
        }

        let query = db.collection(COLLECTIONS.REVIEWS)
            .where("flagCount", ">", options?.minFlags || 0)
            .orderBy("flagCount", "desc")
            .orderBy("createdAt", "desc");

        if (options?.status && options.status !== "all") {
            query = query.where("moderationStatus", "==", options.status);
        }

        if (options?.limit) {
            query = query.limit(options.limit);
        }

        const snapshot = await query.get();
        const reviews: FlaggedReview[] = [];

        for (const doc of snapshot.docs) {
            const data = doc.data();

            // Get product title
            const productDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(data.productId).get();
            const productTitle = productDoc.exists ? productDoc.data()?.title : "Unknown Product";

            // Get reviewer info
            const reviewerDoc = await db.collection(COLLECTIONS.USERS).doc(data.userId).get();
            const reviewerData = reviewerDoc.data();

            reviews.push({
                id: doc.id,
                productId: data.productId,
                productTitle,
                reviewerId: data.userId,
                reviewerName: reviewerData?.displayName || "Unknown",
                reviewerEmail: reviewerData?.email || "",
                rating: data.rating,
                comment: data.comment,
                flaggedBy: data.flaggedBy || [],
                flagReasons: data.flagReasons || [],
                flagCount: data.flagCount || 0,
                createdAt: data.createdAt?.toDate() || new Date(),
                status: data.moderationStatus || "pending",
            });
        }

        return { success: true, data: reviews };
    } catch (error: any) {
        console.error("Failed to get flagged reviews:", error);
        return { success: false, error: error.message || "Failed to fetch reviews" };
    }
}

/**
 * Approve a flagged review (Admin only)
 */
export async function approveReviewAction(
    reviewId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:moderate_reviews")) {
            return { success: false, error: "Unauthorized: Permission required - marketplace:moderate_reviews" };
        }

        const reviewRef = db.collection(COLLECTIONS.REVIEWS).doc(reviewId);
        const reviewDoc = await reviewRef.get();

        if (!reviewDoc.exists) {
            return { success: false, error: "Review not found" };
        }

        await reviewRef.update({
            moderationStatus: "approved",
            moderatedBy: session.user.id,
            moderatedAt: FieldValue.serverTimestamp(),
            flagCount: 0,
            flaggedBy: [],
            flagReasons: [],
        });

        await logAuditAction(
            "content:approve",
            reviewId,
            "review",
            {
                adminId: session.user.id,
                productId: reviewDoc.data()?.productId,
            }
        );

        return { success: true };
    } catch (error: any) {
        console.error("Failed to approve review:", error);
        return { success: false, error: error.message || "Failed to approve review" };
    }
}

/**
 * Delete inappropriate review (Admin only)
 */
export async function deleteReviewAction(
    reviewId: string,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:moderate_reviews")) {
            return { success: false, error: "Unauthorized: Permission required - marketplace:moderate_reviews" };
        }

        if (!reason || reason.trim().length < 10) {
            return { success: false, error: "Deletion reason must be at least 10 characters" };
        }

        const reviewRef = db.collection(COLLECTIONS.REVIEWS).doc(reviewId);
        const reviewDoc = await reviewRef.get();

        if (!reviewDoc.exists) {
            return { success: false, error: "Review not found" };
        }

        const reviewData = reviewDoc.data();

        // Soft delete: mark as deleted instead of removing
        await reviewRef.update({
            deleted: true,
            deletedBy: session.user.id,
            deletedAt: FieldValue.serverTimestamp(),
            deletionReason: reason,
            moderationStatus: "rejected",
        });

        // Update product rating stats (remove this review from calculations)
        const productId = reviewData?.productId;
        if (productId) {
            const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
            const productDoc = await productRef.get();

            if (productDoc.exists) {
                const data = productDoc.data();
                const currentRating = data?.rating || 0;
                const currentReviewCount = data?.reviewCount || 1;
                const reviewRating = reviewData?.rating || 0;

                // Recalculate average rating
                const totalRating = currentRating * currentReviewCount;
                const newTotal = totalRating - reviewRating;
                const newCount = Math.max(0, currentReviewCount - 1);
                const newAverage = newCount > 0 ? newTotal / newCount : 0;

                await productRef.update({
                    rating: newAverage,
                    reviewCount: newCount,
                });
            }
        }

        await logAuditAction(
            "content:reject",
            reviewId,
            "review",
            {
                adminId: session.user.id,
                reason,
                reviewerId: reviewData?.userId,
                productId: reviewData?.productId,
            }
        );

        return { success: true };
    } catch (error: any) {
        console.error("Failed to delete review:", error);
        return { success: false, error: error.message || "Failed to delete review" };
    }
}

/**
 * Suspend user for review policy violations (Admin only)
 */
export async function suspendReviewerAction(
    userId: string,
    duration: number, // days
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:suspend")) {
            return { success: false, error: "Unauthorized: Permission required - users:suspend" };
        }

        if (!reason || reason.trim().length < 10) {
            return { success: false, error: "Suspension reason must be at least 10 characters" };
        }

        if (duration < 1 || duration > 365) {
            return { success: false, error: "Duration must be between 1 and 365 days" };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { success: false, error: "User not found" };
        }

        const suspendedUntil = new Date();
        suspendedUntil.setDate(suspendedUntil.getDate() + duration);

        await userRef.update({
            reviewSuspended: true,
            reviewSuspendedUntil: suspendedUntil,
            reviewSuspensionReason: reason,
            suspendedBy: session.user.id,
            suspendedAt: FieldValue.serverTimestamp(),
        });

        await logAuditAction(
            "user_suspend",
            userId,
            "user",
            {
                adminId: session.user.id,
                reason,
                duration,
                suspendedUntil: suspendedUntil.toISOString(),
                suspensionType: "review",
            }
        );

        return { success: true };
    } catch (error: any) {
        console.error("Failed to suspend reviewer:", error);
        return { success: false, error: error.message || "Failed to suspend user" };
    }
}

/**
 * Bulk approve reviews (Admin only)
 */
export async function bulkApproveReviewsAction(
    reviewIds: string[]
): Promise<{ success: boolean; approved: number; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:moderate_reviews")) {
            return { success: false, approved: 0, error: "Unauthorized: Permission required - marketplace:moderate_reviews" };
        }

        if (reviewIds.length === 0) {
            return { success: false, approved: 0, error: "No reviews selected" };
        }

        if (reviewIds.length > 50) {
            return { success: false, approved: 0, error: "Cannot approve more than 50 reviews at once" };
        }

        let approvedCount = 0;
        const batch = db.batch();

        for (const reviewId of reviewIds) {
            const reviewRef = db.collection(COLLECTIONS.REVIEWS).doc(reviewId);
            batch.update(reviewRef, {
                moderationStatus: "approved",
                moderatedBy: session.user.id,
                moderatedAt: FieldValue.serverTimestamp(),
                flagCount: 0,
                flaggedBy: [],
                flagReasons: [],
            });
            approvedCount++;
        }

        await batch.commit();

        await logAuditAction(
            "content:approve",
            "bulk_operation",
            "reviews",
            {
                adminId: session.user.id,
                reviewCount: approvedCount,
                reviewIds,
            }
        );

        return { success: true, approved: approvedCount };
    } catch (error: any) {
        console.error("Failed to bulk approve reviews:", error);
        return { success: false, approved: 0, error: error.message || "Failed to approve reviews" };
    }
}
