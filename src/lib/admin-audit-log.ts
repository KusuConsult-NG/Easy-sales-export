/**
 * Enhanced Audit Log System with IP/Device Tracking
 * 
 * SECURITY: Immutable append-only audit trail for compliance
 */

import { db } from './firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS } from './types/firestore';

/**
 * Audit Action Types
 */
export type AuditAction =
    // User Actions
    | 'user_login'
    | 'user_logout'
    | 'user_register'
    | 'user_verify'
    | 'user_unverify'
    | 'user_delete'
    | 'user_update'
    | 'user_suspend'
    | 'user_activate'
    | 'user_role_change'
    | 'user_impersonate'
    // Financial Actions
    | 'payment_initiated'
    | 'payment_completed'
    | 'payment_failed'
    | 'escrow_created'
    | 'escrow_released'
    | 'escrow_refunded'
    | 'loan_applied'
    | 'loan_approved'
    | 'loan_rejected'
    | 'loan_disbursed'
    | 'loan_repaid'
    | 'contribution_made'
    | 'withdrawal_requested'
    | 'withdrawal_approved'
    | 'withdrawal_rejected'
    // Admin Actions
    | 'land_verified'
    | 'land_rejected'
    | 'dispute_created'
    | 'dispute_resolved'
    | 'seller_approved'
    | 'seller_rejected'
    | 'seller_suspended'
    | 'announcement_created'
    | 'announcement_updated'
    | 'announcement_deleted'
    | 'feature_toggled'
    | 'config_updated'
    | 'config_rollback'
    // WAVE Actions
    | 'wave_approve'
    | 'wave_reject'
    | 'wave_training_updated'
    // Academy Actions
    | 'course_created'
    | 'course_updated'
    | 'quiz_created'
    | 'certificate_issued'
    | 'academy_approve'
    | 'academy_reject'
    // Content Moderation Actions
    | 'content:approve'
    | 'content:reject'
    | 'content:flag'
    // Security Actions
    | 'mfa_enabled'
    | 'mfa_disabled'
    | 'password_changed'
    | 'session_expired'
    | 'suspicious_activity'
    | 'failed_login_attempt'
    | 'data_export';


export type AuditSeverity = 'info' | 'warning' | 'critical';

/**
 * Enhanced Audit Log Entry with security metadata
 */
export interface AdminAuditLogEntry {
    action: AuditAction;
    userId: string;
    userEmail?: string;
    userRoles?: string[];
    targetId?: string;
    targetType?: string;
    metadata?: Record<string, any>;

    // Security Context
    ipAddress?: string;
    userAgent?: string;
    deviceFingerprint?: string;
    geolocation?: {
        country?: string;
        city?: string;
    };

    // Timestamps
    timestamp: typeof FieldValue.serverTimestamp;

    // Integrity
    severity: AuditSeverity;
    details?: string;
}

/**
 * Auto-assign severity based on action type
 */
function getSeverityForAction(action: AuditAction): AuditSeverity {
    const criticalActions: AuditAction[] = [
        'user_delete',
        'user_role_change',
        'user_impersonate',
        'escrow_refunded',
        'loan_disbursed',
        'seller_suspended',
        'feature_toggled',
        'config_updated',
        'config_rollback',
        'data_export',
        'mfa_disabled',
        'suspicious_activity',
    ];

    const warningActions: AuditAction[] = [
        'user_suspend',
        'payment_failed',
        'loan_rejected',
        'land_rejected',
        'seller_rejected',
        'withdrawal_rejected',
        'session_expired',
        'user_unverify',
        'failed_login_attempt',
    ];

    if (criticalActions.includes(action)) return 'critical';
    if (warningActions.includes(action)) return 'warning';
    return 'info';
}

/**
 * Create an audit log entry
 * 
 * SECURITY: This uses Admin SDK for append-only writes
 */
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
        // This function is called from server actions where we have session context
        // The userId should be passed in metadata.adminId or metadata.userId
        const userId = metadata?.adminId || metadata?.userId || 'system';

        const logEntry: Omit<AdminAuditLogEntry, 'timestamp'> & { timestamp: any } = {
            action,
            userId,
            targetId,
            targetType,
            metadata,
            severity: getSeverityForAction(action),
            ipAddress: securityContext?.ipAddress,
            userAgent: securityContext?.userAgent,
            deviceFingerprint: securityContext?.deviceFingerprint,
            timestamp: FieldValue.serverTimestamp(),
        };

        await db.collection(COLLECTIONS.AUDIT_LOGS).add(logEntry);
    } catch (error) {
        console.error('Failed to create audit log:', error);
        // Don't throw - audit logs should never block operations
    }
}

/**
 * Get audit logs with filters (Admin only)
 */
export async function getAuditLogs(options: {
    userId?: string;
    action?: AuditAction;
    severity?: AuditSeverity;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
}): Promise<AdminAuditLogEntry[]> {
    try {
        let query = db.collection(COLLECTIONS.AUDIT_LOGS)
            .orderBy('timestamp', 'desc');

        if (options.userId) {
            query = query.where('userId', '==', options.userId);
        }

        if (options.action) {
            query = query.where('action', '==', options.action);
        }

        if (options.severity) {
            query = query.where('severity', '==', options.severity);
        }

        if (options.startDate) {
            query = query.where('timestamp', '>=', Timestamp.fromDate(options.startDate));
        }

        if (options.endDate) {
            query = query.where('timestamp', '<=', Timestamp.fromDate(options.endDate));
        }

        if (options.limit) {
            query = query.limit(options.limit);
        }

        const snapshot = await query.get();

        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                action: data.action,
                userId: data.userId,
                userEmail: data.userEmail,
                userRoles: data.userRoles,
                targetId: data.targetId,
                targetType: data.targetType,
                metadata: data.metadata,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
                deviceFingerprint: data.deviceFingerprint,
                geolocation: data.geolocation,
                timestamp: data.timestamp,
                severity: data.severity,
                details: data.details,
                id: doc.id,
            } as AdminAuditLogEntry;
        });
    } catch (error) {
        console.error('Failed to fetch audit logs:', error);
        throw error;
    }
}

/**
 * Get security context from request headers (for server actions)
 */
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
