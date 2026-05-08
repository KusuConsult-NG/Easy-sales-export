import { createAuditLog } from "./audit-log";
import type { AuditAction } from "./audit-log";
import { logger } from "@/lib/logger";

export interface LegacyAuditLogEntry {
    userId: string;
    action: string;
    details?: string;
    resourceId?: string;
    resourceType?: string;
    targetId?: string;
    targetType?: string;
    metadata?: Record<string, any>;
    ip?: string;
    userAgent?: string;
}

/**
 * Log sensitive actions to Firestore (Legacy Proxy)
 */
export async function logAuditAction(entry: LegacyAuditLogEntry) {
    try {
        await createAuditLog({
            userId: entry.userId,
            action: entry.action as AuditAction,
            details: entry.details || "",
            targetId: entry.resourceId || entry.targetId,
            targetType: entry.resourceType || entry.targetType,
            metadata: entry.metadata,
            ipAddress: entry.ip,
            userAgent: entry.userAgent,
        });
    } catch (error) {
        // Fallback to console logger if Firestore fails (don't block the action)
        logger.error("Failed to write audit log:", error);
    }
}
