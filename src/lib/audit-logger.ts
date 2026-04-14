/**
 * audit-logger.ts
 *
 * Server-side audit logger using Firebase Admin SDK.
 *
 * FIXED: Previously imported the CLIENT-SIDE Firebase SDK (`@/lib/firebase`)
 * which caused crashes when this file was imported in server actions / API
 * routes (the client SDK cannot run in Node.js server environment).
 * Now uses the Admin SDK exclusively, consistent with all other server-side code.
 *
 * This module is a convenience wrapper around `createAdminAuditLog` from
 * `@/lib/audit-log-admin`. Use `createAdminAuditLog` directly in new code.
 */

import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { AuditActionType, type AuditLog } from "@/types/strict";

interface AuditLogEntry {
    userId: string;
    actionType: AuditActionType;
    resourceId?: string;
    resourceType?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
}

/**
 * Generic Logger Utility (Admin SDK)
 * Captures userId, actionType, and metadata.
 * Logs are immutable once created.
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
        const db = getAdminDb();
        await db.collection("audit_logs").add({
            ...entry,
            timestamp: FieldValue.serverTimestamp(),
            immutable: true as const,
        });
    } catch (error) {
        // Never throw — audit logging must not break the user flow
        console.error("[AUDIT_LOG_ERROR]", error);
    }
}

/**
 * Higher-Order Function for automatic audit logging
 * Wraps Server Actions to automatically log executions
 */
export function withAuditLog<T extends (...args: unknown[]) => Promise<{ userId?: string; [key: string]: unknown }>>(
    fn: T,
    actionType: AuditActionType
): T {
    return (async (...args: Parameters<T>) => {
        try {
            const result = await fn(...args);
            await createAuditLog({
                userId: result.userId || "system",
                actionType,
                metadata: {
                    args: args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : arg)),
                    result: typeof result === "object" ? JSON.stringify(result) : result,
                },
            });
            return result;
        } catch (error) {
            await createAuditLog({
                userId: "system",
                actionType: AuditActionType.SYSTEM_ERROR,
                metadata: {
                    originalAction: actionType,
                    error: error instanceof Error ? error.message : "Unknown error",
                },
            });
            throw error;
        }
    }) as T;
}

/**
 * Get audit logs with filtering (Admin SDK)
 */
export async function getAuditLogs(filters?: {
    userId?: string;
    actionType?: AuditActionType;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
}): Promise<AuditLog[]> {
    try {
        const db = getAdminDb();
        let query: FirebaseFirestore.Query = db
            .collection("audit_logs")
            .orderBy("timestamp", "desc")
            .limit(filters?.limit || 100);

        if (filters?.userId) {
            query = query.where("userId", "==", filters.userId);
        }
        if (filters?.actionType) {
            query = query.where("actionType", "==", filters.actionType);
        }
        if (filters?.startDate) {
            const { Timestamp } = await import("firebase-admin/firestore");
            query = query.where("timestamp", ">=", Timestamp.fromDate(filters.startDate));
        }
        if (filters?.endDate) {
            const { Timestamp } = await import("firebase-admin/firestore");
            query = query.where("timestamp", "<=", Timestamp.fromDate(filters.endDate));
        }

        const snapshot = await query.get();
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate?.() ?? new Date(),
        })) as unknown as AuditLog[];
    } catch (error) {
        console.error("[GET_AUDIT_LOGS_ERROR]", error);
        return [];
    }
}
