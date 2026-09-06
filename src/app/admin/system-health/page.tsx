"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { runSystemHealthDiagnostic, type HealthReport, type HealthIssue } from "@/app/actions/health";
import { Activity, AlertTriangle, CheckCircle, RefreshCw, ShieldAlert, Server, Database, CreditCard, Mail, ToggleLeft, ToggleRight, Search } from "lucide-react";

export default function SystemHealthPage() {
    const [loading, setLoading] = useState(true);
    const [report, setReport] = useState<HealthReport | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadDiagnostic = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await runSystemHealthDiagnostic(200);
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
                {/*
                  *   #362 /admin/system-health/diagnostics HAD NO LINK EITHER.
                  *
                  *        204 lines, a sub-page of this screen, named by
                  *        nothing. Its parent was orphaned too until #361 put
                  *        it in the rendered admin nav — so the whole branch
                  *        was reachable only by typing two URLs.
                  */}
                <Link
                    href="/admin/system-health/diagnostics"
                    className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl shadow-sm hover:bg-slate-50 transition-colors"
                >
                    <Search className="w-4 h-4" />
                    Detailed Diagnostics
                </Link>
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
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
                            <div className="flex items-center gap-3 text-slate-500 mb-4">
                                <Activity className="w-5 h-5 text-blue-500" />
                                <span className="font-medium text-sm uppercase tracking-wide">Scanned</span>
                            </div>
                            <span className="text-4xl font-bold text-slate-900">{report.totalScanned.toLocaleString()}</span>
                            <div className="mt-2 text-xs text-slate-500">Sample Size (Recent Users)</div>
                        </div>

                        <div className={`bg-white p-6 rounded-2xl shadow-sm border flex flex-col justify-between ${isHealthy ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30'}`}>
                            <div className="flex items-center gap-3 text-slate-500 mb-4">
                                {isHealthy ? (
                                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                                ) : (
                                    <ShieldAlert className="w-5 h-5 text-red-500" />
                                )}
                                <span className="font-medium text-sm uppercase tracking-wide">Integrity</span>
                            </div>
                            <span className={`text-4xl font-bold ${isHealthy ? 'text-emerald-700' : 'text-red-700'}`}>
                                {isHealthy ? 'Healthy' : 'At Risk'}
                            </span>
                            <div className={`mt-2 text-xs ${isHealthy ? 'text-emerald-600' : 'text-red-600'}`}>
                                {report.anomaliesFound} Critical Anomalies
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
                            <div className="flex items-center gap-3 text-slate-500 mb-4">
                                <AlertTriangle className="w-5 h-5 text-orange-500" />
                                <span className="font-medium text-sm uppercase tracking-wide">Orphaned Apps</span>
                            </div>
                            <span className="text-4xl font-bold text-slate-900">{report.stats.orphanedApplications}</span>
                            <div className="mt-2 text-xs text-slate-500">Missing User Linkages</div>
                        </div>

                        {/*
                          * #440. A "Desynced Regs" tile stood here showing
                          * `report.stats.desyncedRegistrations`, whose producer
                          * was `const desyncedRegs = 0;` — declared zero, never
                          * computed. It read "0 / Stale Module States" whatever
                          * was true, which is a clean bill of health issued
                          * without looking.
                          *
                          * The cross-module integrity questions are answered by
                          * the forensic scan, which reports "inconclusive" as
                          * its own state rather than folding it into a pass
                          * (#266, #331). This points there instead of showing a
                          * number nobody computed.
                          */}
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
                            <div className="flex items-center gap-3 text-slate-500 mb-4">
                                <ShieldAlert className="w-5 h-5 text-purple-500" />
                                <span className="font-medium text-sm uppercase tracking-wide">Cross-module checks</span>
                            </div>
                            <Link
                                href="/admin/forensics"
                                className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                            >
                                Run the forensic scan →
                            </Link>
                            <div className="mt-2 text-xs text-slate-500">Eight collections, reported per check</div>
                        </div>
                    </div>

                    {/* Service Health & Feature Toggles */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Services */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                            <div className="flex items-center gap-2 mb-6">
                                <Server className="w-5 h-5 text-slate-400" />
                                <h2 className="font-bold text-slate-800">Infrastructure Connectivity</h2>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className={`p-4 rounded-xl border flex items-center gap-3 ${report.services.redis ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                                    <Database className="w-5 h-5" />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold uppercase">Upstash Redis</span>
                                        <span className="text-sm">{report.services.redis ? 'Connected' : 'Disconnected'}</span>
                                    </div>
                                </div>
                                <div className={`p-4 rounded-xl border flex items-center gap-3 ${report.services.firestore ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                                    <Database className="w-5 h-5" />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold uppercase">Cloud Firestore</span>
                                        <span className="text-sm">{report.services.firestore ? 'Active' : 'Error'}</span>
                                    </div>
                                </div>
                                <div className={`p-4 rounded-xl border flex items-center gap-3 ${report.services.paystack ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                                    <CreditCard className="w-5 h-5" />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold uppercase">Paystack API</span>
                                        <span className="text-sm">{report.services.paystack ? 'Configured' : 'Missing Key'}</span>
                                    </div>
                                </div>
                                <div className={`p-4 rounded-xl border flex items-center gap-3 ${report.services.resend ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                                    <Mail className="w-5 h-5" />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold uppercase">Resend Mail</span>
                                        <span className="text-sm">{report.services.resend ? 'Ready' : 'Missing Key'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Feature Toggles */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-2">
                                    <ToggleRight className="w-5 h-5 text-slate-400" />
                                    <h2 className="font-bold text-slate-800">Feature Activation States</h2>
                                </div>
                                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-tighter font-bold">Runtime Toggles</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {Object.entries(report.featureToggles).map(([key, enabled]) => (
                                    <div key={key} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                                        <span className="text-xs font-medium text-slate-600 truncate mr-2" title={key}>{key.replace(/_/g, ' ')}</span>
                                        {enabled ? (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                                <CheckCircle className="w-2.5 h-2.5" /> ON
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">
                                                OFF
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Report Table */}
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-orange-500" />
                                Critical Integrity Conflicts
                            </h2>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold uppercase text-slate-400 bg-white border border-slate-100 px-2 py-1 rounded-lg shadow-xs">
                                    Last Check: {new Date(report.timestamp).toLocaleTimeString()}
                                </span>
                            </div>
                        </div>
                        {report.issues.length === 0 ? (
                            <div className="p-12 text-center text-slate-500">
                                <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
                                <p className="text-lg font-medium text-slate-900">Platform Synchronized!</p>
                                <p className="text-sm mt-1">No structural anomalies detected in current sample.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-medium">
                                        <tr>
                                            <th className="px-6 py-4">User Identity</th>
                                            <th className="px-6 py-4">Conflict Type</th>
                                            <th className="px-6 py-4">Evidence</th>
                                            <th className="px-6 py-4 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {report.issues.map((issue, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                                                <td className="px-6 py-4">
                                                    <div className="font-bold text-slate-900 truncate max-w-[200px]" title={issue.email}>
                                                        {issue.email}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 font-mono mt-0.5 tracking-tight">
                                                        UID: {issue.id}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap ${issue.issueType.includes("High") ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}`}>
                                                        {issue.issueType.includes("High") ? <AlertTriangle className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                                                        {issue.issueType}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Description</span>
                                                        <p className="text-xs text-slate-600 leading-relaxed italic border-l-2 border-slate-100 pl-2">
                                                            {issue.description}
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <a 
                                                        /*
                                                         * /admin/users has no
                                                         * [id] segment, so this
                                                         * 404'd on every row.
                                                         * The users list seeds
                                                         * its search from
                                                         * ?search=, and
                                                         * searchUserIdsByQuery
                                                         * matches email exactly
                                                         * — it does not match a
                                                         * document id at all,
                                                         * which is why this
                                                         * carries the email
                                                         * rather than issue.id.
                                                         */
                                                        href={`/admin/users?search=${encodeURIComponent(issue.email)}`} 
                                                        className="inline-flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-800 transition-all shadow-sm"
                                                    >
                                                        <Search className="w-3.5 h-3.5" />
                                                        Verify
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
