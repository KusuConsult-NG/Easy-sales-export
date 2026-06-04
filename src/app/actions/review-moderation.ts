/**
 * Review Moderation Admin Actions
 * 
 * SECURITY: Critical for marketplace safety and compliance
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { logAdminAction, createAdminAuditLog } from "@/lib/audit-log";
import { invalidateUserCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";

export interface FlaggedReview { id: string;
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
    status: "pending" | "approved" | "rejected"; }

/**
 * Get flagged reviews (Admin only)
 */
export async function getFlaggedReviewsAction(options?: { status?: "pending" | "approved" | "rejected" | "all";
    minFlags?: number;
    limit?: number; }): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:moderate_reviews")) { return { success: false as const, error: "Unauthorized: Permission required - marketplace:moderate_reviews", data: null };
        }

        let query = db.collection(COLLECTIONS.REVIEWS)
            .where("flagCount", ">", options?.minFlags || 0)
            .orderBy("flagCount", "desc")
            .orderBy("createdAt", "desc");

        if (options?.status && options.status !== "all") { query = query.where("moderationStatus", "==", options.status);
        }

        if (options?.limit) { query = query.limit(options.limit);
        }

        const snapshot = await query.get();
        const reviews: FlaggedReview[] = [];

        for (const doc of snapshot.docs) { const data = doc.data();

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
                status: data.moderationStatus || "pending" });
        }

        return { success: true as const, data: reviews, error: null };
    } catch (error: any) { logger.error("Failed to get flagged reviews:", error);
        return { success: false as const, error: error.message || "Failed to fetch reviews", data: null };
    }
}

/**
 * Approve a flagged review (Admin only)
 */
export async function approveReviewAction(
    reviewId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:moderate_reviews")) { return { success: false as const, error: "Unauthorized: Permission required - marketplace:moderate_reviews", data: null };
        }

        const reviewRef = db.collection(COLLECTIONS.REVIEWS).doc(reviewId);
        const reviewDoc = await reviewRef.get();

        if (!reviewDoc.exists) { return { success: false as const, error: "Review not found", data: null };
        }

        await reviewRef.update({ moderationStatus: "approved",
            moderatedBy: session.user.id,
            moderatedAt: FieldValue.serverTimestamp(),
            flagCount: 0,
            flaggedBy: [],
            flagReasons: [] });

        await createAdminAuditLog({ action: "content:approve",
            userId: session.user.id,
            targetId: reviewId,
            targetType: "review",
            metadata: { productId: reviewDoc.data()?.productId } });

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Failed to approve review:", error);
        return { success: false as const, error: error.message || "Failed to approve review", data: null };
    }
}

/**
 * Delete inappropriate review (Admin only)
 */
export async function deleteReviewAction(
    reviewId: string,
    reason: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:moderate_reviews")) { return { success: false as const, error: "Unauthorized: Permission required - marketplace:moderate_reviews", data: null };
        }

        if (!reason || reason.trim().length < 10) { return { success: false as const, error: "Deletion reason must be at least 10 characters", data: null };
        }

        const reviewRef = db.collection(COLLECTIONS.REVIEWS).doc(reviewId);
        const reviewDoc = await reviewRef.get();

        if (!reviewDoc.exists) { return { success: false as const, error: "Review not found", data: null };
        }

        const reviewData = reviewDoc.data();

        // Soft delete: mark as deleted instead of removing
        await reviewRef.update({ deleted: true,
            deletedBy: session.user.id,
            deletedAt: FieldValue.serverTimestamp(),
            deletionReason: reason,
            moderationStatus: "rejected" });

        // Update product rating stats (remove this review from calculations)
        const productId = reviewData?.productId;
        if (productId) { const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
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
                    reviewCount: newCount });
            }
        }

        await createAdminAuditLog({ action: "content:reject",
            userId: session.user.id,
            targetId: reviewId,
            targetType: "review",
            metadata: {
                reason,
                reviewerId: reviewData?.userId,
                productId: reviewData?.productId } });

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Failed to delete review:", error);
        return { success: false as const, error: error.message || "Failed to delete review", data: null };
    }
}

/**
 * Suspend user for review policy violations (Admin only)
 */
export async function suspendReviewerAction(
    userId: string,
    duration: number, // days
    reason: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:suspend")) { return { success: false as const, error: "Unauthorized: Permission required - users:suspend", data: null };
        }

        if (!reason || reason.trim().length < 10) { return { success: false as const, error: "Suspension reason must be at least 10 characters", data: null };
        }

        if (duration < 1 || duration > 365) { return { success: false as const, error: "Duration must be between 1 and 365 days", data: null };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) { return { success: false as const, error: "User not found", data: null };
        }

        const suspendedUntil = new Date();
        suspendedUntil.setDate(suspendedUntil.getDate() + duration);

        await userRef.update({ reviewSuspended: true,
            reviewSuspendedUntil: suspendedUntil,
            reviewSuspensionReason: reason,
            suspendedBy: session.user.id,
            suspendedAt: FieldValue.serverTimestamp() });

        await createAdminAuditLog({ action: "user_suspend",
            userId: session.user.id,
            targetId: userId,
            targetType: "user",
            metadata: {
                reason,
                duration,
                suspendedUntil: suspendedUntil.toISOString(),
                suspensionType: "review" } });

        // Invalidate Cache
        try { await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (err) { logger.error("Cache invalidation failed after user suspension", err);
        }

        return { success: true as const, error: null };
    } catch (error: any) { logger.error("Failed to suspend reviewer:", error);
        return { success: false as const, error: error.message || "Failed to suspend user", data: null };
    }
}

/**
 * Bulk approve reviews (Admin only)
 */
export async function bulkApproveReviewsAction(
    reviewIds: string[]
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "marketplace:moderate_reviews")) { return { success: false as const, approved: 0, error: "Unauthorized: Permission required - marketplace:moderate_reviews", data: null };
        }

        if (reviewIds.length === 0) { return { success: false as const, approved: 0, error: "No reviews selected", data: null };
        }

        if (reviewIds.length > 50) { return { success: false as const, approved: 0, error: "Cannot approve more than 50 reviews at once", data: null };
        }

        let approvedCount = 0;
        const batch = db.batch();

        for (const reviewId of reviewIds) { const reviewRef = db.collection(COLLECTIONS.REVIEWS).doc(reviewId);
            batch.update(reviewRef, {
                moderationStatus: "approved",
                moderatedBy: session.user.id,
                moderatedAt: FieldValue.serverTimestamp(),
                flagCount: 0,
                flaggedBy: [],
                flagReasons: [] });
            approvedCount++;
        }

        await batch.commit();

        await createAdminAuditLog({ action: "content:approve",
            userId: session.user.id,
            targetId: "bulk_operation",
            targetType: "reviews",
            metadata: {
                reviewCount: approvedCount,
                reviewIds } });

        return { success: true as const, approved: approvedCount, error: null };
    } catch (error: any) { logger.error("Failed to bulk approve reviews:", error);
        return { success: false as const, approved: 0, error: error.message || "Failed to approve reviews", data: null };
    }
}
