"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, query, where, getDocs, orderBy, Timestamp } from "firebase/firestore";
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
}): Promise<{ success: boolean; logs?: AuditLogEntry[]; error?: string }> {
    try {
        const session = await auth();

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Admin access required" };
        }

        let q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"));

        // Apply filters
        if (filters.userId) {
            q = query(q, where("userId", "==", filters.userId));
        }

        if (filters.userEmail) {
            q = query(q, where("userEmail", "==", filters.userEmail));
        }

        if (filters.action) {
            q = query(q, where("action", "==", filters.action));
        }

        if (filters.severity) {
            q = query(q, where("severity", "==", filters.severity));
        }

        if (filters.startDate) {
            q = query(q, where("timestamp", ">=", Timestamp.fromDate(new Date(filters.startDate))));
        }

        if (filters.endDate) {
            q = query(q, where("timestamp", "<=", Timestamp.fromDate(new Date(filters.endDate))));
        }

        const snapshot = await getDocs(q);

        const logs = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as AuditLogEntry[];

        // Apply limit if specified
        const limited = filters.limit ? logs.slice(0, filters.limit) : logs;

        return { success: true, logs: limited };
    } catch (error: any) {
        console.error("Failed to fetch audit logs:", error);
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
        const session = await auth();

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Admin access required" };
        }

        // Get logs (no limit for export)
        const result = await getAuditLogsAction(filters);

        if (!result.success || !result.logs) {
            return { success: false, error: result.error || "Failed to fetch logs" };
        }

        // Generate CSV
        const headers = ["Timestamp", "Severity", "Action", "User ID", "User Email", "Target Type", "Target ID", "Details"];
        const rows = result.logs.map((log) => [
            log.timestamp.toDate().toISOString(),
            log.severity,
            log.action,
            log.userId,
            log.userEmail || "",
            log.targetType || "",
            log.targetId || "",
            log.details || "",
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map((row) =>
                row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
            ),
        ].join("\n");

        return { success: true, csv: csvContent };
    } catch (error: any) {
        console.error("Failed to export audit logs:", error);
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
        const session = await auth();

        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check if user is admin
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Admin access required" };
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const q = query(
            collection(db, "audit_logs"),
            where("timestamp", ">=", Timestamp.fromDate(startDate))
        );

        const snapshot = await getDocs(q);
        const logs = snapshot.docs.map((doc) => doc.data()) as AuditLogEntry[];

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
        console.error("Failed to fetch audit stats:", error);
        return { success: false, error: error.message || "Failed to fetch statistics" };
    }
}
