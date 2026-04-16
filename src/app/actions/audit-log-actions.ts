"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import type { AuditLogEntry, AuditAction, AuditSeverity } from "@/lib/audit-log";

/**
 * Get audit logs with enhanced filtering
 */
export async function getAuditLogsAction(filters: {
    userId?: string;
    userEmail?: string;
    action?: AuditAction;
    severity?: AuditSeverity;
    startDate?: string;
    endDate?: string;
    limit?: number;
    lastDocId?: string;
}): Promise<{ success: boolean; logs?: AuditLogEntry[]; error?: string; lastDocId?: string; hasMore?: boolean }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const hasAdminRole = userData.roles?.includes("admin") || userData.roles?.includes("super_admin") || userData.role === "admin";
        if (!hasAdminRole) {
            return { success: false, error: "Admin access required" };
        }

        let q = db.collection(COLLECTIONS.AUDIT_LOGS).orderBy("timestamp", "desc");

        // Apply filters
        if (filters.userId) {
            q = q.where("userId", "==", filters.userId);
        }

        if (filters.userEmail) {
            q = q.where("userEmail", "==", filters.userEmail);
        }

        if (filters.action) {
            q = q.where("action", "==", filters.action);
        }

        if (filters.severity) {
            q = q.where("severity", "==", filters.severity);
        }

        if (filters.startDate) {
            q = q.where("timestamp", ">=", new Date(filters.startDate));
        }

        if (filters.endDate) {
            q = q.where("timestamp", "<=", new Date(filters.endDate));
        }

        if (filters.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.AUDIT_LOGS).doc(filters.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        const fetchLimit = filters.limit || 50;
        q = q.limit(fetchLimit);

        const snapshot = await q.get();

        const logs = serializeDocs(snapshot.docs) as unknown as AuditLogEntry[];

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            logs,
            lastDocId: nextCursor,
            hasMore: !!nextCursor
        };
    } catch (error: any) {
        logger.error("Failed to fetch audit logs:", error);
        return { success: false, error: error.message || "Failed to fetch audit logs" };
    }
}

/**
 * Export audit logs to CSV
 */
export async function exportAuditLogsCSV(filters: {
    userId?: string;
    userEmail?: string;
    action?: AuditAction;
    severity?: AuditSeverity;
    startDate?: string;
    endDate?: string;
}): Promise<{ success: boolean; csv?: string; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const hasAdminRole = userData.roles?.includes("admin") || userData.roles?.includes("super_admin") || userData.role === "admin";
        if (!hasAdminRole) {
            return { success: false, error: "Admin access required" };
        }

        // Get logs (no limit for export)
        const result = await getAuditLogsAction(filters);

        if (!result.success || !result.logs) {
            return { success: false, error: result.error || "Failed to fetch logs" };
        }

        // Generate CSV
        const headers = ["Timestamp", "Severity", "Action", "User ID", "User Email", "Target Type", "Target ID", "Details"];
        const rows = result.logs.map((log: any) => {
            let timestampStr = "";
            if (typeof log.timestamp === "string") timestampStr = log.timestamp;
            else if (log.timestamp?.toDate) timestampStr = log.timestamp.toDate().toISOString();
            else timestampStr = String(log.timestamp);
            
            return [
                timestampStr,
                log.severity,
                log.action,
                log.userId,
                log.userEmail || "",
                log.targetType || "",
                log.targetId || "",
                log.details ? JSON.stringify(log.details) : "",
            ];
        });

        const csvContent = [
            headers.join(","),
            ...rows.map((row) =>
                row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
            ),
        ].join("\n");

        return { success: true, csv: csvContent };
    } catch (error: any) {
        logger.error("Failed to export audit logs:", error);
        return { success: false, error: error.message || "Failed to export logs" };
    }
}

/**
 * Get audit log statistics
 */
export async function getAuditStatsAction(days: number = 30): Promise<{
    success: boolean;
    stats?: {
        totalLogs: number;
        bySeverity: { info: number; warning: number; critical: number };
        topActions: { action: string; count: number }[];
        topUsers: { userId: string; userEmail: string; count: number }[];
    };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const hasAdminRole = userData.roles?.includes("admin") || userData.roles?.includes("super_admin") || userData.role === "admin";
        if (!hasAdminRole) {
            return { success: false, error: "Admin access required" };
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const q = db.collection(COLLECTIONS.AUDIT_LOGS).where("timestamp", ">=", startDate);

        const snapshot = await q.get();
        const logs = serializeDocs(snapshot.docs) as unknown as AuditLogEntry[];

        // Calculate statistics
        const stats = {
            totalLogs: logs.length,
            bySeverity: {
                info: logs.filter((l) => l.severity === "info").length,
                warning: logs.filter((l) => l.severity === "warning").length,
                critical: logs.filter((l) => l.severity === "critical").length,
            },
            topActions: [] as { action: string; count: number }[],
            topUsers: [] as { userId: string; userEmail: string; count: number }[],
        };

        // Top actions
        const actionCounts: Record<string, number> = {};
        logs.forEach((log) => {
            actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
        });
        stats.topActions = Object.entries(actionCounts)
            .map(([action, count]) => ({ action, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Top users
        const userCounts: Record<string, { email: string; count: number }> = {};
        logs.forEach((log) => {
            if (!userCounts[log.userId]) {
                userCounts[log.userId] = { email: log.userEmail || "Unknown", count: 0 };
            }
            userCounts[log.userId].count++;
        });
        stats.topUsers = Object.entries(userCounts)
            .map(([userId, data]) => ({ userId, userEmail: data.email, count: data.count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return { success: true, stats };
    } catch (error: any) {
        logger.error("Failed to fetch audit stats:", error);
        return { success: false, error: error.message || "Failed to fetch statistics" };
    }
}
