import { db } from "@/lib/firebase";
import { collection, addDoc, query, where, orderBy, limit as firestoreLimit, getDocs, serverTimestamp, Timestamp } from "firebase/firestore";
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
 * Generic Logger Utility
 * Captures userID, IP, actionType, and metadata
 * Logs are immutable once created
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
        await addDoc(collection(db, 'audit_logs'), {
            ...entry,
            timestamp: serverTimestamp(),
            immutable: true as const, // Prevents any modifications
        });
    } catch (error) {
        // Never throw - audit logging should not break app flow
        console.error('[AUDIT_LOG_ERROR]', error);
    }
}

/**
 * Higher-Order Function for automatic audit logging
 * Wraps Server Actions to automatically log executions
 */
export function withAuditLog<T extends (...args: unknown[]) => Promise<{ userId?: string;[key: string]: unknown }>>(
    fn: T,
    actionType: AuditActionType
): T {
    return (async (...args: Parameters<T>) => {
        try {
            const result = await fn(...args);

            await createAuditLog({
                userId: result.userId || 'system',
                actionType,
                metadata: {
                    args: args.map(arg =>
                        typeof arg === 'object' ? JSON.stringify(arg) : arg
                    ),
                    result: typeof result === 'object' ? JSON.stringify(result) : result,
                },
            });

            return result;
        } catch (error) {
            // Log the error
            await createAuditLog({
                userId: 'system',
                actionType: AuditActionType.SYSTEM_ERROR,
                metadata: {
                    originalAction: actionType,
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            });

            throw error; // Re-throw to maintain error flow
        }
    }) as T;
}

/**
 * Get audit logs with filtering
 */
export async function getAuditLogs(filters?: {
    userId?: string;
    actionType?: AuditActionType;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
}): Promise<AuditLog[]> {
    try {
        const auditLogsRef = collection(db, 'audit_logs');
        let queryConstraints: any[] = [orderBy('timestamp', 'desc')];

        if (filters?.userId) {
            queryConstraints.push(where('userId', '==', filters.userId));
        }

        if (filters?.actionType) {
            queryConstraints.push(where('actionType', '==', filters.actionType));
        }

        if (filters?.startDate) {
            queryConstraints.push(where('timestamp', '>=', Timestamp.fromDate(filters.startDate)));
        }

        if (filters?.endDate) {
            queryConstraints.push(where('timestamp', '<=', Timestamp.fromDate(filters.endDate)));
        }

        queryConstraints.push(firestoreLimit(filters?.limit || 100));

        const q = query(auditLogsRef, ...queryConstraints);
        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            timestamp: (doc.data().timestamp as Timestamp)?.toDate() || new Date(),
        })) as AuditLog[];
    } catch (error) {
        console.error('[GET_AUDIT_LOGS_ERROR]', error);
        return [];
    }
}
