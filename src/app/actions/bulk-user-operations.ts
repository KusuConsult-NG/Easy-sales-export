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

/**
 * Bulk suspend users (Admin only)
 */
export async function bulkSuspendUsersAction(
    userIds: string[],
    reason: string,
    duration?: number // days, undefined = permanent
): Promise<{
    success: boolean;
    suspended: number;
    failed: string[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:suspend")) {
            return {
                success: false,
                suspended: 0,
                failed: userIds,
                error: "Unauthorized: Permission required - users:suspend",
            };
        }

        if (!userIds || userIds.length === 0) {
            return { success: false, suspended: 0, failed: [], error: "No users selected" };
        }

        if (userIds.length > 100) {
            return {
                success: false,
                suspended: 0,
                failed: userIds,
                error: "Cannot suspend more than 100 users at once",
            };
        }

        if (!reason || reason.trim().length < 10) {
            return {
                success: false,
                suspended: 0,
                failed: userIds,
                error: "Suspension reason must be at least 10 characters",
            };
        }

        const suspendedUntil = duration ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000) : null;

        let suspendedCount = 0;
        const failedIds: string[] = [];

        const batch = db.batch();

        for (const userId of userIds) {
            try {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                const userDoc = await userRef.get();

                if (!userDoc.exists) {
                    failedIds.push(userId);
                    continue;
                }

                // Prevent suspending admins (unless super_admin)
                const userData = userDoc.data();
                const userRoles = userData?.roles || [];
                if (userRoles.includes("admin") && !isSuperAdmin(session.user.roles)) {
                    failedIds.push(userId);
                    continue;
                }

                batch.update(userRef, {
                    suspended: true,
                    suspendedAt: FieldValue.serverTimestamp(),
                    suspendedBy: session.user.id,
                    suspensionReason: reason,
                    suspendedUntil: suspendedUntil,
                });

                // 🛡️ SECURITY: Set Redis Key for Immediate Session Revocation
                // TTL: Duration or 30 days (max session length)
                const ttlSeconds = duration ? duration * 24 * 60 * 60 : 30 * 24 * 60 * 60;
                await redis.setex(`user:suspended:${userId}`, ttlSeconds, "true");

                // Clear other caches
                await invalidateUserCache(userId);

                suspendedCount++;
            } catch (error) {
                failedIds.push(userId);
            }
        }

        await batch.commit();

        await logAuditAction(
            "user_suspend",
            "bulk_operation",
            "users",
            {
                adminId: session.user.id,
                reason,
                duration,
                suspendedUntil: suspendedUntil?.toISOString(),
                suspendedCount,
                userIds: userIds.filter(id => !failedIds.includes(id)),
            }
        );

        return {
            success: true,
            suspended: suspendedCount,
            failed: failedIds,
        };
    } catch (error: any) {
        logger.error("Failed to bulk suspend users:", error);
        return {
            success: false,
            suspended: 0,
            failed: userIds,
            error: error.message || "Failed to suspend users",
        };
    }
}

/**
 * Bulk activate users (Admin only)
 */
export async function bulkActivateUsersAction(
    userIds: string[]
): Promise<{
    success: boolean;
    activated: number;
    failed: string[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:update")) {
            return {
                success: false,
                activated: 0,
                failed: userIds,
                error: "Unauthorized: Permission required - users:update",
            };
        }

        if (!userIds || userIds.length === 0) {
            return { success: false, activated: 0, failed: [], error: "No users selected" };
        }

        if (userIds.length > 100) {
            return {
                success: false,
                activated: 0,
                failed: userIds,
                error: "Cannot activate more than 100 users at once",
            };
        }

        let activatedCount = 0;
        const failedIds: string[] = [];

        const batch = db.batch();

        for (const userId of userIds) {
            try {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                const userDoc = await userRef.get();

                if (!userDoc.exists) {
                    failedIds.push(userId);
                    continue;
                }

                batch.update(userRef, {
                    suspended: false,
                    suspendedAt: FieldValue.delete(),
                    suspendedBy: FieldValue.delete(),
                    suspensionReason: FieldValue.delete(),
                    suspendedUntil: FieldValue.delete(),
                    reactivatedBy: session.user.id,
                    reactivatedAt: FieldValue.serverTimestamp(),
                });

                // 🛡️ SECURITY: Remove Redis Suspension Key
                await redis.del(`user:suspended:${userId}`);
                await invalidateUserCache(userId);

                activatedCount++;
            } catch (error) {
                failedIds.push(userId);
            }
        }

        await batch.commit();

        await logAuditAction(
            "user_activate",
            "bulk_operation",
            "users",
            {
                adminId: session.user.id,
                activatedCount,
                userIds: userIds.filter(id => !failedIds.includes(id)),
            }
        );

        return {
            success: true,
            activated: activatedCount,
            failed: failedIds,
        };
    } catch (error: any) {
        logger.error("Failed to bulk activate users:", error);
        return {
            success: false,
            activated: 0,
            failed: userIds,
            error: error.message || "Failed to activate users",
        };
    }
}

/**
 * Bulk assign roles to users (Admin only)
 */
export async function bulkAssignRolesAction(
    userIds: string[],
    rolesToAdd: string[],
    rolesToRemove: string[]
): Promise<{
    success: boolean;
    updated: number;
    failed: string[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:assign_roles")) {
            return {
                success: false,
                updated: 0,
                failed: userIds,
                error: "Unauthorized: Permission required - users:assign_roles",
            };
        }

        if (!userIds || userIds.length === 0) {
            return { success: false, updated: 0, failed: [], error: "No users selected" };
        }

        if (userIds.length > 100) {
            return {
                success: false,
                updated: 0,
                failed: userIds,
                error: "Cannot update more than 100 users at once",
            };
        }

        // Prevent removing admin role via bulk operation
        if (rolesToRemove.includes("admin") || rolesToRemove.includes("super_admin")) {
            return {
                success: false,
                updated: 0,
                failed: userIds,
                error: "Cannot remove admin roles via bulk operation",
            };
        }

        let updatedCount = 0;
        const failedIds: string[] = [];

        const batch = db.batch();

        for (const userId of userIds) {
            try {
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

                batch.update(userRef, {
                    roles: finalRoles,
                    updatedBy: session.user.id,
                    updatedAt: FieldValue.serverTimestamp(),
                });

                updatedCount++;
            } catch (error) {
                failedIds.push(userId);
            }
        }

        await batch.commit();

        await logAuditAction(
            "user_role_change",
            "bulk_operation",
            "users",
            {
                adminId: session.user.id,
                rolesToAdd,
                rolesToRemove,
                updatedCount,
                userIds: userIds.filter(id => !failedIds.includes(id)),
            }
        );

        return {
            success: true,
            updated: updatedCount,
            failed: failedIds,
        };
    } catch (error: any) {
        logger.error("Failed to bulk assign roles:", error);
        return {
            success: false,
            updated: 0,
            failed: userIds,
            error: error.message || "Failed to update user roles",
        };
    }
}

/**
 * Delete multiple users (Super Admin only)
 */
export async function bulkDeleteUsersAction(
    userIds: string[],
    reason: string
): Promise<{
    success: boolean;
    deleted: number;
    failed: string[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:delete")) {
            return {
                success: false,
                deleted: 0,
                failed: userIds,
                error: "Unauthorized: Permission required - users:delete (super_admin only)",
            };
        }

        if (!userIds || userIds.length === 0) {
            return { success: false, deleted: 0, failed: [], error: "No users selected" };
        }

        if (userIds.length > 50) {
            return {
                success: false,
                deleted: 0,
                failed: userIds,
                error: "Cannot delete more than 50 users at once",
            };
        }

        if (!reason || reason.trim().length < 10) {
            return {
                success: false,
                deleted: 0,
                failed: userIds,
                error: "Deletion reason must be at least 10 characters",
            };
        }

        // Prevent self-deletion
        if (userIds.includes(session.user.id || "")) {
            return {
                success: false,
                deleted: 0,
                failed: userIds,
                error: "Cannot delete your own account",
            };
        }

        let deletedCount = 0;
        const failedIds: string[] = [];

        for (const userId of userIds) {
            try {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                const userDoc = await userRef.get();

                if (!userDoc.exists) {
                    failedIds.push(userId);
                    continue;
                }

                const userData = userDoc.data();

                // Prevent deleting admins (unless you're super_admin)
                const userRoles = userData?.roles || [];
                if (userRoles.includes("admin") && !isSuperAdmin(session.user.roles)) {
                    failedIds.push(userId);
                    continue;
                }

                // Soft delete: mark as deleted instead of removing document
                await userRef.update({
                    deleted: true,
                    deletedAt: FieldValue.serverTimestamp(),
                    deletedBy: session.user.id,
                    deletionReason: reason,
                    suspended: true,
                });

                // 🛡️ SECURITY: Ban user in Redis to kill session immediately
                // Set for 30 days (max session)
                await redis.setex(`user:suspended:${userId}`, 30 * 24 * 60 * 60, "true");
                await invalidateUserCache(userId);

                deletedCount++;
            } catch (error) {
                failedIds.push(userId);
            }
        }

        await logAuditAction(
            "user_delete",
            "bulk_operation",
            "users",
            {
                adminId: session.user.id,
                reason,
                deletedCount,
                userIds: userIds.filter(id => !failedIds.includes(id)),
            }
        );

        return {
            success: true,
            deleted: deletedCount,
            failed: failedIds,
        };
    } catch (error: any) {
        logger.error("Failed to bulk delete users:", error);
        return {
            success: false,
            deleted: 0,
            failed: userIds,
            error: error.message || "Failed to delete users",
        };
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
): Promise<{
    success: boolean;
    token?: string;
    expiresAt?: string;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:impersonate")) {
            return {
                success: false,
                error: "Unauthorized: Permission required - users:impersonate (super_admin only)",
            };
        }

        if (!reason || reason.trim().length < 20) {
            return {
                success: false,
                error: "Impersonation reason must be at least 20 characters (for audit compliance)",
            };
        }

        if (durationMinutes < 5 || durationMinutes > 120) {
            return {
                success: false,
                error: "Duration must be between 5 and 120 minutes",
            };
        }

        // Prevent admin from impersonating another admin
        const targetUserRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
        const targetUserDoc = await targetUserRef.get();

        if (!targetUserDoc.exists) {
            return { success: false, error: "Target user not found" };
        }

        const targetUserData = targetUserDoc.data();
        const targetRoles = targetUserData?.roles || [];

        if (targetRoles.includes("admin") || targetRoles.includes("super_admin")) {
            return {
                success: false,
                error: "Cannot impersonate admin users",
            };
        }

        const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);

        // Create impersonation record
        const impersonationRef = await db.collection(COLLECTIONS.IMPERSONATION_TOKENS).add({
            adminId: session.user.id,
            targetUserId,
            reason,
            createdAt: FieldValue.serverTimestamp(),
            expiresAt,
            active: true,
            usedAt: null,
        });

        // Critical audit log
        await logAuditAction(
            "user_impersonate",
            targetUserId,
            "user",
            {
                adminId: session.user.id,
                reason,
                durationMinutes,
                expiresAt: expiresAt.toISOString(),
                tokenId: impersonationRef.id,
            }
        );

        return {
            success: true,
            token: impersonationRef.id,
            expiresAt: expiresAt.toISOString(),
        };
    } catch (error: any) {
        logger.error("Failed to create impersonation token:", error);
        return {
            success: false,
            error: error.message || "Failed to create impersonation token",
        };
    }
}

/**
 * Export user data for compliance (Admin only)
 */
export async function exportUserDataAction(
    userId: string
): Promise<{
    success: boolean;
    data?: any;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:read")) {
            return {
                success: false,
                error: "Unauthorized: Permission required - users:read",
            };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { success: false, error: "User not found" };
        }

        const userData = userDoc.data();

        // Gather all user-related data
        const userDataExport: {
            profile: any;
            cooperativeMemberships: any[];
            waveEnrollments: any[];
            transactions: any[];
            orders: any[];
            reviews: any[];
            loans: any[];
        } = {
            profile: userData,
            cooperativeMemberships: [],
            waveEnrollments: [],
            transactions: [],
            orders: [],
            reviews: [],
            loans: [],
        };

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
            {
                adminId: session.user.id,
                exportedCollections: Object.keys(userDataExport),
            }
        );

        return {
            success: true,
            data: userDataExport,
        };
    } catch (error: any) {
        logger.error("Failed to export user data:", error);
        return {
            success: false,
            error: error.message || "Failed to export user data",
        };
    }
}
