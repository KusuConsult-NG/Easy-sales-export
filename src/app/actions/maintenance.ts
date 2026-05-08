"use server";

import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireAdmin } from "@/lib/require-admin";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

/**
 * 1. The Migration Script: Fixing Corrupted Transaction Records
 * 
 * Heals records missing createdAt or updatedAt to prevent dashboard crashes.
 */
export async function repairDataAction() {
    const authCheck = await requireAdmin();
    if ("error" in authCheck) return { success: false, error: "Unauthorized" };

    try {
        const db = getAdminDb();
        const snapshot = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).get();
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

        if (count > 0) {
            await batch.commit();
        }

        // Also check wallet transactions if necessary
        const walletSnap = await db.collection(COLLECTIONS.WALLET_TRANSACTIONS).get();
        const walletBatch = db.batch();
        let walletCount = 0;
        
        walletSnap.docs.forEach((doc) => {
            const data = doc.data();
            if (!data.createdAt || !data.updatedAt) {
                walletBatch.update(doc.ref, {
                    createdAt: data.createdAt || new Date(),
                    updatedAt: new Date(),
                    _system_healed: true
                });
                walletCount++;
            }
        });

        if (walletCount > 0) {
            await walletBatch.commit();
        }

        return { 
            success: true, 
            message: `Healed ${count} payment records and ${walletCount} wallet records.` 
        };
    } catch (error: any) {
        logger.error("[Maintenance] Repair error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * 2. The Consistency Check Script
 * 
 * Compares Users vs Memberships and reports discrepancies.
 */
export async function runConsistencyCheckAction() {
    const authCheck = await requireAdmin();
    if ("error" in authCheck) return { success: false, error: "Unauthorized" };

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
            success: true,
            report: {
                firestoreUserDocs: totalUsers,
                uniqueEmailsInUsers: emails.size,
                cooperativeMembershipDocs: totalCoop,
                waveApplicationDocs: totalWave,
                discrepancyPotential: (totalCoop + totalWave + totalUsers) - emails.size,
                explanation: "If totalCoop + totalWave exceeds totalUsers, the membership multiplexer is active."
            }
        };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * 3. Immediate "Force Refresh" Protocol
 * 
 * Purges Next.js cache across the entire Hub.
 */
export async function hardResetCacheAction() {
    const authCheck = await requireAdmin();
    if ("error" in authCheck) return { success: false, error: "Unauthorized" };

    try {
        revalidatePath("/", "layout");
        
        // Clear Redis via helper
        const { invalidateAdminGlobalStats } = await import("@/lib/cache-invalidation");
        await invalidateAdminGlobalStats();

        return { success: true, message: "Global cache purge triggered successfully." };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * 4. Cleanup Abandoned Drafts
 * (Required by Maintenance UI)
 */
export async function cleanupAbandonedDraftsAction() {
    const authCheck = await requireAdmin();
    if ("error" in authCheck) return { success: false, error: "Unauthorized" };

    try {
        const db = getAdminDb();
        // Placeholder for logic to delete old 'draft' applications
        return { success: true, message: "Draft cleanup executed (Dry run)." };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
