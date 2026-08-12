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
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";

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
        
        // Strict: Only Super Admin or Admin can delete users
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:delete")) { // Fallback if specific permission doesn't exist
            if (!isAdmin(session.user.roles)) {
                return { error: "Unauthorized: Admin access required", success: false as const, data: null };
            }
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) { return { error: "User not found", success: false as const, data: null };
        }

        const userData = userDoc.data()!;

        // Prevent deleting yourself
        if (targetUserId === session.user.id) { return { error: "Cannot delete your own account", success: false as const, data: null };
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
