"use server";

import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { createAuditLog } from '@/lib/audit-log';
import type { AuditAction, AuditLogEntry } from '@/lib/audit-log';
import { getAuditLogsAction as coreGetAuditLogsAction } from './audit-log-actions';
import { isPlatformAdmin } from "@/lib/admin-permissions";


/**
 * Audit Logging System
 *
 * Tracks all admin actions for compliance and security.
 * The AuditLog type is the canonical definition from @/lib/types/shared.
 * AdminAuditLog is the admin-panel specific view shape with a typed `action` field.
 */
export interface AdminAuditLog {
    id: string;
    action: AuditAction;
    adminId: string;
    adminEmail: string;
    targetId: string;
    targetType: "user" | "application" | "withdrawal" | "export" | "cooperative" | "cooperative_member" | "land_listing" | "seller_verification" | "export_onboarding" | "export_onboarding_applications" | "academy_application" | string;
    details: Record<string, unknown>;
    timestamp: Date;
    ipAddress?: string;
}

type LogAuditState =
    | { success: true; error: null; data?: unknown; meta?: unknown; [key: string]: unknown }
    | { success: false; error: string; data?: null; meta?: unknown; [key: string]: unknown };

type GetAuditLogsState =
    | { success: true; error: null; data?: unknown; meta?: unknown; [key: string]: unknown }
    | { success: false; error: string; data?: null; meta?: unknown; [key: string]: unknown };

/**
 * Log an audit event
 */
export async function logAuditAction(
    action: AuditAction,
    targetId: string,
    targetType: string,
    details: Record<string, any> = {}
): Promise<LogAuditState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
        const { session } = sessionResult;

        await createAuditLog({ action,
            userId: session.user.id,
            userEmail: session.user.email || "",
            targetId,
            targetType,
            details: JSON.stringify(details),
            metadata: details });

        return { error: null, success: true as const , data: null };
    } catch (error: any) { logger.error("Audit log error:", error);
        return { error: "Failed to log audit action", success: false as const, data: null };
    }
}

/**
 * Get recent audit logs (admin only)
 */
export async function getAuditLogsAction(
    limitCount: number = 50
): Promise<GetAuditLogsState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthenticated", data: null };
        const { session } = sessionResult;
        // #365. NOT audit:read, which every one of the ten admin roles holds —
        // widening who may read the audit log is a decision, not a refactor.
        if (!session?.user || !isPlatformAdmin(session.user.roles)) { return { error: "Unauthorized: Admin access required", success: false as const, data: null };
        }

        const result = await coreGetAuditLogsAction({ limit: limitCount });
        
        if (!result.success || !result.data) { return { error: result.error || "Failed to fetch audit logs", success: false as const, data: null };
        }

        // Map standard AuditLogEntry to legacy admin-panel format
        const logs: AdminAuditLog[] = (result.data as AuditLogEntry[]).map((log: AuditLogEntry) => { let logDate = new Date();
            if (log.timestamp && typeof log.timestamp === 'object' && 'toDate' in log.timestamp) {
                logDate = log.timestamp.toDate(); 
            } else if (log.timestamp && typeof log.timestamp === 'string') { logDate = new Date(log.timestamp);
            }

            return {
                id: log.id || '',
                action: log.action as AuditAction,
                adminId: log.userId,
                adminEmail: log.userEmail || '',
                targetId: log.targetId || '',
                targetType: log.targetType || '',
                details: log.metadata || {},
                timestamp: logDate };
        });

        return { error: null, success: true as const, data: logs };
    } catch (error: any) { logger.error("Get audit logs error:", error);
        return { error: "Failed to fetch audit logs", success: false as const, data: null };
    }
}
