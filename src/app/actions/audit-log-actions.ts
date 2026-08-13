"use server";

import { ActionResponse } from "@/lib/safe-action";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { csvCell } from "@/lib/csv-safe";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import type { AuditLogEntry, AuditAction, AuditSeverity } from "@/lib/audit-log";
import { getCached, setCache } from "@/lib/redis";
import { hasAdminPermission } from "@/lib/admin-permissions";

/**
 * How many rows the statistics panel will read.
 *
 * The counts it produces are indicative — top actions, top users over a window
 * — so reading a bounded slice is honest for that purpose in a way it would not
 * be for a financial total.
 */
const MAX_STATS_ROWS = 10_000;

/** How many audit rows one CSV export will read. 40 pages x 500. */
const MAX_EXPORT_ROWS = 20_000;
const EXPORT_PAGE_SIZE = 500;

/**
 * Neutralise a spreadsheet formula in a CSV cell.
 *
 * A cell beginning with =, +, - or @ is executed as a formula by Excel and
 * Google Sheets. Audit rows carry `userEmail` and a `details` blob built from
 * metadata that is, in places, whatever a user typed — a product title, a name,
 * a rejection reason. So a user could store `=HYPERLINK(...)` and have it run on
 * the machine of the admin who exports the log to investigate them.
 *
 * The quoting below already handles embedded quotes and commas. It does not
 * help here: a formula is still a formula inside quotes.
 *
 * A leading apostrophe is the conventional fix — spreadsheets treat the cell as
 * text and do not display the apostrophe. Tab and carriage return are stripped
 * of their leading position for the same reason.
 */


/**
 * Get audit logs with enhanced filtering
 */
export async function getAuditLogsAction(filters: { userId?: string;
    userEmail?: string;
    action?: AuditAction;
    severity?: AuditSeverity;
    startDate?: string;
    endDate?: string;
    limit?: number;
    lastDocId?: string; }): Promise<ActionResponse<AuditLogEntry[]>> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Authentication required", data: null };
        }

        // READING the log is left as it is: admin or super_admin.
        //
        // Deliberately NOT switched to hasAdminPermission(roles, "audit:read"),
        // even though that is the matrix's own answer, because the matrix grants
        // "audit:read" to NINE roles — moderator, support, and every module
        // admin. Routing this through it would open the platform's activity log
        // to support agents in the course of tightening the export, which is a
        // policy change wearing the clothes of a bug fix.
        //
        // So the code and the matrix disagree here, in the opposite direction to
        // the export below: the matrix is broader than the code. Which is right
        // is a decision for whoever owns the permission model, and it is written
        // down here rather than resolved quietly in either direction.
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const hasAdminRole = userData?.roles?.includes("admin") || userData?.roles?.includes("super_admin") || userData?.role === "admin";
        if (!hasAdminRole) { return { success: false as const, error: "Admin access required", data: null };
        }

        let q = db.collection(COLLECTIONS.AUDIT_LOGS).orderBy("timestamp", "desc");

        // Apply filters
        if (filters.userId) { q = q.where("userId", "==", filters.userId);
        }

        if (filters.userEmail) { q = q.where("userEmail", "==", filters.userEmail);
        }

        if (filters.action) { q = q.where("action", "==", filters.action);
        }

        if (filters.severity) { q = q.where("severity", "==", filters.severity);
        }

        if (filters.startDate) { q = q.where("timestamp", ">=", new Date(filters.startDate));
        }

        if (filters.endDate) { q = q.where("timestamp", "<=", new Date(filters.endDate));
        }

        if (filters.lastDocId) { const lastDoc = await db.collection(COLLECTIONS.AUDIT_LOGS).doc(filters.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        const fetchLimit = filters.limit || 50;
        q = q.limit(fetchLimit);

        const snapshot = await q.get();

        const logs = serializeDocs(snapshot.docs) as unknown as AuditLogEntry[];

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { success: true as const, error: null, data: logs, lastDocId: nextCursor, hasMore: !!nextCursor };
    } catch (error: any) { logger.error("Failed to fetch audit logs:", error);
        return { success: false as const, error: error.message || "Failed to fetch audit logs", data: null };
    }
}

/**
 * Export audit logs to CSV
 */
export async function exportAuditLogsCSV(filters: { userId?: string;
    userEmail?: string;
    action?: AuditAction;
    severity?: AuditSeverity;
    startDate?: string;
    endDate?: string; }): Promise<ActionResponse<any>> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Authentication required", data: null };
        }

        // Exporting the audit log is a super_admin permission, and this asked
        // only for a role.
        //
        // PERMISSION_MATRIX draws the line deliberately: `admin` holds
        // "audit:read" and does NOT hold "audit:export". Reading the log on
        // screen and walking out with the whole thing as a file are different
        // acts, and somebody encoded that. This function accepted any admin, so
        // the distinction existed in the matrix and nowhere else.
        //
        // Checked against the matrix rather than by naming roles, so it stays
        // true if the matrix changes.
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        if (!hasAdminPermission(userData?.roles, "audit:export")) {
            return { success: false as const, error: "Exporting the audit log requires super admin access", data: null };
        }

        // The comment here said "no limit for export". It called
        // getAuditLogsAction, which applies `filters.limit || 50` — and this
        // function's own filter type has no `limit` field, so it could never be
        // anything else.
        //
        // So every audit export ever produced contained the 50 most recent rows
        // and was handed over as the export. An audit log is the thing you
        // export precisely when something has gone wrong, and a silently
        // truncated one answers the wrong question convincingly.
        //
        // It pages properly now, with a ceiling, and says so when it hits it.
        const logs: any[] = [];
        let cursor: string | undefined;
        let truncated = false;

        while (logs.length < MAX_EXPORT_ROWS) {
            const page = await getAuditLogsAction({
                ...filters,
                limit: EXPORT_PAGE_SIZE,
                lastDocId: cursor,
            });
            if (!page.success || !page.data) {
                return { success: false as const, error: page.error || "Failed to fetch logs", data: null };
            }
            logs.push(...page.data);

            cursor = (page as any).lastDocId;
            if (!cursor || page.data.length === 0) break;

            if (logs.length >= MAX_EXPORT_ROWS) {
                truncated = true;
                logger.error(
                    `[AuditExport] Hit the ${MAX_EXPORT_ROWS}-row ceiling. The CSV is INCOMPLETE — ` +
                    `narrow the date range or raise MAX_EXPORT_ROWS.`
                );
            }
        }

        const result = { success: true as const, data: logs };

        // Generate CSV
        const headers = ["Timestamp", "Severity", "Action", "User ID", "User Email", "Target Type", "Target ID", "Details"];
        const rows = result.data.map((log: any) => { let timestampStr = "";
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
            ...rows.map((row: string[]) => row.map(csvCell).join(",")),
            // Stated in the file itself, not only in a log line nobody reads.
            // Someone opening this spreadsheet has to be able to see that it is
            // a portion rather than the whole.
            ...(truncated
                ? [csvCell(`TRUNCATED: only the first ${MAX_EXPORT_ROWS} rows are included. Narrow the date range.`)]
                : []),
        ].join("\n");

        return { error: null, success: true as const, data: csvContent };
    } catch (error: any) { logger.error("Failed to export audit logs:", error);
        return { success: false as const, error: error.message || "Failed to export logs", data: null };
    }
}

/**
 * Get audit log statistics
 */
export async function getAuditStatsAction(days: number = 30): Promise<ActionResponse<any>> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

        if (!session?.user?.id) { return { success: false as const, error: "Authentication required", data: null };
        }

        // Check if user is admin
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const hasAdminRole = userData?.roles?.includes("admin") || userData?.roles?.includes("super_admin") || userData?.role === "admin";
        if (!hasAdminRole) { return { success: false as const, error: "Admin access required", data: null };
        }

        // `days` arrived from the caller and went straight into a query with no
        // limit and into a cache key.
        //
        // getAuditStatsAction(1_000_000) reads the entire audit log of a 41,000
        // user platform into memory to count it, and every distinct value mints
        // a new Redis key that lives for two minutes — so a loop over `days`
        // fills the cache with entries nothing will ever read again.
        //
        // A year is more than any dashboard asks for, and the clamp is silent
        // rather than an error because this is a stats panel: showing a year
        // when asked for ten is better than showing an error.
        const requestedDays = Number(days);
        const boundedDays = Number.isFinite(requestedDays)
            ? Math.min(365, Math.max(1, Math.floor(requestedDays)))
            : 30;

        const cacheKey = `admin:audit-stats:${boundedDays}`;
        try { const cachedStats = await getCached<any>(cacheKey);
            if (cachedStats) {
                return { error: null, success: true as const, data: cachedStats };
            }
        } catch (e) { // cache bypass on error
        }

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - boundedDays);

        // Bounded. The window above limits how much history is asked for; this
        // limits how much comes back if a busy day produces more than expected.
        const q = db.collection(COLLECTIONS.AUDIT_LOGS)
            .where("timestamp", ">=", startDate)
            .limit(MAX_STATS_ROWS);

        const snapshot = await q.get();
        const logs = serializeDocs(snapshot.docs) as unknown as AuditLogEntry[];

        // Calculate statistics
        const stats = { totalLogs: logs.length,
            bySeverity: {
                info: logs.filter((l) => l.severity === "info").length,
                warning: logs.filter((l) => l.severity === "warning").length,
                critical: logs.filter((l) => l.severity === "critical").length },
            topActions: [] as { action: string; count: number }[],
            topUsers: [] as { userId: string; userEmail: string; count: number }[] };

        // Top actions
        const actionCounts: Record<string, number> = {};
        logs.forEach((log) => { actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
        });
        stats.topActions = Object.entries(actionCounts)
            .map(([action, count]) => ({ action, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Top users
        const userCounts: Record<string, { email: string; count: number }> = {};
        logs.forEach((log) => { if (!userCounts[log.userId]) {
                userCounts[log.userId] = { email: log.userEmail || "Unknown", count: 0 };
            }
            userCounts[log.userId].count++;
        });
        stats.topUsers = Object.entries(userCounts)
            .map(([userId, data]) => ({ userId, userEmail: data.email, count: data.count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        try { await setCache(cacheKey, stats, 120); // Cache for 2 minutes
        } catch (e) { // silent fail
        }

        return { error: null,  success: true as const, data: stats };
    } catch (error: any) { logger.error("Failed to fetch audit stats:", error);
        return { success: false as const, error: error.message || "Failed to fetch statistics", data: null };
    }
}
