import { getAdminDb } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
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
    | 'user_gender_update'
    | 'ai_chat_message'
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
    | 'legacy_member_onboarded'
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
    | 'loan_product_created'
    | 'loan_product_updated'
    | 'loan_product_deleted'
    | 'contribution_made'
    | 'withdrawal_made'
    | 'withdrawal_requested'
    | 'withdrawal_approved'
    | 'withdrawal_rejected'
    | 'withdrawal_approve'
    | 'withdrawal_reject'
    // Admin Actions
    | 'land_created'
    | 'land_updated'
    | 'land_verified'
    | 'land_rejected'
    | 'land_deleted'
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
    | 'approve_marketplace_user'
    | 'reject_marketplace_user'
    // Product moderation. There was no admin path to a product at all before
    // reviewProductAction, so there was nothing to audit and no action name.
    | 'product_approved'
    | 'product_rejected'
    | 'product_suspended'
    // WAVE Actions
    | 'wave_enrollment'
    | 'wave_training_created'
    | 'wave_training_updated'
    | 'wave_training_deleted'
    | 'wave_application_approved'
    | 'wave_application_rejected'
    | 'wave_approve'
    | 'wave_reject'
    | 'wave_shipment_created'
    | 'wave_withdrawal_approve'
    | 'wave_withdrawal_reject'
    | 'wave_withdrawal_complete'
    | 'training_registration'
    // LMS Actions
    | 'course_created'
    | 'course_updated'
    | 'course_deleted'
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
    | 'academy_update_payment'
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
    | 'chatbot_session_resolved'
    | 'data_access'
    | 'FETCH_COOPERATIVE_MEMBERS'
    | 'FETCH_COOPERATIVE_TRANSACTIONS'
    | 'FETCH_WAVE_APPLICATIONS'
    | 'telemetry_broadcast_sent'
    // ── Added when the unaudited-write baseline was cleared ──────────────
    // Twenty-nine permission-gated admin writes recorded nothing. Most were
    // already named by this union — 'content:approve', 'export_create',
    // 'farm_nation_reject', 'quiz_created' — which is what showed the
    // convention was ninety-percent applied rather than unbuilt. These are the
    // names it was missing.
    | 'broadcast_sent'
    | 'cooperative_member_status_update'
    | 'cooperative_revision_request'
    | 'data_recovery_run'
    | 'escrow_status_update'
    | 'export_catalog_delete'
    | 'export_product_delete'
    | 'export_product_review'
    | 'farm_nation_approve'
    | 'guarantor_verified'
    | 'inspector_dispatched'
    | 'kyc_qoreid_verify'
    | 'password_resets_purged'
    | 'paystack_sync_run'
    | 'recovery_emails_sent'
    | 'review_moderate'
    | 'village_market_event_created'
    | 'village_market_event_status_update'
    | 'village_market_merchant_added'
    | 'wave_shipment_status_update';

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
        'wave_training_deleted',
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

        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(AUDIT_LOGS_COLLECTION)
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

/**
 * Legacy Audit Log Entry Interface (from audit.ts)
 */
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
    ipAddress?: string;
    userAgent?: string;
}

/**
 * Unified/Consolidated logAuditAction helper to support both legacy and admin signatures
 */
export async function logAuditAction(
    actionOrEntry: any,
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
        if (actionOrEntry && typeof actionOrEntry === 'object') {
            // Legacy signature (from src/lib/audit.ts)
            const entry = actionOrEntry as LegacyAuditLogEntry;
            await createAuditLog({
                userId: entry.userId,
                action: entry.action as AuditAction,
                details: entry.details || "",
                targetId: entry.resourceId || entry.targetId,
                targetType: entry.resourceType || entry.targetType,
                metadata: entry.metadata,
                ipAddress: entry.ip || entry.ipAddress,
                userAgent: entry.userAgent,
            });
        } else {
            // Admin signature (from src/lib/admin-audit-log.ts)
            const action = actionOrEntry as AuditAction;
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
        }
    } catch (error) {
        logger.error('Failed to create audit log in logAuditAction:', error instanceof Error ? error : undefined);
    }
}

/**
 * Retrieve security context from HTTP request headers
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

/**
 * Record an admin action WITHOUT ever failing the operation it records.
 *
 * createAuditLog rethrows. Every existing call site awaits it inside the same
 * try block as the work itself, so a logging failure — a transient database
 * error, a full disk — aborts an operation that has already happened. On a
 * money path that is the worst possible outcome: the withdrawal was paid, the
 * loan disbursed, and the caller is told it failed.
 *
 * An audit row is a record OF the operation, not a part of it. When one cannot
 * be written the operation still succeeded and the right response is a loud log
 * and a completed request — not a rollback of something already irreversible.
 *
 * Use this at new call sites. The 118 existing createAdminAuditLog calls are
 * left as they are: changing them is a behaviour change to working paths, and
 * is separate from adding the rows that were missing entirely.
 */
export async function recordAdminAction(
    entry: Omit<AuditLogEntry, 'timestamp' | 'id' | 'severity'>,
): Promise<void> {
    try {
        await createAuditLog(entry);
    } catch (error) {
        logger.error(
            `[audit] Could not record ${entry.action} on ${entry.targetType ?? "?"}:${entry.targetId ?? "?"} `
            + `by ${entry.userId} — THE OPERATION ITSELF SUCCEEDED and is not recorded.`,
            error instanceof Error ? error : undefined,
        );
    }
}

// Backward compatibility exports for audit-log-admin.ts / admin-audit-log.ts
export const createAdminAuditLog = createAuditLog;
export { logFinancialAction as logAdminFinancialAction };

