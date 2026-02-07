"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    Shield,
    Download,
    Loader2,
    AlertTriangle,
    Info,
    AlertCircle,
    Filter,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import {
    getAuditLogsAction,
    exportAuditLogsCSV,
    getAuditStatsAction,
} from "@/app/actions/audit-log-actions";
import type { AuditLogEntry, AuditSeverity } from "@/lib/audit-log";

const severityConfig = {
    info: { color: "blue", icon: Info, label: "Info" },
    warning: { color: "yellow", icon: AlertTriangle, label: "Warning" },
    critical: { color: "red", icon: AlertCircle, label: "Critical" },
};

export default function AdminAuditLogsPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [logs, setLogs] = useState<AuditLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);

    // Filters
    const [filters, setFilters] = useState({
        userEmail: "",
        severity: "" as AuditSeverity | "",
        startDate: "",
        endDate: "",
    });

    // Stats
    const [stats, setStats] = useState<{
        totalLogs: number;
        bySeverity: { info: number; warning: number; critical: number };
    } | null>(null);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        }
    }, [status, router]);

    useEffect(() => {
        async function loadData() {
            if (status !== "authenticated") return;

            setLoading(true);

            // Load logs
            const logsResult = await getAuditLogsAction({
                userEmail: filters.userEmail || undefined,
                severity: filters.severity || undefined,
                startDate: filters.startDate || undefined,
                endDate: filters.endDate || undefined,
                limit: 100,
            });

            if (logsResult.success && logsResult.logs) {
                setLogs(logsResult.logs);
            }

            // Load stats
            const statsResult = await getAuditStatsAction(30);
            if (statsResult.success && statsResult.stats) {
                setStats(statsResult.stats);
            }

            setLoading(false);
        }

        loadData();
    }, [status, filters]);

    async function handleExport() {
        setExporting(true);

        const result = await exportAuditLogsCSV({
            userEmail: filters.userEmail || undefined,
            severity: filters.severity || undefined,
            startDate: filters.startDate || undefined,
            endDate: filters.endDate || undefined,
        });

        if (result.success && result.csv) {
            const blob = new Blob([result.csv], { type: "text/csv" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `audit-logs-${new Date().toISOString()}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
        } else {
            alert(result.error || "Failed to export logs");
        }

        setExporting(false);
    }

    function formatDate(timestamp: any): string {
        if (!timestamp) return "Unknown";
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString();
    }

    function formatAction(action: string): string {
        return action
            .split("_")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-blue-900 to-slate-900 p-4 sm:p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2 flex items-center space-x-2 sm:space-x-3">
                            <Shield className="w-8 h-8 sm:w-10 sm:h-10 text-blue-400" />
                            <span>Audit Logs</span>
                        </h1>
                        <p className="text-sm sm:text-base text-blue-200">Monitor all system activities and security events</p>
                    </div>
                    <button
                        onClick={handleExport}
                        disabled={exporting || logs.length === 0}
                        className="w-full sm:w-auto px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white rounded-xl font-medium transition flex items-center justify-center space-x-2 touch-manipulation"
                    >
                        {exporting ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Exporting...</span>
                            </>
                        ) : (
                            <>
                                <Download className="w-5 h-5" />
                                <span>Export CSV</span>
                            </>
                        )}
                    </button>
                </div>

                {/* Stats Cards */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
                            <div className="text-sm text-blue-300 mb-1">Total Logs (30 days)</div>
                            <div className="text-3xl font-bold text-white">{stats.totalLogs.toLocaleString()}</div>
                        </div>
                        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
                            <div className="text-sm text-blue-300 mb-1 flex items-center space-x-2">
                                <Info className="w-4 h-4" />
                                <span>Info</span>
                            </div>
                            <div className="text-3xl font-bold text-blue-400">{stats.bySeverity.info.toLocaleString()}</div>
                        </div>
                        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
                            <div className="text-sm text-yellow-300 mb-1 flex items-center space-x-2">
                                <AlertTriangle className="w-4 h-4" />
                                <span>Warning</span>
                            </div>
                            <div className="text-3xl font-bold text-yellow-400">{stats.bySeverity.warning.toLocaleString()}</div>
                        </div>
                        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6">
                            <div className="text-sm text-red-300 mb-1 flex items-center space-x-2">
                                <AlertCircle className="w-4 h-4" />
                                <span>Critical</span>
                            </div>
                            <div className="text-3xl font-bold text-red-400">{stats.bySeverity.critical.toLocaleString()}</div>
                        </div>
                    </div>
                )}

                {/* Filters */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 mb-6">
                    <div className="flex items-center space-x-2 mb-4">
                        <Filter className="w-5 h-5 text-blue-300" />
                        <h2 className="text-lg font-semibold text-white">Filters</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        {/* User Email */}
                        <div>
                            <label className="block text-sm text-blue-200 mb-2">User Email</label>
                            <input
                                type="text"
                                value={filters.userEmail}
                                onChange={(e) => setFilters({ ...filters, userEmail: e.target.value })}
                                placeholder="user@example.com"
                                className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder:text-blue-200/50 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            />
                        </div>

                        {/* Severity */}
                        <div>
                            <label className="block text-sm text-blue-200 mb-2">Severity</label>
                            <select
                                value={filters.severity}
                                onChange={(e) => setFilters({ ...filters, severity: e.target.value as any })}
                                className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            >
                                <option value="">All</option>
                                <option value="info">Info</option>
                                <option value="warning">Warning</option>
                                <option value="critical">Critical</option>
                            </select>
                        </div>

                        {/* Start Date */}
                        <div>
                            <label className="block text-sm text-blue-200 mb-2">Start Date</label>
                            <input
                                type="date"
                                value={filters.startDate}
                                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                                className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            />
                        </div>

                        {/* End Date */}
                        <div>
                            <label className="block text-sm text-blue-200 mb-2">End Date</label>
                            <input
                                type="date"
                                value={filters.endDate}
                                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                                className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                            />
                        </div>

                        {/* Clear Filters */}
                        <div className="flex items-end">
                            <button
                                onClick={() => setFilters({ userEmail: "", severity: "", startDate: "", endDate: "" })}
                                className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition text-sm"
                            >
                                Clear Filters
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 text-sm text-blue-300">
                        Showing {logs.length} logs
                    </div>
                </div>

                {/* Logs Table */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-8 h-8 text-blue-300 animate-spin" />
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="p-12 text-center">
                            <Shield className="w-16 h-16 text-blue-300 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">No audit logs found</h3>
                            <p className="text-blue-200">Try adjusting your filters</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-white/5 border-b border-white/10">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">Timestamp</th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">Severity</th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">Action</th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">User</th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white">Target</th>
                                        <th className="px-6 py-4 text-left text-sm font-semibold text-white"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/10">
                                    {logs.map((log) => {
                                        const { color, icon: Icon, label } = severityConfig[log.severity];
                                        const isExpanded = expandedRow === log.id;

                                        return (
                                            <>
                                                <tr
                                                    key={log.id}
                                                    className="hover:bg-white/5 transition cursor-pointer"
                                                    onClick={() => setExpandedRow(isExpanded ? null : log.id || null)}
                                                >
                                                    <td className="px-6 py-4 text-sm text-blue-200">
                                                        {formatDate(log.timestamp)}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span className={`inline-flex items-center space-x-1 px-3 py-1 bg-${color}-500/20 text-${color}-300 rounded-full text-xs font-medium`}>
                                                            <Icon className="w-3 h-3" />
                                                            <span>{label}</span>
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-white font-medium">
                                                        {formatAction(log.action)}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-blue-200">
                                                        <div>{log.userEmail || "Unknown"}</div>
                                                        <div className="text-xs text-blue-300">{log.userId.substring(0, 8)}...</div>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-blue-200">
                                                        {log.targetType || "-"}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {isExpanded ? (
                                                            <ChevronUp className="w-5 h-5 text-blue-300" />
                                                        ) : (
                                                            <ChevronDown className="w-5 h-5 text-blue-300" />
                                                        )}
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr>
                                                        <td colSpan={6} className="px-6 py-4 bg-white/5">
                                                            <div className="space-y-2 text-sm">
                                                                {log.targetId && (
                                                                    <div>
                                                                        <span className="text-blue-300">Target ID:</span>
                                                                        <span className="text-white ml-2 font-mono">{log.targetId}</span>
                                                                    </div>
                                                                )}
                                                                {log.details && (
                                                                    <div>
                                                                        <span className="text-blue-300">Details:</span>
                                                                        <span className="text-white ml-2">{log.details}</span>
                                                                    </div>
                                                                )}
                                                                {log.metadata && Object.keys(log.metadata).length > 0 && (
                                                                    <div>
                                                                        <span className="text-blue-300">Metadata:</span>
                                                                        <pre className="mt-2 text-xs bg-black/30 p-3 rounded-lg overflow-x-auto">
                                                                            {JSON.stringify(log.metadata, null, 2)}
                                                                        </pre>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
