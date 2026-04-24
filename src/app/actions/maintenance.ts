"use server";

import { db, getAdminAuth } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Cleanup Abandoned Drafts
 * Deletes 'draft' land listings older than 30 days.
 */
export async function cleanupAbandonedDraftsAction(): Promise<{ success: boolean; count?: number; error?: string }> {
    const authCheck = await requireAdmin();
    if ("error" in authCheck) return { success: false, error: "Unauthorized: admin role required" };
    try {

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30); // 30 days ago

        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "==", "draft")
            .where("updatedAt", "<", Timestamp.fromDate(cutoffDate))
            .get();

        if (snapshot.empty) {
            return { success: true, count: 0 };
        }

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();

        await createAdminAuditLog({
            action: "system_cleanup",
            userId: "system",
            targetType: "land_listings",
            details: `Cleaned up ${snapshot.size} abandoned drafts older than 30 days`,
        });

        logger.info(`Cleaned up ${snapshot.size} abandoned draft listings.`);

        return { success: true, count: snapshot.size };
    } catch (error: any) {
        logger.error("Cleanup drafts error:", error);
        return { success: false, error: error.message };
    }
}
