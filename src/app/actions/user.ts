"use server";
import { requireSession } from "@/lib/session-guard";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
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
async function _deleteUserAccountAction(): Promise<ActionResponse<null>> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized. You must be logged in.", data: null };
        }

        const userId = session.user.id;
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        const userSnap = await userRef.get();
        if (!userSnap.exists) { return { success: false as const, error: "User profile not found.", data: null };
        }

        // Delete related KYC verifications
        const kycSnap = await db.collection(COLLECTIONS.KYC_VERIFICATIONS).where("userId", "==", userId).get();
        const batch = db.batch();
        kycSnap.docs.forEach(doc => batch.delete(doc.ref));

        // Delete seller verification & wallet
        batch.delete(db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(userId));
        batch.delete(db.collection(COLLECTIONS.WALLETS).doc(userId));

        // Scrub all PII. We retain the UID so that database foreign keys (like
        // 'sellerId' on an order or 'buyerId' on a farm purchase) do not break.
        batch.update(userRef, {
            fullName: "Redacted User",
            email: "deleted_" + userId + "@redacted.local",
            phone: FieldValue.delete(),
            gender: FieldValue.delete(),
            address: FieldValue.delete(),
            bankDetails: FieldValue.delete(),
            serviceRegistrations: FieldValue.delete(),
            mfaEnabled: false,
            totpSecret: FieldValue.delete(),
            mfaRecoveryCodes: FieldValue.delete(),

            // Track deletion status and timestamp
            deleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        await batch.commit();

        logger.info(`[NDPR Compliance] User PII successfully scrubbed for UID: ${userId}`);

        // Invalidate Cache
        try { await invalidateUserCache(userId);
            await invalidateAdminGlobalStats();
        } catch (err) { logger.error("Cache invalidation failed after account deletion", err);
        }

        return { success: true as const, error: null, data: null };
    } catch (error: any) { logger.error("[NDPR Compliance] Account deletion error:", error);
        const msg = typeof error === 'string' ? error : (error?.message || "Account deletion failed");
        return { success: false as const, error: msg, data: null };
    }
}

export const deleteUserAccountAction = withFlexibleSafeAction("deleteUserAccountAction", _deleteUserAccountAction);

