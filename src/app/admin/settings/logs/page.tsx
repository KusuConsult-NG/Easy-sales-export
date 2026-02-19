"use client";

import { useState, useEffect } from "react";
import { Database, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";

export default function SystemLogsPage() {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchLogs() {
            try {
                const { getDashboardStatsAction } = await import("@/app/actions/admin-analytics");
                const data = await getDashboardStatsAction();
                setLogs(data.recentTransactions.map(t => ({
                    ...t,
                    level: "info",
                    timestamp: t.date,
                })));
            } catch {
                // No logs yet
            } finally {
                setLoading(false);
            }
        }
        fetchLogs();
    }, []);

    return (
        <div className="p-8">
            <Link href="/admin/settings" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
                ← Back to Settings
            </Link>
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">System Logs</h1>
                    <p className="text-slate-600">View system health and audit logs</p>
                </div>
                <button onClick={() => window.location.reload()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-medium transition">
                    <RefreshCw className="w-4 h-4" /> Refresh
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            ) : logs.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
                    <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-600 font-medium">No logs recorded yet</p>
                    <p className="text-sm text-slate-400 mt-1">Logs will appear as users interact with the platform</p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-left font-semibold text-slate-600">Timestamp</th>
                                <th className="px-6 py-4 text-left font-semibold text-slate-600">Action</th>
                                <th className="px-6 py-4 text-left font-semibold text-slate-600">Level</th>
                                <th className="px-6 py-4 text-left font-semibold text-slate-600">ID</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {logs.map((log, i) => (
                                <tr key={i} className="hover:bg-slate-50">
                                    <td className="px-6 py-3 text-slate-500 font-mono text-xs">
                                        {new Date(log.timestamp).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-3 font-medium text-slate-900">{log.type}</td>
                                    <td className="px-6 py-3">
                                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                                            {log.level}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 font-mono text-xs text-slate-400">{log.id}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
