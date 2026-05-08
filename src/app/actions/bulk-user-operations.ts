/**
 * Bulk User Operations & Advanced Admin Actions
 * 
 * For admin productivity and user support
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission, isSuperAdmin } from "@/lib/admin-permissions";
import { logAuditAction } from "@/lib/admin-audit-log";
import { redis } from "@/lib/redis";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { ActionResponse } from "@/lib/safe-action";

/**
 * Bulk suspend users (Admin only)
 */
export async function bulkSuspendUsersAction(
    userIds: string[],
    reason: string,
    duration?: number // days, undefined = permanent
): Promise<ActionResponse<{ suspended: number; failed: string[] }>> { 
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:suspend")) { 
            return { success: false, error: "Unauthorized: Permission required - users:suspend", data: null };
        }

        if (!userIds || userIds.length === 0) { 
            return { success: false, error: "No users selected", data: null };
        }

        if (userIds.length > 100) { 
            return { success: false, error: "Cannot suspend more than 100 users at once", data: null };
        }

        if (!reason || reason.trim().length < 10) { 
            return { success: false, error: "Suspension reason must be at least 10 characters", data: null };
        }

        const suspendedUntil = duration ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000) : null;

        let suspendedCount = 0;
        const failedIds: string[] = [];

        const batch = db.batch();

        for (const userId of userIds) { try {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                const userDoc = await userRef.get();

                if (!userDoc.exists) {
                    failedIds.push(userId);
                    continue;
                }

                // Prevent suspending admins (unless super_admin)
                const userData = userDoc.data();
                const userRoles = userData?.roles || [];
                if (userRoles.includes("admin") && !isSuperAdmin(session.user.roles)) { failedIds.push(userId);
                    continue;
                }

                batch.update(userRef, { suspended: true,
                    suspendedAt: FieldValue.serverTimestamp(),
                    suspendedBy: session.user.id,
                    suspensionReason: reason,
                    suspendedUntil: suspendedUntil });

                suspendedCount++;
            } catch (error) { failedIds.push(userId);
            }
        }

        await batch.commit();

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            const successfulIds = userIds.filter(id => !failedIds.includes(id));
            const ttlSeconds = duration ? duration * 24 * 60 * 60 : 30 * 24 * 60 * 60;

            await Promise.allSettled([
                ...successfulIds.flatMap(userId => [
                    redis.setex(`user:suspended:${userId}`, ttlSeconds, "true"),
                    invalidateUserCache(userId)
                ]),
                logAuditAction(
                    "user_suspend",
                    "bulk_operation",
                    "users",
                    { adminId: session.user.id,
                        reason,
                        duration,
                        suspendedUntil: suspendedUntil?.toISOString(),
                        suspendedCount,
                        userIds: successfulIds }
                )
            ]);
        } catch (sideEffectError) { logger.error("[bulkSuspendUsersAction] Post-commit side effects failed:", sideEffectError);
        }

        return { success: true, error: null, data: { suspended: suspendedCount, failed: failedIds } };
    } catch (error: any) { 
        logger.error("Failed to bulk suspend users:", error);
        return { success: false, error: error.message || "Failed to suspend users", data: null };
    }
}

/**
 * Bulk activate users (Admin only)
 */
export async function bulkActivateUsersAction(
    userIds: string[]
): Promise<ActionResponse<{ activated: number; failed: string[] }>> { 
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) { 
            return { success: false, error: "Unauthorized: Permission required - users:update", data: null };
        }

        if (!userIds || userIds.length === 0) { 
            return { success: false, error: "No users selected", data: null };
        }

        if (userIds.length > 100) { 
            return { success: false, error: "Cannot activate more than 100 users at once", data: null };
        }

        let activatedCount = 0;
        const failedIds: string[] = [];

        const batch = db.batch();

        for (const userId of userIds) { try {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                const userDoc = await userRef.get();

                if (!userDoc.exists) {
                    failedIds.push(userId);
                    continue;
                }

                batch.update(userRef, { suspended: false,
                    suspendedAt: FieldValue.delete(),
                    suspendedBy: FieldValue.delete(),
                    suspensionReason: FieldValue.delete(),
                    suspendedUntil: FieldValue.delete(),
                    reactivatedBy: session.user.id,
                    reactivatedAt: FieldValue.serverTimestamp() });

                activatedCount++;
            } catch (error) { failedIds.push(userId);
            }
        }

        await batch.commit();

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            const successfulIds = userIds.filter(id => !failedIds.includes(id));

            await Promise.allSettled([
                ...successfulIds.flatMap(userId => [
                    redis.del(`user:suspended:${userId}`),
                    invalidateUserCache(userId)
                ]),
                logAuditAction(
                    "user_activate",
                    "bulk_operation",
                    "users",
                    { adminId: session.user.id,
                        activatedCount,
                        userIds: successfulIds }
                )
            ]);
        } catch (sideEffectError) { logger.error("[bulkActivateUsersAction] Post-commit side effects failed:", sideEffectError);
        }

        return { success: true, error: null, data: { activated: activatedCount, failed: failedIds } };
    } catch (error: any) { 
        logger.error("Failed to bulk activate users:", error);
        return { success: false, error: error.message || "Failed to activate users", data: null };
    }
}

/**
 * Bulk assign roles to users (Admin only)
 */
export async function bulkAssignRolesAction(
    userIds: string[],
    rolesToAdd: string[],
    rolesToRemove: string[]
): Promise<ActionResponse<{ updated: number; failed: string[] }>> { 
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:assign_roles")) { 
            return { success: false, error: "Unauthorized: Permission required - users:assign_roles", data: null };
        }

        if (!userIds || userIds.length === 0) { 
            return { success: false, error: "No users selected", data: null };
        }

        if (userIds.length > 100) { 
            return { success: false, error: "Cannot update more than 100 users at once", data: null };
        }

        // Prevent removing admin role via bulk operation
        if (rolesToRemove.includes("admin") || rolesToRemove.includes("super_admin")) { 
            return { success: false, error: "Cannot remove admin roles via bulk operation", data: null };
        }

        let updatedCount = 0;
        const failedIds: string[] = [];

        const batch = db.batch();

        for (const userId of userIds) { try {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                const userDoc = await userRef.get();

                if (!userDoc.exists) {
                    failedIds.push(userId);
                    continue;
                }

                const userData = userDoc.data();
                const currentRoles = userData?.roles || [];

                // Add new roles
                const newRoles = [...new Set([...currentRoles, ...rolesToAdd])];

                // Remove specified roles
                const finalRoles = newRoles.filter(role => !rolesToRemove.includes(role));

                batch.update(userRef, { roles: finalRoles,
                    updatedBy: session.user.id,
                    updatedAt: FieldValue.serverTimestamp() });

                updatedCount++;
            } catch (error) { failedIds.push(userId);
            }
        }

        await batch.commit();

        await logAuditAction(
            "user_role_change",
            "bulk_operation",
            "users",
            { adminId: session.user.id,
                rolesToAdd,
                rolesToRemove,
                updatedCount,
                userIds: userIds.filter(id => !failedIds.includes(id)) }
        );

        return { success: true, error: null, data: { updated: updatedCount, failed: failedIds } };
    } catch (error: any) { 
        logger.error("Failed to bulk assign roles:", error);
        return { success: false, error: error.message || "Failed to update user roles", data: null };
    }
}

/**
 * Delete multiple users (Super Admin only)
 */
export async function bulkDeleteUsersAction(
    userIds: string[],
    reason: string
): Promise<ActionResponse<{ deleted: number; failed: string[] }>> { 
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:delete")) { 
            return { success: false, error: "Unauthorized: Permission required - users:delete (super_admin only)", data: null };
        }

        if (!userIds || userIds.length === 0) { 
            return { success: false, error: "No users selected", data: null };
        }

        if (userIds.length > 50) { 
            return { success: false, error: "Cannot delete more than 50 users at once", data: null };
        }

        if (!reason || reason.trim().length < 10) { 
            return { success: false, error: "Deletion reason must be at least 10 characters", data: null };
        }

        // Prevent self-deletion
        if (userIds.includes(session.user.id || "")) { 
            return { success: false, error: "Cannot delete your own account", data: null };
        }

        let deletedCount = 0;
        const failedIds: string[] = [];
        const batch = db.batch();

        for (const userId of userIds) { try {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                const userDoc = await userRef.get();

                if (!userDoc.exists) {
                    failedIds.push(userId);
                    continue;
                }

                const userData = userDoc.data();

                // Prevent deleting admins (unless you're super_admin)
                const userRoles = userData?.roles || [];
                if (userRoles.includes("admin") && !isSuperAdmin(session.user.roles)) { failedIds.push(userId);
                    continue;
                }

                // Soft delete: mark as deleted instead of removing document
                batch.update(userRef, { deleted: true,
                    deletedAt: FieldValue.serverTimestamp(),
                    deletedBy: session.user.id,
                    deletionReason: reason,
                    suspended: true });

                deletedCount++;
            } catch (error) { failedIds.push(userId);
            }
        }

        await batch.commit();

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            const successfulIds = userIds.filter(id => !failedIds.includes(id));

            await Promise.allSettled([
                ...successfulIds.flatMap(userId => [
                    redis.setex(`user:suspended:${userId}`, 30 * 24 * 60 * 60, "true"),
                    invalidateUserCache(userId)
                ]),
                logAuditAction(
                    "user_delete",
                    "bulk_operation",
                    "users",
                    { adminId: session.user.id,
                        reason,
                        deletedCount,
                        userIds: successfulIds }
                )
            ]);
        } catch (sideEffectError) { logger.error("[bulkDeleteUsersAction] Post-commit side effects failed:", sideEffectError);
        }

        return { success: true, error: null, data: { deleted: deletedCount, failed: failedIds } };
    } catch (error: any) { 
        logger.error("Failed to bulk delete users:", error);
        return { success: false, error: error.message || "Failed to delete users", data: null };
    }
}

/**
 * Create impersonation token for support (Super Admin only)
 * 
 * SECURITY: Highly sensitive - creates time-limited token for admin to impersonate user
 */
export async function createImpersonationTokenAction(
    targetUserId: string,
    reason: string,
    durationMinutes: number = 30
): Promise<ActionResponse<{ token: string; expiresAt: string }>> { 
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:impersonate")) { return { success: false as const, error: "Unauthorized: Permission required - users:impersonate (super_admin only)", data: null };
        }

        if (!reason || reason.trim().length < 20) { return { success: false as const, error: "Impersonation reason must be at least 20 characters (for audit compliance)", data: null };
        }

        if (durationMinutes < 5 || durationMinutes > 120) { return { success: false as const, error: "Duration must be between 5 and 120 minutes", data: null };
        }

        // Prevent admin from impersonating another admin
        const targetUserRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
        const targetUserDoc = await targetUserRef.get();

        if (!targetUserDoc.exists) { return { success: false as const, error: "Target user not found", data: null };
        }

        const targetUserData = targetUserDoc.data();
        const targetRoles = targetUserData?.roles || [];

        if (targetRoles.includes("admin") || targetRoles.includes("super_admin")) { return { success: false as const, error: "Cannot impersonate admin users", data: null };
        }

        const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

        // Create impersonation record
        const impersonationRef = await db.collection(COLLECTIONS.IMPERSONATION_TOKENS).add({ adminId: session.user.id,
            targetUserId,
            reason,
            createdAt: FieldValue.serverTimestamp(),
            expiresAt,
            active: true,
            usedAt: null });

        // Critical audit log
        await logAuditAction(
            "user_impersonate",
            targetUserId,
            "user",
            { adminId: session.user.id,
                reason,
                durationMinutes,
                expiresAt: expiresAt.toISOString(),
                tokenId: impersonationRef.id }
        );

        return { success: true, error: null, data: { token: impersonationRef.id, expiresAt: expiresAt.toISOString() } };
    } catch (error: any) { 
        logger.error("Failed to create impersonation token:", error);
        return { success: false, error: error.message || "Failed to create impersonation token", data: null };
    }
}

/**
 * Export user data for compliance (Admin only)
 */
export async function exportUserDataAction(
    userId: string
): Promise<ActionResponse<any>> { 
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) { 
            return { success: false, error: "Unauthorized: Permission required - users:read", data: null };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) { 
            return { success: false, error: "User not found", data: null };
        }

        const userData = userDoc.data();

        // Gather all user-related data
        const userDataExport: { profile: any;
            cooperativeMemberships: any[];
            waveEnrollments: any[];
            transactions: any[];
            orders: any[];
            reviews: any[];
            loans: any[];
        } = { profile: userData,
            cooperativeMemberships: [],
            waveEnrollments: [],
            transactions: [],
            orders: [],
            reviews: [],
            loans: [] };

        // Get cooperative memberships
        const cooperativeSnapshot = await db
            .collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .get();
        userDataExport.cooperativeMemberships = cooperativeSnapshot.docs.map(doc => doc.data());

        // Get WAVE enrollments
        const waveSnapshot = await db
            .collection(COLLECTIONS.WAVE_APPLICATIONS)
            .where("userId", "==", userId)
            .get();
        userDataExport.waveEnrollments = waveSnapshot.docs.map(doc => doc.data());

        // Get transactions
        const transactionsSnapshot = await db
            .collection(COLLECTIONS.TRANSACTIONS)
            .where("userId", "==", userId)
            .limit(100)
            .get();
        userDataExport.transactions = transactionsSnapshot.docs.map(doc => doc.data());

        // Get orders
        const ordersSnapshot = await db
            .collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", userId)
            .limit(50)
            .get();
        userDataExport.orders = ordersSnapshot.docs.map(doc => doc.data());

        // Get reviews
        const reviewsSnapshot = await db
            .collection(COLLECTIONS.REVIEWS)
            .where("userId", "==", userId)
            .get();
        userDataExport.reviews = reviewsSnapshot.docs.map(doc => doc.data());

        // Get loans
        const loansSnapshot = await db
            .collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("userId", "==", userId)
            .get();
        userDataExport.loans = loansSnapshot.docs.map(doc => doc.data());

        await logAuditAction(
            "data_export",
            userId,
            "user",
            { adminId: session.user.id,
                exportedCollections: Object.keys(userDataExport) }
        );

        return { success: true, error: null, data: userDataExport };
    } catch (error: any) { 
        logger.error("Failed to export user data:", error);
        return { success: false, error: error.message || "Failed to export user data", data: null };
    }
}
