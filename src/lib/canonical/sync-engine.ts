
import { db } from "../firebase-admin";
import { COLLECTIONS } from "../types/firestore";
import { CanonicalUserProfile, LATEST_SCHEMA_VERSION } from "./schemas";

/**
 * CANONICAL SYNC ENGINE
 *
 *   #355 IT ENFORCES NOTHING, AND NOTHING CALLS IT.
 *
 *        Its header said "Enforces atomic writes to the Single Source of
 *        Truth". Both halves are false.
 *
 *        NOT ATOMIC. `db.runTransaction` in this codebase is not a database
 *        transaction. supabase-db.ts:2156 is the whole implementation:
 *
 *            const tx = new SupabaseTransaction();
 *            const result = await fn(tx);
 *            await tx._commit();
 *
 *        It constructs a queue, runs the callback, and flushes the writes.
 *        There is NO LOCK, no isolation and no rollback — which is exactly why
 *        every money path in this application goes through a CAS Postgres
 *        function in lib/wallet-ledger.ts instead. So the read-modify-write
 *        below is an unguarded check-then-write, and two concurrent calls lose
 *        one another's updates. A module named "sync engine" that promises
 *        atomicity and delivers none is worse than no module: it is the reason
 *        somebody would stop looking for the CAS function they actually need.
 *
 *        NOT THE SOURCE OF TRUTH EITHER. Nothing imports this file. It has one
 *        export, zero callers, and 0% coverage.
 *
 *        KEPT, not deleted, per the standing instruction. The header now says
 *        what it is. src/__tests__/unit/dead-modules-do-not-claim-authority.test.ts
 *        holds it there.
 *
 *        OWNER DECISION: adopt this — which means giving it a real CAS write
 *        first — or retire it.
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
