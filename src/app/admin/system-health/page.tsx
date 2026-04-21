"use client";

import { useState, useEffect } from "react";
import { runSystemHealthDiagnostic, type HealthReport, type HealthIssue } from "@/app/actions/health";
import { Activity, AlertTriangle, CheckCircle, RefreshCw, ShieldAlert } from "lucide-react";

export default function SystemHealthPage() {
    const [loading, setLoading] = useState(true);
    const [report, setReport] = useState<HealthReport | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadDiagnostic = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await runSystemHealthDiagnostic(2000);
            if (res.success && res.data) {
                setReport(res.data);
            } else {
                setError(res.error || "Failed to load diagnostic data.");
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadDiagnostic();
    }, []);

    const isHealthy = report && report.anomaliesFound === 0;

    return (
        <div className="p-6 md:p-10 space-y-8 bg-slate-50 min-h-screen">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-red-600 to-orange-600">
                        System Health Monitor
                    </h1>
                    <p className="text-slate-500 mt-1">Diagnostic overview of active Data Integrity Rules and Platform Sessions.</p>
                </div>
                <button
                    onClick={loadDiagnostic}
                    disabled={loading}
                    className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Run Diagnostic
                </button>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                        <h4 className="font-semibold">Diagnostic Failed</h4>
                        <p className="text-sm">{error}</p>
                    </div>
                </div>
            )}

            {!loading && report && (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
                            <div className="flex items-center gap-3 text-slate-500 mb-4">
                                <Activity className="w-5 h-5 text-blue-500" />
                                <span className="font-medium text-sm uppercase tracking-wide">Documents Scanned</span>
                            </div>
                            <span className="text-4xl font-bold text-slate-900">{report.totalScanned.toLocaleString()}</span>
                            <div className="mt-2 text-xs text-slate-500">Recent Users</div>
                        </div>

                        <div className={`bg-white p-6 rounded-2xl shadow-sm border flex flex-col justify-between ${isHealthy ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30'}`}>
                            <div className="flex items-center gap-3 text-slate-500 mb-4">
                                {isHealthy ? (
                                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                                ) : (
                                    <ShieldAlert className="w-5 h-5 text-red-500" />
                                )}
                                <span className="font-medium text-sm uppercase tracking-wide">System State</span>
                            </div>
                            <span className={`text-4xl font-bold ${isHealthy ? 'text-emerald-700' : 'text-red-700'}`}>
                                {isHealthy ? 'Healthy' : 'At Risk'}
                            </span>
                            <div className={`mt-2 text-xs ${isHealthy ? 'text-emerald-600' : 'text-red-600'}`}>
                                Data Integrity Rules Validated
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
                            <div className="flex items-center gap-3 text-slate-500 mb-4">
                                <AlertTriangle className="w-5 h-5 text-orange-500" />
                                <span className="font-medium text-sm uppercase tracking-wide">Anomalies Detected</span>
                            </div>
                            <span className="text-4xl font-bold text-slate-900">{report.anomaliesFound}</span>
                            <div className="mt-2 text-xs text-slate-500">Conflicts Detected in Core Platform</div>
                        </div>
                    </div>

                    {/* Report Table */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h2 className="font-semibold text-slate-800">Flagged User Accounts</h2>
                        </div>
                        {report.issues.length === 0 ? (
                            <div className="p-12 text-center text-slate-500">
                                <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                                <p className="text-lg font-medium text-slate-900">No issues found!</p>
                                <p className="text-sm mt-1">All scanned accounts comply with platform constraints.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-medium">
                                        <tr>
                                            <th className="px-6 py-4">User</th>
                                            <th className="px-6 py-4">Issue Type</th>
                                            <th className="px-6 py-4">Expected State</th>
                                            <th className="px-6 py-4">Actual State</th>
                                            <th className="px-6 py-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {report.issues.map((issue, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                                                <td className="px-6 py-4">
                                                    <div className="font-medium text-slate-900 truncate max-w-[200px]" title={issue.email}>
                                                        {issue.email}
                                                    </div>
                                                    <div className="text-xs text-slate-400 font-mono mt-1">
                                                        {issue.id}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 text-red-700 text-xs font-semibold whitespace-nowrap">
                                                        <AlertTriangle className="w-3.5 h-3.5" />
                                                        {issue.issueType}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-slate-600 font-mono text-xs">
                                                    {issue.expectedState}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="font-mono text-xs bg-slate-100 px-2 flex py-1 rounded border border-slate-200 break-all max-w-xs">
                                                        {issue.actualState}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <a 
                                                        href={`/admin/users/${issue.id}`} 
                                                        className="text-blue-600 font-medium hover:text-blue-800 text-sm whitespace-nowrap"
                                                    >
                                                        Review Profile
                                                    </a>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
            
            {loading && (
                <div className="p-20 text-center text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-slate-300" />
                    <p>Running platform-wide structural tests...</p>
                </div>
            )}
        </div>
    );
}
