"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { revokeAuthAccess } from "@/lib/auth-revocation";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logAuditAction } from "./audit";
import { hasAdminPermission, isSuperAdmin } from "@/lib/admin-permissions";

type ActionState = 
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any };;

/**
 * Soft delete user (Preserve Referential Integrity)
 * Replaces hard deletion to prevent orphaned products/orders.
 */
export async function softDeleteUserAction(targetUserId: string): Promise<ActionState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        // users:delete, and nothing weaker.
        //
        // The comment here said "Strict: Only Super Admin or Admin", and the
        // code did the opposite. users:delete is held by super_admin ALONE in
        // PERMISSION_MATRIX; the fallback below it — "if the specific permission
        // doesn't exist" — fell through to isAdmin(), which accepts ten roles:
        // super_admin, admin, moderator, support and every module admin.
        //
        // So a support agent or a moderator could irreversibly scrub a person's
        // name, email, phone and bank details, and revoke their sign-in. The
        // permission the matrix deliberately reserves was handed to everyone
        // wearing a badge.
        //
        // bulkDeleteUsersAction, which does the same job in bulk, already gates
        // on users:delete with no fallback. This is that rule.
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:delete")) {
            return { error: "Unauthorized: Permission required - users:delete (super_admin only)", success: false as const, data: null };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) { return { error: "User not found", success: false as const, data: null };
        }

        const userData = userDoc.data()!;

        // Prevent deleting yourself
        if (targetUserId === session.user.id) { return { error: "Cannot delete your own account", success: false as const, data: null };
        }

        // An administrator is not deleted by another administrator.
        //
        // bulkDeleteUsersAction skips admin targets unless the caller is a
        // super_admin; this path had no such rule at all, so whoever got past
        // the guard above could delete an admin — or a super_admin — scrubbing
        // their details and cutting off their access.
        const targetRoles: string[] = userData?.roles || [];
        const targetIsAdmin = targetRoles.some((r) => r === "admin" || r === "super_admin");
        if (targetIsAdmin && !isSuperAdmin(session.user.roles)) {
            return { error: "Only a super admin can delete an administrator", success: false as const, data: null };
        }

        // PII Scrubbing
        const timestamp = Date.now();
        const scrubbedEmail = `deleted_${timestamp}_${targetUserId}@deleted.com`;
        const scrubbedPhone = `DELETED-${timestamp.toString(36).toUpperCase()}`;
        const scrubbedName = "Deleted User";

        // 1. Update Firestore Doc (Soft Delete)
        await userRef.update({ deleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy: session.user.id,

            // PII Removal
            email: scrubbedEmail,
            originalEmail: userData.email, // Optional: Keep for audit, or remove if strict GDPR
            phone: scrubbedPhone,
            fullName: scrubbedName,
            displayName: scrubbedName,

            // Deactivate Roles
            roles: ["deleted"],
            isActive: false,
            // The field lib/auth.ts actually refuses to log in. roles and
            // isActive are read by nothing in the sign-in path.
            suspended: true,

            updatedAt: FieldValue.serverTimestamp() });

        // 2. Actually prevent login.
        //
        // This disabled the FIREBASE auth user, and lib/auth.ts authenticates
        // against SUPABASE first — the disabled record was never consulted. The
        // profile write above sets roles: ["deleted"] and isActive: false, and
        // login checks neither; it refuses on isBanned, status === 'banned' or
        // suspended. So a deleted user kept their original email and password
        // and could still sign in, to a scrubbed account.
        //
        // revokeAuthAccess moves the account to the scrubbed address and a
        // random password in Supabase, and disables Firebase as well.
        const revocation = await revokeAuthAccess(targetUserId, scrubbedEmail);
        if (!revocation.primaryRevoked) {
            logger.error(`[delete] auth revocation failed for ${targetUserId}: ${revocation.error}`);
            return {
                error: "Account data was scrubbed but sign-in could not be revoked. Please retry.",
                success: false as const,
                data: null,
            };
        }

        // 3. Clear Cache
        try { const { invalidateUserCache } = await import('@/lib/cache-invalidation');
            await invalidateUserCache(targetUserId);
        } catch (e: any) { logger.warn("Cache invalidation skipped:", e?.message); }

        await logAuditAction("user_delete", targetUserId, "user", { adminId: session.user.id,
            type: "soft_delete"
        });

        return { success: true as const, message: "User soft-deleted successfully", error: null };

    } catch (error: any) { logger.error("Soft delete user error:", error);
        return { success: false as const, error: "Failed to delete user", data: null };
    }
}
