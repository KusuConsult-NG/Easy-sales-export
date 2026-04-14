import { createAuditLog } from './audit-log';
import type { AuditAction, AuditSeverity } from './audit-log';

// Map AdminAuditLogEntry to the standard AuditLogEntry from audit-log.ts
export interface AdminAuditLogEntry {
    action: AuditAction;
    userId: string;
    userEmail?: string;
    userRoles?: string[];
    targetId?: string;
    targetType?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprint?: string;
    geolocation?: {
        country?: string;
        city?: string;
    };
    timestamp: any;
    severity: AuditSeverity;
    details?: string;
}

export async function logAuditAction(
    action: AuditAction,
    targetId?: string,
    targetType?: string,
    metadata?: Record<string, any>,
    securityContext?: {
        ipAddress?: string;
        userAgent?: string;
        deviceFingerprint?: string;
    }
): Promise<void> {
    try {
        const userId = metadata?.adminId || metadata?.userId || 'system';

        await createAuditLog({
            action,
            userId,
            targetId,
            targetType,
            metadata: {
                ...metadata,
                deviceFingerprint: securityContext?.deviceFingerprint,
            },
            ipAddress: securityContext?.ipAddress,
            userAgent: securityContext?.userAgent,
        });
    } catch (error) {
        console.error('Failed to create audit log:', error);
    }
}

export { getAuditLogs } from './audit-log';

export function getSecurityContextFromHeaders(headers?: Headers): {
    ipAddress?: string;
    userAgent?: string;
} {
    if (!headers) return {};

    return {
        ipAddress: headers.get('x-forwarded-for')?.split(',')[0] || headers.get('x-real-ip') || undefined,
        userAgent: headers.get('user-agent') || undefined,
    };
}
export type { AuditAction, AuditSeverity };
