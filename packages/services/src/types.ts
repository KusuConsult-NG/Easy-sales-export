/**
 * Service contract types for @easy-sales/services
 *
 * These interfaces define the contracts that service implementations must fulfil.
 * Extracting contracts from implementations allows domain apps to depend on
 * interfaces rather than concrete Firebase/Node implementations.
 */

/** Generic service response */
export interface ServiceResult<T = void> {
    success: boolean;
    data?: T;
    error?: string;
}

/** Audit log write contract */
export interface AuditLogEntry {
    action: string;
    userId: string;
    targetId?: string;
    targetType?: string;
    metadata?: Record<string, unknown>;
    severity?: "info" | "warning" | "critical";
}

/** Notification write contract */
export interface NotificationPayload {
    userId: string;
    type: string;
    title: string;
    message: string;
    link?: string;
    linkText?: string;
}

/** Email send contract */
export interface EmailPayload {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
}
