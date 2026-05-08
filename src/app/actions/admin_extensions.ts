"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { db, adminAuth } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logAuditAction } from "./audit";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";

type ActionState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

/**
 * Soft delete user (Preserve Referential Integrity)
 * Replaces hard deletion to prevent orphaned products/orders.
 */
export async function softDeleteUserAction(targetUserId: string): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        
        // Strict: Only Super Admin or Admin can delete users
        if (!session?.user || !hasAdminPermission(session.user.roles, "users:delete")) {
            // Fallback if specific permission doesn't exist
            if (!isAdmin(session.user.roles)) {
                return { error: "Unauthorized: Admin access required", success: false as const };
            }
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { error: "User not found", success: false as const };
        }

        const userData = userDoc.data()!;

        // Prevent deleting yourself
        if (targetUserId === session.user.id) {
            return { error: "Cannot delete your own account", success: false as const };
        }

        // PII Scrubbing
        const timestamp = Date.now();
        const scrubbedEmail = `deleted_${timestamp}_${targetUserId}@deleted.com`;
        const scrubbedPhone = `DELETED-${timestamp.toString(36).toUpperCase()}`;
        const scrubbedName = "Deleted User";

        // 1. Update Firestore Doc (Soft Delete)
        await userRef.update({
            deleted: true,
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

            updatedAt: FieldValue.serverTimestamp(),
        });

        // 2. Disable in Firebase Auth (prevent login)
        try {
            await adminAuth.updateUser(targetUserId, {
                disabled: true,
                email: scrubbedEmail, // Sync email change so they can't recover via old email
                displayName: scrubbedName
            });
        } catch (authError) {
            logger.error(`Failed to disable Auth user ${targetUserId}:`, authError);
            // Non-blocking, but logged
        }

        // 3. Clear Cache
        try {
            const { invalidateUserCache } = await import('@/lib/cache-invalidation');
            await invalidateUserCache(targetUserId);
        } catch (e: any) { logger.warn("Cache invalidation skipped:", e?.message); }

        await logAuditAction("user_delete", targetUserId, "user", {
            adminId: session.user.id,
            type: "soft_delete"
        });

        return { success: true as const, message: "User soft-deleted successfully", error: null };

    } catch (error: any) {
        logger.error("Soft delete user error:", error);
        return { success: false as const, error: "Failed to delete user" };
    }
}
