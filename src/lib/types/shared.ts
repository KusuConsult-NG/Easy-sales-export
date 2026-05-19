/**
 * Shared / Platform-wide Types
 *
 * These types are used across multiple modules and don't belong to a single domain.
 * Part of the Platform Type Isolation — Phase 0 Migration
 */

export interface Notification {
    id: string;
    userId: string;
    type: "escrow" | "order" | "academy" | "wave" | "cooperative" | "export"
        | "payment" | "loan" | "system" | "event" | "payout"
        | "info" | "warning" | "success" | "farm_nation" | "marketplace" | "general"
        | "transaction";
    title: string;
    message: string;
    link?: string;
    linkText?: string; // CTA button label e.g. "View Loans"
    read: boolean;
    createdAt: Date;
}

export interface Payment {
    id: string;
    userId: string;
    amount: number;
    type: string;
    status: "pending" | "completed" | "failed";
    reference: string;
    createdAt: Date;
}

export interface UnifiedTransaction {
    id: string;
    userId: string;
    type: string;
    module: "wave" | "cooperative" | "marketplace" | "farm_nation" | "export" | "academy" | "general" | "wallet";
    amount: number;
    currency: string;
    status: "pending" | "completed" | "failed" | "refunded";
    date: Date;
    reference?: string;
    description?: string;
    metadata?: Record<string, unknown>;
}

export interface PlatformSettings {
    platformName: string;
    supportEmail: string;
    contactPhone: string;
    defaultCurrency: "NGN" | "USD" | "GBP";
    maintenanceMode: boolean;
    updatedBy?: string;
    updatedAt?: Date;
}

export interface PasswordResetToken {
    id: string;
    email: string;
    token: string;
    expiry: number; // Unix ms timestamp
    used: boolean;
    usedAt?: Date;
    createdAt: Date;
}

export interface Announcement {
    id: string;
    title: string;
    message: string;
    type: "info" | "warning" | "success";
    createdAt: Date;
}

export interface AuditLog {
    id: string;
    userId: string;
    action: string;
    entityId?: string;
    entityType?: string;
    targetId?: string;
    targetType?: string;
    details?: string;
    metadata?: Record<string, any>;
    adminId?: string;
    severity?: "info" | "warning" | "critical";
    userEmail?: string;
    userRole?: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
    createdAt?: Date;
}
