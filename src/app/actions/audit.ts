"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Audit Logging System
 * 
 * Tracks all admin actions for compliance and security.
 */

export type AuditAction =
    | "wave_approve"
    | "wave_reject"
    | "withdrawal_approve"
    | "withdrawal_reject"
    | "user_verify"
    | "user_unverify"
    | "user_role_change"
    | "user_role_update"
    | "account_unlock"
    | "export_create"
    | "export_status_update"
    | "cooperative_join"
    | "contribution_make"
    | "announcement_created"
    | "announcement_updated"
    | "announcement_deleted"
    | "banner_created"
    | "loan_approved"
    | "loan_rejected"
    | "land_approve"
    | "land_reject"
    | "land_verified"
    | "land_rejected"
    | "land_rejected"
    | "escrow_released"
    | "seller_approve"
    | "seller_reject"
    | "export_approve"
    | "export_reject"
    | "academy_approve"
    | "academy_reject";

export interface AuditLog {
    id: string;
    action: AuditAction;
    adminId: string;
    adminEmail: string;
    targetId: string;
    targetType: "user" | "application" | "withdrawal" | "export" | "cooperative" | "land_listing" | "seller_verification" | "export_onboarding" | "academy_application";
    details: Record<string, any>;
    timestamp: Date;
    ipAddress?: string;
}

type LogAuditState =
    | { error: string; success: false }
    | { error: null; success: true };

type GetAuditLogsState =
    | { error: string; success: false; data: null }
    | { error: null; success: true; data: AuditLog[] };

/**
 * Log an audit event
 */
export async function logAuditAction(
    action: AuditAction,
    targetId: string,
    targetType: AuditLog["targetType"],
    details: Record<string, any> = {}
): Promise<LogAuditState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        await db.collection(COLLECTIONS.AUDIT_LOGS).add({
            action,
            adminId: session.user.id,
            adminEmail: session.user.email || "",
            targetId,
            targetType,
            details,
            timestamp: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true };
    } catch (error: any) {
        logger.error("Audit log error:", error);
        return { error: "Failed to log audit action", success: false };
    }
}

/**
 * Get recent audit logs (admin only)
 */
export async function getAuditLogsAction(
    limitCount: number = 50
): Promise<GetAuditLogsState> {
    try {
        const session = await auth();
        if (!session?.user || !session.user.roles?.includes("admin")) {
            return { error: "Unauthorized: Admin access required", success: false, data: null };
        }

        const snapshot = await db.collection(COLLECTIONS.AUDIT_LOGS)
            .orderBy("timestamp", "desc")
            .limit(limitCount)
            .get();

        const logs: AuditLog[] = snapshot.docs.map(doc => ({
            id: doc.id,
            action: doc.data().action,
            adminId: doc.data().adminId,
            adminEmail: doc.data().adminEmail,
            targetId: doc.data().targetId,
            targetType: doc.data().targetType,
            details: doc.data().details,
            timestamp: doc.data().timestamp?.toDate() || new Date(),
        })) as AuditLog[];

        return {
            error: null,
            success: true,
            data: logs,
        };
    } catch (error: any) {
        logger.error("Get audit logs error:", error);
        return { error: "Failed to fetch audit logs", success: false, data: null };
    }
}
