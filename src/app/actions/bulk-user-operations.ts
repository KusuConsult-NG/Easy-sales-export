/**
 * Bulk User Operations & Advanced Admin Actions
 *
 * For admin productivity and user support
 *
 *   #396 NO PRODUCTION FILE IMPORTS THIS MODULE.
 *
 *   Counting importers across all of src/: every one is a test. The admin user
 *   directory at /admin/users imports from "@/app/actions/admin" — a different
 *   module — and there is no bulk toolbar on it. So all six exports here are
 *   registered server actions with no screen and no route behind them.
 *
 *   Two of the six have no live equivalent ANYWHERE, which is worth stating
 *   plainly so nobody assumes the capability exists:
 *
 *     bulkSuspendUsersAction / bulkActivateUsersAction
 *         Nothing else suspends a PLATFORM user. The live suspend paths —
 *         api/admin/marketplace/suspend-seller and the product moderation in
 *         admin/_marketplace.ts — suspend a seller profile or a listing, not
 *         an account.
 *
 *     exportUserDataAction
 *         Nothing else assembles a per-user data export. The GDPR module
 *         (lib/user-erasure.ts) erases; it does not export.
 *
 *   FIVE OF THE SIX ARE LEFT EXACTLY AS THEY ARE. They are correct, carefully
 *   guarded implementations of operations an admin screen would legitimately
 *   perform — #87's role-escalation boundary, #305's shared PII scrub and
 *   #300's retire-don't-destroy rule all landed here — and none of them claims
 *   to do something it does not do. Being unwired is a gap in the product, not
 *   a defect in the code, and a flag in front of them would add friction
 *   without preventing anything.
 *
 *   THE SIXTH IS DIFFERENT AND IS RETIRED. createImpersonationTokenAction
 *   reports success and returns a token that nothing can redeem; see the
 *   refusal at the call site and lib/admin-impersonation.ts for the
 *   measurement.
 */

"use server";

import { auth } from "@/lib/auth";
import { softDeleteUserRecord, SOFT_DELETE_STAGE_MESSAGE } from "@/lib/user-soft-delete";
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
import { isAdminImpersonationEnabled, ADMIN_IMPERSONATION_REFUSAL } from "@/lib/admin-impersonation";

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

        // Prevent removing admin role via bulk operation
        if (rolesToRemove.includes("admin") || rolesToRemove.includes("super_admin")) {
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
): Promise<ActionResponse<{ deleted: number; failed: string[]; failures: Array<{ userId: string; because: string }> }>> { 
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

        /**
         *   #206 THIS SCRUBBED NO PERSONAL DATA AT ALL.
         *
         *        It wrote five fields — deleted, deletedAt, deletedBy,
         *        deletionReason, suspended — and nothing else. Name, email,
         *        phone, BVN, NIN, next of kin, bank account and
         *        identity-document URLs all remained, on the user row and on
         *        every module row, for up to fifty people at a time.
         *
         *        The account was refused at login, because `suspended` is the
         *        field lib/auth.ts actually reads, so this was never an access
         *        defect. It was a retention one — the same compliance failure
         *        #283 opened — and the fixes for it (#283, #300, #305, #371,
         *        #376) all landed on softDeleteUserAction, the OTHER door onto
         *        the same operation. lib/user-erasure.ts even says there is
         *        more than one deletion path, and names this file.
         *
         *        Sharing the field LISTS was not enough, because what was
         *        missing here was never a field: it was the four STEPS — retain,
         *        scrub the row, scrub the module rows, revoke sign-in. The
         *        operation lives in lib/user-soft-delete.ts now and both doors
         *        call it.
         *
         *        THE BATCH IS GONE, DELIBERATELY. Scrubbing correctly means a
         *        retention write, a row update, eight module sweeps and an auth
         *        revocation per user — none of which belong in, or survive, a
         *        single batched update. Fifty at a time is the existing cap.
         */
        let deletedCount = 0;
        const failedIds: string[] = [];
        /** Reported per user, so a partial failure is not a silent one. */
        const failures: Array<{ userId: string; because: string }> = [];

        for (const userId of userIds) {
            try {
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

                if (!userDoc.exists) {
                    failedIds.push(userId);
                    failures.push({ userId, because: "no such account" });
                    continue;
                }

                // Prevent deleting admins (unless you're super_admin)
                const userRoles = (userDoc.data()?.roles as string[] | undefined) || [];
                if (userRoles.includes("admin") && !isSuperAdmin(session.user.roles)) {
                    failedIds.push(userId);
                    failures.push({ userId, because: "target is an admin" });
                    continue;
                }

                const outcome = await softDeleteUserRecord(userId, session.user.id || "", {
                    deletionReason: reason,
                });

                if (!outcome.ok) {
                    // NOT counted as deleted. A scrub that half-ran is a row an
                    // operator has to finish, and reporting it as done is how
                    // personal data survives a deletion nobody looks at again.
                    failedIds.push(userId);
                    failures.push({ userId, because: SOFT_DELETE_STAGE_MESSAGE[outcome.stage] });
                    continue;
                }

                deletedCount++;
            } catch (error: any) {
                failedIds.push(userId);
                failures.push({ userId, because: error?.message ?? "unknown error" });
            }
        }

        if (failures.length > 0) {
            logger.error(
                `[bulkDeleteUsersAction] ${failures.length} of ${userIds.length} not deleted: `
                + failures.map((f) => `${f.userId} (${f.because})`).join("; "),
            );
        }

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

        // `failures` names WHY, beside the ids that only say WHICH — an admin
        // told "3 failed" and nothing else cannot act on it.
        return {
            success: true,
            error: null,
            data: { deleted: deletedCount, failed: failedIds, failures },
        };
    } catch (error: any) { 
        logger.error("Failed to bulk delete users:", error);
        return { success: false, error: error.message || "Failed to delete users", data: null };
    }
}

/**
 * Create impersonation token for support (Super Admin only)
 *
 * SECURITY: Highly sensitive - creates time-limited token for admin to impersonate user
 *
 *   #396 RETIRED. THE TOKEN THIS RETURNS CANNOT BE REDEEMED BY ANYTHING.
 *
 *   `impersonation_tokens` has one writer — the add() below — and no reader
 *   anywhere in src/. Nothing exchanges the returned id for a session, so this
 *   reported success for an operation that did not happen.
 *
 *   The row's `active`, `expiresAt` and `usedAt` are the three fields a
 *   redeemer would check to make the token single-use and time-limited. Nothing
 *   reads them and nothing ever sets `usedAt`, so they are written and enforced
 *   by nothing — which is the actual hazard, because the mint side looks
 *   finished and a redeemer built on top of it would grant unlimited logins as
 *   the target user, for ever.
 *
 *   Refused as the FIRST statement, before the session lookup, so no code path
 *   reaches the write while the flag is off. The guards below are untouched and
 *   still asserted by role-escalation.test.ts with the flag armed: super_admin
 *   only, no admin target, a 20-character reason, 5–120 minutes.
 *
 *   See lib/admin-impersonation.ts for the measurement and for what must be
 *   built before ADMIN_IMPERSONATION_ACTION is set to "enabled".
 */
export async function createImpersonationTokenAction(
    targetUserId: string,
    reason: string,
    durationMinutes: number = 30
): Promise<ActionResponse<{ token: string; expiresAt: string }>> {
    if (!isAdminImpersonationEnabled()) {
        return { success: false as const, error: ADMIN_IMPERSONATION_REFUSAL, data: null };
    }
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
