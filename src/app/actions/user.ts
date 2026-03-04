"use server";
import { requireSession } from "@/lib/session-guard";

import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";
import { ActionResponse, withSafeAction } from "@/lib/safe-action";
import { auth } from "@/lib/auth"; // Assumes new NextAuth v5 import

/**
 * NDPR Compliant "Right to be Forgotten" Account Deletion.
 * This performs a soft-delete to maintain referential integrity (for ledgers, orders)
 * but permanently scrubs all Personally Identifiable Information (PII).
 */
export const deleteUserAccountAction = withSafeAction(
    "deleteUserAccountAction",
    async (): Promise<ActionResponse<void>> => {
        try {
            const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;
            if (!session?.user?.id) {
                return { success: false, error: "Unauthorized. You must be logged in." };
            }

            const userId = session.user.id;
            const userRef = db.collection("users").doc(userId);

            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                return { success: false, error: "User profile not found." };
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

            // Additionally, we should sign the user out via client-side redirect after this action resolves
            logger.info(`[NDPR Compliance] User PII successfully scrubbed for UID: ${userId}`);

            return { success: true };
        } catch (error) {
            logger.error("[NDPR Compliance] Account deletion error:", error);
            throw error; // Let withSafeAction catch and format it
        }
    }
);
