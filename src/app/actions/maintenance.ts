"use server";

import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireAdmin } from "@/lib/require-admin";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { recordAdminAction } from "@/lib/audit-log";

/**
 * 1. The Migration Script: Fixing Corrupted Transaction Records
 * 
 * Heals records missing createdAt or updatedAt to prevent dashboard crashes.
 */
export async function repairDataAction() { const authCheck = await requireAdmin("config:update");
    if ("error" in authCheck) return { success: false as const, error: "Unauthorized", data: null };

    try { const db = getAdminDb();
        const snapshot = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).all().get();
        const batch = db.batch();
        let count = 0;

        snapshot.docs.forEach((doc) => {
            const data = doc.data();
            // Check for missing timestamps noted in audit
            if (!data.processedAt || !data.createdAt) {
                batch.update(doc.ref, {
                    processedAt: data.processedAt || data.createdAt || new Date(),
                    createdAt: data.createdAt || data.processedAt || new Date(),
                    updatedAt: new Date(),
                    _system_healed: true 
                });
                count++;
            }
        });

        if (count > 0) { await batch.commit();
        }

        // Also check wallet transactions if necessary
        const walletSnap = await db.collection(COLLECTIONS.WALLET_TRANSACTIONS).get();
        const walletBatch = db.batch();
        let walletCount = 0;
        
        walletSnap.docs.forEach((doc) => { const data = doc.data();
            if (!data.createdAt || !data.updatedAt) {
                walletBatch.update(doc.ref, {
                    createdAt: data.createdAt || new Date(),
                    updatedAt: new Date(),
                    _system_healed: true
                });
                walletCount++;
            }
        });

        if (walletCount > 0) { await walletBatch.commit();
        }

        /**
         * A BULK MUTATION OF PAYMENT AND WALLET ROWS, RECORDED NOWHERE.
         *
         * This rewrites timestamps across PROCESSED_PAYMENTS and
         * WALLET_TRANSACTIONS and left no trace of who ran it or what it
         * touched. The #66 ratchet did not catch it: that check matches writes
         * gated on hasAdminPermission(), and this is gated on requireAdmin() —
         * the same blind spot that hid the dispute resolver until #157.
         */
        await recordAdminAction({
            action: 'data_recovery_run',
            userId: authCheck.userId,
            targetType: 'timestamp_repair',
            metadata: { paymentRecordsHealed: count, walletRecordsHealed: walletCount },
        });

        return {
            error: null,
            success: true as const,
            message: `Healed ${count} payment records and ${walletCount} wallet records.`,
            data: { paymentCount: count, walletCount }
        };
    } catch (error: any) {
        logger.error("[Maintenance] Repair error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * 2. The Consistency Check Script
 * 
 * Compares Users vs Memberships and reports discrepancies.
 */
export async function runConsistencyCheckAction() {
    const authCheck = await requireAdmin("config:update");
    if ("error" in authCheck) return { success: false as const, error: "Unauthorized", data: null };

    try {
        const db = getAdminDb();

        const [usersSnap, coopSnap, waveSnap, authCountSnap] = await Promise.all([
            db.collection(COLLECTIONS.USERS).count().get(),
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).count().get(),
            db.collection(COLLECTIONS.WAVE_APPLICATIONS).count().get(),
            db.collection(COLLECTIONS.USERS).select("email").get() // For unique check
        ]);

        const totalUsers = usersSnap.data().count;
        const totalCoop = coopSnap.data().count;
        const totalWave = waveSnap.data().count;

        const emails = new Set();
        authCountSnap.docs.forEach(d => {
            const email = d.data().email;
            if (email) emails.add(email.toLowerCase().trim());
        });

        return {
            error: null,
            success: true as const,
            data: {
                firestoreUserDocs: totalUsers,
                uniqueEmailsInUsers: emails.size,
                cooperativeMembershipDocs: totalCoop,
                waveApplicationDocs: totalWave,
                discrepancyPotential: (totalCoop + totalWave + totalUsers) - emails.size,
                explanation: "If totalCoop + totalWave exceeds totalUsers, the membership multiplexer is active."
            }
        };
    } catch (error: any) {
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * 3. Immediate "Force Refresh" Protocol
 * 
 * Purges Next.js cache across the entire Hub.
 */
export async function hardResetCacheAction() { const authCheck = await requireAdmin("config:update");
    if ("error" in authCheck) return { success: false as const, error: "Unauthorized", data: null };

    try { revalidatePath("/", "layout");
        
        // Clear Redis via helper
        const { invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
        await invalidateAdminGlobalStats();

        return { error: null,  success: true as const, message: "Global cache purge triggered successfully." , data: null };
    } catch (error: any) { return { success: false as const, error: error.message, data: null };
    }
}

/**
 * 4. Cleanup Abandoned Drafts
 * (Required by Maintenance UI)
 */
/**
 *   #680 THE ONE BUTTON ON THE MAINTENANCE SCREEN DID NOTHING AND SAID IT HAD
 *        WORKED.
 *
 *        `/admin/settings/maintenance` is the only caller of anything in this
 *        file. It asks the admin to confirm:
 *
 *            "Are you sure you want to delete all draft listings older than 30
 *             days? This action cannot be undone."
 *
 *        and then called a function whose entire body was
 *
 *            // Placeholder for logic to delete old 'draft' applications
 *            return { success: true, message: "Draft cleanup executed (Dry
 *                     run).", count: 0 };
 *
 *        The screen read `success`, showed a green tick and the words
 *        "Successfully cleaned up 0 drafts", and rendered "Cleanup complete!
 *        Removed 0 items." An operator cannot tell that from "there was
 *        nothing to clean", so drafts accumulate while the monthly maintenance
 *        task is believed to be running.
 *
 *        That is the shape docs/audit/outstanding-work.md already records
 *        against push notifications — "a stub that returned a fake success id
 *        for every send, so nothing was ever delivered while the logs reported
 *        success" — and #676 met it again in the SMS sandbox. A third channel.
 *
 *        AND IT THREATENED AN IRREVERSIBLE DELETION THAT COULD NOT HAPPEN,
 *        which is its own cost: a confirm dialog that cries wolf is one the
 *        next dialog inherits.
 *
 *   THE DELETION IS NOT IMPLEMENTED HERE, DELIBERATELY. The standing
 *   instruction for this codebase is that nothing is deleted or destroyed —
 *   #292 and lib/module-application-erasure.ts are built on it, and #675 now
 *   guards the Cloudinary half. Writing a bulk delete of land listings to make
 *   a stub honest would be the wrong repair by a wide margin.
 *
 *   So the button refuses, and says why. If abandoned drafts are ever to be
 *   cleared, the decision about what "cleared" means — removed, or marked and
 *   kept the way an erased application is — is the owner's, and it belongs in
 *   that conversation rather than in a placeholder nobody re-read.
 */
export async function cleanupAbandonedDraftsAction() { const authCheck = await requireAdmin("config:update");
    if ("error" in authCheck) return { success: false as const, error: "Unauthorized", data: null };

    return {
        success: false as const,
        error:
            "Draft cleanup is not implemented. Nothing was deleted, and nothing has been deleted by this "
            + "button before — it has always been a placeholder that reported success. Removing listings "
            + "would need a decision first about whether they are deleted or marked and kept, the way an "
            + "erased application is.",
        count: 0,
        data: null,
    };
}
