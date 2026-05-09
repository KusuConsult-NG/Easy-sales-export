
import { db } from "../firebase-admin";
import { COLLECTIONS } from "../types/firestore";
import { CanonicalUserProfile, LATEST_SCHEMA_VERSION } from "./schemas";

/**
 * CANONICAL SYNC ENGINE
 * 
 * Enforces atomic writes to the Single Source of Truth.
 */

export async function syncCanonicalUser(userId: string, updates: Partial<CanonicalUserProfile>) {
    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    
    return db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        const existingData = userDoc.data() || {};

        const mergedUpdates = {
            ...updates,
            updatedAt: new Date(),
            schemaVersion: LATEST_SCHEMA_VERSION
        };

        // Enforce top-level field propagation
        if (updates.verificationProfile) {
            // If we're updating the verification profile, also sync the marketplace status flag
            (mergedUpdates as any)["serviceRegistrations.marketplace.status"] = updates.verificationProfile.status;
            (mergedUpdates as any).sellerVerificationStatus = updates.verificationProfile.status;
        }

        transaction.set(userRef, mergedUpdates, { merge: true });
        
        // Log to audit if it's a significant change
        if (updates.verificationProfile?.status === "approved") {
            const auditRef = db.collection("audit_logs").doc();
            transaction.set(auditRef, {
                userId,
                action: "CANONICAL_SYNC_APPROVED",
                timestamp: new Date(),
                details: "User verification approved and synced to canonical profile."
            });
        }
    });
}
