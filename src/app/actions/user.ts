"use server";
import { requireSession } from "@/lib/session-guard";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";
import type { ActionResponse } from "@/lib/safe-action";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { invalidateUserCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";

/**
 * NDPR Compliant "Right to be Forgotten" Account Deletion.
 * This performs a soft-delete to maintain referential integrity (for ledgers, orders)
 * but permanently scrubs all Personally Identifiable Information (PII).
 * NOTE: Declared as async function (not const) so Next.js "use server" validator accepts it.
 */
async function _deleteUserAccountAction(): Promise<ActionResponse<void>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized. You must be logged in." };
        }

        const userId = session.user.id;
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            return { success: false as const, error: "User profile not found." };
        }

        // Scrub all PII. We retain the UID so that database foreign keys (like
        // 'sellerId' on an order or 'buyerId' on a farm purchase) do not break.
        await userRef.update({
            fullName: "Redacted User",
            email: "deleted_" + userId + "@redacted.local",
            phone: FieldValue.delete(),
            gender: FieldValue.delete(),
            address: FieldValue.delete(),
            bankDetails: FieldValue.delete(),
            mfaEnabled: false,
            totpSecret: FieldValue.delete(),
            mfaRecoveryCodes: FieldValue.delete(),

            // Track deletion status and timestamp
            deleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        logger.info(`[NDPR Compliance] User PII successfully scrubbed for UID: ${userId}`);

        // Invalidate Cache
        try {
            await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (err) {
            logger.error("Cache invalidation failed after account deletion", err);
        }

        return { success: true };
    } catch (error: any) {
        logger.error("[NDPR Compliance] Account deletion error:", error);
        const msg = typeof error === 'string' ? error : (error?.message || "Account deletion failed");
        return { success: false as const, error: msg };
    }
}

export const deleteUserAccountAction = withFlexibleSafeAction("deleteUserAccountAction", _deleteUserAccountAction);

