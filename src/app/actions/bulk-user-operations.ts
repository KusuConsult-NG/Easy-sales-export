/**
 * Bulk User Operations & Advanced Admin Actions
 * 
 * For admin productivity and user support
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission, isSuperAdmin, includesPrivilegedRole } from "@/lib/admin-permissions";
import { logAuditAction } from "@/lib/audit-log";
import { isUserRole } from "@/lib/types/roles";
import { redis } from "@/lib/redis";
import { invalidateUserCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
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
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
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

                /**
                 * WHO COUNTS AS AN ADMIN WORTH PROTECTING — asked with the
                 * derived set, not with the string "admin".
                 *
                 * This read `userRoles.includes("admin")`, so it protected a
                 * target whose roles array literally contains that one string
                 * and nobody else. A super_admin whose roles are
                 * ["super_admin"] — the ordinary shape — was NOT protected,
                 * and `users:suspend` is held by plain `admin`.
                 *
                 * So an admin could suspend every super_admin on the platform.
                 * `suspended: true` is exactly what lib/auth.ts refuses a login
                 * for at its ban check, and what the jwt callback turns into
                 * token.isBanned, so the sessions go too. The role hierarchy
                 * inverted: the lower role could lock out the higher one.
                 *
                 * Executed, not argued: acting as ["admin"] against a target
                 * with roles ["super_admin"], this returned
                 * { success: true, suspended: 1 } and the document came back
                 * with suspended: true.
                 *
                 * includesPrivilegedRole is the codebase's answer to this exact
                 * question and was ALREADY IMPORTED INTO THIS FILE, used 165
                 * lines below in bulkAssignRolesAction — under a comment
                 * explaining that a hand-written ["admin", "super_admin"] went
                 * stale when six module-admin roles were added. admin/_users.ts
                 * and admin/_legacy.ts both use it for the same purpose. Three
                 * spellings of one question in one file, and the two that were
                 * hand-written were the two that were wrong.
                 *
                 * The set is derived from PERMISSION_MATRIX, so it also covers
                 * cooperative_admin — a role that holds a permission `admin`
                 * deliberately does not.
                 */
                const userData = userDoc.data();
                const userRoles = userData?.roles || [];
                if (includesPrivilegedRole(userRoles) && !isSuperAdmin(session.user.roles)) { failedIds.push(userId);
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
                invalidateAdminGlobalStats(),
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
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
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
                invalidateAdminGlobalStats(),
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
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
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

        // Prevent removing admin role via bulk operation.
        //
        // Asked with the derived set for the same reason the add side below
        // already is: this hand-written pair missed cooperative_admin, so the
        // one role the ADD side refused to grant without a super_admin was a
        // role the REMOVE side would strip from anyone. Two halves of one
        // guard, disagreeing about what "an admin role" is.
        if (includesPrivilegedRole(rolesToRemove)) {
            return { success: false, error: "Cannot remove admin roles via bulk operation", data: null };
        }

        // ...and prevent GRANTING one, which the check above stopped just short
        // of. rolesToAdd was unrestricted, so an admin — who holds
        // users:assign_roles but deliberately not users:delete or
        // users:impersonate — could pass their own id with ["super_admin"] and
        // collect both. Every other endpoint in this file defends that boundary
        // explicitly; this was the one that did not.
        if (includesPrivilegedRole(rolesToAdd) && !isSuperAdmin(session.user.roles)) {
            return {
                success: false,
                error: "Only a super admin can grant admin roles",
                data: null,
            };
        }

        // The role NAMES have to be real ones, which nothing here checked.
        //
        // add-roles validates against a list and this did not, so the two
        // writers of the same field disagreed about what a role even is. Two
        // consequences, and the second is the one that matters:
        //
        //   - a typo wrote a string nobody grants anything for, and the call
        //     reported success
        //   - "moderator" and "support" are honoured by isAdmin() and appear in
        //     PERMISSION_MATRIX, but in no role type, schema or UI list. 32
        //     admin routes are gated on isAdmin(). So this was the one path that
        //     could hand somebody full admin access under a name that nothing
        //     displays as admin access.
        //
        // Checked against ALL_USER_ROLES, the value form of the UserRole union,
        // so this cannot drift from the type the way the other five lists did.
        const unknownRoles = [...rolesToAdd, ...rolesToRemove].filter((r) => !isUserRole(r));
        if (unknownRoles.length > 0) {
            return {
                success: false,
                error: `Unknown role(s): ${unknownRoles.join(", ")}`,
                data: null,
            };
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

        try {
            const successfulIds = userIds.filter(id => !failedIds.includes(id));
            await Promise.allSettled([
                ...successfulIds.map(userId => invalidateUserCache(userId)),
                invalidateAdminGlobalStats()
            ]);
        } catch (sideEffectError) {
            logger.error("[bulkAssignRolesAction] Post-commit cache invalidation failed:", sideEffectError);
        }

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
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
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

                /**
                 * The same question, the same answer — see the note in
                 * bulkSuspendUsersAction.
                 *
                 * NOT LIVE TODAY, and said plainly rather than overstated:
                 * `users:delete` is held by super_admin alone, so
                 * `!isSuperAdmin(session.user.roles)` is always false here and
                 * this branch cannot be reached. It is fixed anyway because it
                 * is one matrix edit away from being reached, and because a
                 * guard that reads as protection while being wrong is worse
                 * than no guard: the next person to grant `users:delete` to
                 * `admin` would have no reason to look at this line.
                 */
                const userRoles = userData?.roles || [];
                if (includesPrivilegedRole(userRoles) && !isSuperAdmin(session.user.roles)) { failedIds.push(userId);
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
                invalidateAdminGlobalStats(),
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
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
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

        // "Cannot impersonate admin users" — asked with the derived set, so it
        // means every admin role and not the two that were typed out.
        // Impersonation is the most dangerous capability in this file, the rule
        // is a blanket refusal with no super_admin escape, and the direction of
        // this change is strictly narrower: it removes cooperative_admin from
        // what an impersonation token can reach.
        if (includesPrivilegedRole(targetRoles)) { return { success: false as const, error: "Cannot impersonate admin users", data: null };
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
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
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
