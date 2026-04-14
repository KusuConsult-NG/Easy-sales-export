import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from './logger';

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
    | 'user_suspend'
    | 'user_activate'
    | 'user_role_change'
    | 'user_impersonate'
    | 'user_kyc_verify_bvn'
    | 'user_kyc_verify_nin'
    | 'user_kyc_verify_tin'
    | 'user_kyc_verify_cac'
    | 'user_kyc_unverify_bvn'
    | 'user_kyc_unverify_nin'
    | 'user_kyc_unverify_tin'
    | 'user_kyc_unverify_cac'
    | 'account_unlock'
    | 'legacy_member_import'
    | 'legacy_member_invited'
    // Financial Actions
    | 'payment_initiated'
    | 'payment_completed'
    | 'payment_failed'
    | 'escrow_created'
    | 'escrow_released'
    | 'escrow_refunded'
    | 'loan_applied'
    | 'loan_approved'
    | 'loan_partially_approved'
    | 'loan_rejected'
    | 'loan_disbursed'
    | 'loan_repaid'
    | 'contribution_made'
    | 'withdrawal_made'
    | 'withdrawal_requested'
    | 'withdrawal_approved'
    | 'withdrawal_rejected'
    | 'withdrawal_approve'
    | 'withdrawal_reject'
    // Admin Actions
    | 'land_verified'
    | 'land_rejected'
    | 'land_inquiry'
    | 'land_approve'
    | 'land_reject'
    | 'dispute_created'
    | 'dispute_resolved'
    | 'dispute_escalated'
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
    | 'config_updated'
    | 'config_rollback'
    | 'admin_edit_application'
    // Marketplace Actions
    | 'seller_approved'
    | 'seller_rejected'
    | 'seller_suspended'
    | 'seller_approve'
    | 'seller_reject'
    | 'seller_badge_grant'
    | 'seller_badge_revoke'
    // WAVE Actions
    | 'wave_enrollment'
    | 'wave_training_created'
    | 'wave_training_updated'
    | 'wave_application_approved'
    | 'wave_application_rejected'
    | 'wave_approve'
    | 'wave_reject'
    | 'training_registration'
    // LMS Actions
    | 'course_created'
    | 'course_updated'
    | 'course_enrolled'
    | 'course_completed'
    | 'certificate_issued'
    | 'quiz_created'
    // Security Actions
    | 'mfa_enabled'
    | 'mfa_disabled'
    | 'password_changed'
    | 'session_expired'
    | 'suspicious_activity'
    | 'failed_login_attempt'
    | 'data_export'
    // Academy Actions
    | 'academy_approve'
    | 'academy_reject'
    | 'academy_under_review'
    | 'academy_application_created'
    | 'export_investment'
    | 'system_cleanup'
    | 'academy_manual_enroll'
    // Export Actions
    | 'export_create'
    | 'export_status_update'
    | 'export_approve'
    | 'export_reject'
    // Farm Nation & Cooperative
    | 'farm_nation_reject'
    | 'cooperative_join'
    | 'contribution_make'
    // Content Moderation Actions
    | 'content:approve'
    | 'content:reject'
    | 'content:flag'
    // AI Chatbot Actions (Phase 13)
    | 'chatbot_session_started'
    | 'chatbot_escalated'
    | 'chatbot_session_resolved';

export type AuditSeverity = 'info' | 'warning' | 'critical';

/**
 * Auto-assign severity based on action type
 */
export function getSeverityForAction(action: AuditAction): AuditSeverity {
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
    timestamp: any;
    details?: string;
}

const AUDIT_LOGS_COLLECTION = 'audit_logs';

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: Omit<AuditLogEntry, 'timestamp' | 'id' | 'severity'>): Promise<string> {
    try {
        const db = getAdminDb();
        const logEntry: Omit<AuditLogEntry, 'id'> = {
            ...entry,
            severity: getSeverityForAction(entry.action),
            timestamp: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection(AUDIT_LOGS_COLLECTION).add(logEntry);
        return docRef.id;
    } catch (error) {
        logger.error('Failed to create audit log', error instanceof Error ? error : undefined);
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
        const db = getAdminDb();
        const retentionDays = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '30', 10);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        let q: FirebaseFirestore.Query = db.collection(AUDIT_LOGS_COLLECTION)
            .where('timestamp', '>=', Timestamp.fromDate(options.startDate || cutoffDate))
            .orderBy('timestamp', 'desc');

        if (options.userId) {
            q = q.where('userId', '==', options.userId);
        }

        if (options.action) {
            q = q.where('action', '==', options.action);
        }

        if (options.endDate) {
            // Need to apply this carefully due to Firestore limits on inequality filters.
            // Using in memory filter later if multiple inequality filters are applied!
            // But if it's the same field ('timestamp'), we can just do '<='
            q = q.where('timestamp', '<=', Timestamp.fromDate(options.endDate));
        }

        if (options.limit) {
            q = q.limit(options.limit);
        }

        const snapshot = await q.get();

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        } as AuditLogEntry));
    } catch (error) {
        logger.error('Failed to fetch audit logs', error instanceof Error ? error : undefined);
        throw error;
    }
}

/**
 * Purge old audit logs (scheduled task)
 * Should be called periodically (e.g., daily cron job)
 */
export async function purgeOldAuditLogs(): Promise<number> {
    try {
        const db = getAdminDb();
        const retentionDays = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '30', 10);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        const q = db.collection(AUDIT_LOGS_COLLECTION)
            .where('timestamp', '<', Timestamp.fromDate(cutoffDate));

        const snapshot = await q.get();

        let deletedCount = 0;
        const batch = db.batch();
        for (const doc of snapshot.docs) {
            batch.delete(doc.ref);
            deletedCount++;
        }
        await batch.commit();

        logger.info(`Purged ${deletedCount} audit logs older than ${retentionDays} days`, { deletedCount, retentionDays });
        return deletedCount;
    } catch (error) {
        logger.error('Failed to purge audit logs', error instanceof Error ? error : undefined);
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
