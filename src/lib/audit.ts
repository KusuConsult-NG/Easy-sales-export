
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "@/lib/logger";

export interface AuditLogEntry {
    userId: string;
    action: string;
    details: string;
    metadata?: Record<string, any>;
    ip?: string;
    userAgent?: string;
}

/**
 * Log sensitive actions to Firestore
 */
export async function logAuditAction(entry: AuditLogEntry) {
    try {
        await db.collection(COLLECTIONS.AUDIT_LOGS).add({
            ...entry,
            timestamp: FieldValue.serverTimestamp(),
        });
    } catch (error) {
        // Fallback to console logger if Firestore fails (don't block the action)
        logger.error("Failed to write audit log:", error);
    }
}
