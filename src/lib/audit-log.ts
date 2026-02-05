import { getFirestore, Timestamp } from 'firebase/firestore';
import { collection, addDoc, query, where, getDocs, orderBy, limit as firestoreLimit, deleteDoc } from 'firebase/firestore';
import app from './firebase';

/**
 * Audit Log Types
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
    | 'withdrawal_made'
    // Admin Actions
    | 'land_verified'
    | 'land_rejected'
    | 'dispute_created'
    | 'dispute_resolved'
    | 'announcement_published'
    | 'announcement_created'
    | 'announcement_updated'
    | 'announcement_deleted'
    | 'announcement_deactivated'
    | 'banner_created'
    | 'banner_deactivated'
    | 'resource_uploaded'
    | 'resource_download'
    | 'resource_update'
    | 'resource_delete'
    | 'feature_toggled'
    // WAVE Actions
    | 'wave_enrollment'
    | 'training_registration'
    // LMS Actions
    | 'course_enrolled'
    | 'course_completed'
    | 'certificate_issued'
    // Security Actions
    | 'mfa_enabled'
    | 'mfa_disabled'
    | 'password_changed'
    | 'session_expired'
    | 'suspicious_activity'
    | 'data_export';

export type AuditSeverity = 'info' | 'warning' | 'critical';

/**
 * Auto-assign severity based on action type
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
    severity: AuditSeverity;
    userId: string;
    userEmail?: string;
    userRole?: string;
    targetId?: string; // ID of affected resource (e.g., loan ID, land ID)
    targetType?: string; // Type of resource
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Timestamp;
    details?: string;
}

const db = getFirestore(app);
const AUDIT_LOGS_COLLECTION = 'audit_logs';

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: Omit<AuditLogEntry, 'timestamp' | 'id' | 'severity'>): Promise<string> {
    try {
        const logEntry: Omit<AuditLogEntry, 'id'> = {
            ...entry,
            severity: getSeverityForAction(entry.action),
            timestamp: Timestamp.now(),
        };

        const docRef = await addDoc(collection(db, AUDIT_LOGS_COLLECTION), logEntry);
        return docRef.id;
    } catch (error) {
        console.error('Failed to create audit log:', error);
        throw error;
    }
}

/**
 * Get audit logs with filters
 */
export async function getAuditLogs(options: {
    userId?: string;
    action?: AuditAction;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
}): Promise<AuditLogEntry[]> {
    try {
        const retentionDays = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '30', 10);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        let q = query(
            collection(db, AUDIT_LOGS_COLLECTION),
            where('timestamp', '>=', Timestamp.fromDate(options.startDate || cutoffDate)),
            orderBy('timestamp', 'desc')
        );

        if (options.userId) {
            q = query(q, where('userId', '==', options.userId));
        }

        if (options.action) {
            q = query(q, where('action', '==', options.action));
        }

        if (options.endDate) {
            q = query(q, where('timestamp', '<=', Timestamp.fromDate(options.endDate)));
        }

        if (options.limit) {
            q = query(q, firestoreLimit(options.limit));
        }

        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        } as AuditLogEntry));
    } catch (error) {
        console.error('Failed to fetch audit logs:', error);
        throw error;
    }
}

/**
 * Purge old audit logs (scheduled task)
 * Should be called periodically (e.g., daily cron job)
 */
export async function purgeOldAuditLogs(): Promise<number> {
    try {
        const retentionDays = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '30', 10);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        const q = query(
            collection(db, AUDIT_LOGS_COLLECTION),
            where('timestamp', '<', Timestamp.fromDate(cutoffDate))
        );

        const snapshot = await getDocs(q);

        let deletedCount = 0;
        for (const doc of snapshot.docs) {
            await deleteDoc(doc.ref);
            deletedCount++;
        }

        console.log(`Purged ${deletedCount} audit logs older than ${retentionDays} days`);
        return deletedCount;
    } catch (error) {
        console.error('Failed to purge audit logs:', error);
        throw error;
    }
}

/**
 * Helper to log financial actions
 */
export async function logFinancialAction(
    action: AuditAction,
    userId: string,
    amount: number,
    targetId?: string,
    metadata?: Record<string, any>
): Promise<void> {
    await createAuditLog({
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
 * Helper to log admin actions
 */
export async function logAdminAction(
    action: AuditAction,
    adminId: string,
    targetId?: string,
    targetType?: string,
    details?: string
): Promise<void> {
    await createAuditLog({
        action,
        userId: adminId,
        targetId,
        targetType,
        details,
    });
}
