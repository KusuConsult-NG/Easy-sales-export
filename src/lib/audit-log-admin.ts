import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from '@/lib/logger';
import { AuditAction, AuditSeverity } from './audit-log';

/**
 * Server-Side Audit Logger (Uses Firebase Admin SDK)
 * Bypasses Firestore Rules to ensure reliable logging from Server Actions.
 */

const AUDIT_LOGS_COLLECTION = 'audit_logs';

/**
 * Auto-assign severity based on action type (Reuse logic if possible, or duplicate for safety)
 */
function getSeverityForAction(action: AuditAction): AuditSeverity {
    const criticalActions: AuditAction[] = [
        'user_delete',
        'escrow_refunded',
        'loan_disbursed',
        'suspicious_activity',
        'feature_toggled',
        'data_export',
        'resource_delete',
        'mfa_disabled',
    ];

    const warningActions: AuditAction[] = [
        'payment_failed',
        'loan_rejected',
        'land_rejected',
        'session_expired',
        'user_unverify',
        'announcement_deleted',
    ];

    if (criticalActions.includes(action)) return 'critical';
    if (warningActions.includes(action)) return 'warning';
    return 'info';
}

export interface AuditLogEntry {
    id?: string;
    action: AuditAction;
    severity?: AuditSeverity;
    userId: string;
    userEmail?: string;
    userRole?: string;
    targetId?: string;
    targetType?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    timestamp?: Timestamp | FieldValue;
    details?: string;
}

/**
 * Create an audit log entry using Admin SDK
 * Safe to use in Server Actions
 */
export async function createAdminAuditLog(entry: Omit<AuditLogEntry, 'timestamp' | 'id' | 'severity'>): Promise<string | null> {
    try {
        const db = getAdminDb();

        const logEntry = {
            ...entry,
            severity: getSeverityForAction(entry.action),
            timestamp: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection(AUDIT_LOGS_COLLECTION).add(logEntry);
        return docRef.id;
    } catch (error) {
        // Log error but DO NOT THROW. Audit logging should not break the user flow.
        logger.error('Failed to create admin audit log', error instanceof Error ? error : undefined);
        return null;
    }
}

/**
 * Helper to log financial actions (Admin SDK)
 */
export async function logAdminFinancialAction(
    action: AuditAction,
    userId: string,
    amount: number,
    targetId?: string,
    metadata?: Record<string, any>
): Promise<void> {
    await createAdminAuditLog({
        action,
        userId,
        targetId,
        targetType: 'financial_transaction',
        metadata: {
            ...metadata,
            amount,
        },
    });
}

/**
 * Helper to log admin actions (Admin SDK)
 */
export async function logAdminAction(
    action: AuditAction,
    adminId: string,
    targetId?: string,
    targetType?: string,
    details?: string
): Promise<void> {
    await createAdminAuditLog({
        action,
        userId: adminId,
        targetId,
        targetType,
        details,
    });
}
