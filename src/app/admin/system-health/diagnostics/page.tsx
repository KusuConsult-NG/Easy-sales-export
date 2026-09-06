"use client";

/**
 *   #440 EVERY ELEMENT ON THIS SCREEN WAS DECORATIVE.
 *
 * It rendered four green "Healthy" cards from `{ redis: true, paystack: true,
 * resend: true, firestore: true }` — four constants in the action, not four
 * checks — plus six integrity counts from six hardcoded zeros, under the
 * heading "Real-time data integrity audit and service status monitoring".
 *
 * The footer was worse, because it was specific:
 *
 *     Environment       "Production (Vercel)"         deploys on Railway, and
 *                                                     said Production anywhere
 *     Audit Level       "High Assurance (Sample 100)" nothing sampled anything
 *     Security Status   ● "Active Enforcement"        a pulsing green light
 *                                                     wired to nothing
 *     Data is Stable    "no critical integrity        nothing was inspected
 *                        issues in the sampled
 *                        profiles"
 *
 * This is the screen an operator opens when they suspect the platform is
 * broken, and it answered "everything is fine" before asking. #313's lesson —
 * "we could not check" must never render as "nothing found" — applies here more
 * than anywhere.
 *
 * AND THE REAL SCREEN WAS ONE DIRECTORY UP. /admin/system-health renders
 * `runSystemHealthDiagnostic`, which scans user profiles, probes Redis, counts
 * orphaned WAVE applications and reads the feature toggles. This page carried
 * that report's field names with the work removed. The action behind it
 * delegates to the real one now, so there is ONE implementation, and this page
 * shows what it returned.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Activity, ShieldCheck, Database, Server, RefreshCw, AlertTriangle, CheckCircle, XCircle, CreditCard, Mail, Loader2, ArrowRight } from "lucide-react";
import { runSystemDiagnosticAction } from "@/app/actions/admin";
import type { HealthReport } from "@/app/actions/health";
import { useToast } from "@/contexts/ToastContext";
import { formatDate } from "@/lib/utils";

/**
 * A dependency card.
 *
 * `probed` separates "we asked it and it answered" from "the environment
 * variable is set". Both are true statements; showing the same green tick for
 * each is how a configuration check gets read as a reachability check, and this
 * screen's whole defect was a tick that meant nothing at all.
 */
const HealthCard = ({ title, ok, probed, icon: Icon, description }: {
    title: string;
    ok: boolean | undefined;
    probed: boolean;
    icon: any;
    description: string;
}) => {
    // No answer is its own state. Rendering "Healthy" for a service the action
    // never reported on is the defect being repaired.
    if (ok === undefined) {
        return (
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex items-start justify-between mb-4">
                    <div className="p-3 rounded-xl bg-slate-100 text-slate-400"><Icon className="w-6 h-6" /></div>
                    <div className="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-500">
                        Not checked
                    </div>
                </div>
                <h3 className="font-bold text-slate-900 mb-1">{title}</h3>
                <p className="text-sm text-slate-500">{description}</p>
            </div>
        );
    }

    const label = ok ? (probed ? "Responding" : "Configured") : (probed ? "Unreachable" : "Not configured");
    return (
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-xl ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                    <Icon className="w-6 h-6" />
                </div>
                <div className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {label}
                </div>
            </div>
            <h3 className="font-bold text-slate-900 mb-1">{title}</h3>
            <p className="text-sm text-slate-500">{description}</p>
            {!probed && (
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Key is set — reachability not checked
                </p>
            )}
        </div>
    );
};

export default function AdminDiagnosticsPage() {
    const [data, setData] = useState<HealthReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();

    const fetchDiagnostics = useCallback(async () => {
        setLoading(true);
        const result = await runSystemDiagnosticAction();
        if (result.success && result.data) {
            setData(result.data as HealthReport);
            setError(null);
        } else {
            // A failed run REPLACES the result rather than emptying it (#307),
            // and is shown as a failure rather than as a clean bill of health.
            setError(result.error || "Failed to load diagnostics");
            showToast(result.error || "Failed to load diagnostics", "error");
        }
        setLoading(false);
    }, [showToast]);

    useEffect(() => {
        fetchDiagnostics();
    }, [fetchDiagnostics]);

    if (loading && !data && !error) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                <p className="text-slate-500 font-medium animate-pulse">Running the system health check...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
            {/* Header */}
            <div className="max-w-6xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2 flex items-center gap-3">
                        <Activity className="w-8 h-8 text-blue-600" />
                        System Health
                    </h1>
                    <p className="text-slate-600">
                        Dependency status and profile anomalies, checked when this page loads.
                    </p>
                </div>
                <button
                    onClick={fetchDiagnostics}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Check again
                </button>
            </div>

            {error && (
                <div className="max-w-6xl mx-auto mb-6 bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <div>
                        <p className="text-sm font-bold">The check did not run</p>
                        <p className="text-xs opacity-90">{error}</p>
                    </div>
                </div>
            )}

            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Dependencies */}
                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <HealthCard
                        title="Database"
                        ok={data?.services.firestore}
                        probed
                        icon={Database}
                        description="Answered a bounded one-row read"
                    />
                    <HealthCard
                        title="Upstash Redis"
                        ok={data?.services.redis}
                        probed
                        icon={Server}
                        description="Session caching and rate limiting"
                    />
                    <HealthCard
                        title="Paystack"
                        ok={data?.services.paystack}
                        probed={false}
                        icon={CreditCard}
                        description="Payment gateway and escrow processing"
                    />
                    <HealthCard
                        title="Resend"
                        ok={data?.services.resend}
                        probed={false}
                        icon={Mail}
                        description="Email notifications and alerts"
                    />
                </div>

                {/* Profile anomalies — the figures the scan really produced */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col">
                    <div className="flex items-center gap-2 mb-4">
                        <ShieldCheck className="w-5 h-5 text-blue-600" />
                        <h2 className="font-bold text-slate-900">Profile anomalies</h2>
                    </div>

                    <div className="space-y-3 mb-6">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">Profiles scanned</span>
                            <span className="text-sm font-bold text-slate-900">{data ? data.totalScanned : '—'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">Anomalies found</span>
                            <span className={`text-sm font-bold ${data && data.anomaliesFound > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                                {data ? data.anomaliesFound : '—'}
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-600">Orphaned applications</span>
                            <span className={`text-sm font-bold ${data && data.stats.orphanedApplications > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                {data ? data.stats.orphanedApplications : '—'}
                            </span>
                        </div>
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed mb-4">
                        This page checks dependencies and user profiles. The
                        cross-module integrity scan reads eight collections and
                        reports each check as pass, fail, warning or
                        inconclusive.
                    </p>
                    <Link
                        href="/admin/forensics"
                        className="mt-auto inline-flex items-center justify-between gap-2 px-4 py-3 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition"
                    >
                        Run the forensic scan
                        <ArrowRight className="w-4 h-4 shrink-0" />
                    </Link>
                </div>

                {/*
                  * #441. Weak or missing production secrets.
                  *
                  * validateProductionSecrets has always found these and has
                  * always written them to a console.error nobody reads. This is
                  * the first reader they have ever had.
                  *
                  * Rendered only when there is something to say: an empty list
                  * in development means "the check does not run here", not "the
                  * secrets are strong", and a green tick for that would be the
                  * same lie #440 removed from this page.
                  */}
                {data && data.secretWeaknesses.length > 0 && (
                    <div className="md:col-span-3 bg-red-50 border border-red-200 p-6 rounded-2xl">
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle className="w-5 h-5 text-red-600" />
                            <h2 className="font-bold text-red-900">Weak or missing production secrets</h2>
                        </div>
                        <ul className="space-y-1.5">
                            {data.secretWeaknesses.map((weakness) => (
                                <li key={weakness} className="text-sm text-red-800">• {weakness}</li>
                            ))}
                        </ul>
                        <p className="mt-4 text-xs text-red-700">
                            Generate replacements with <code className="font-mono">openssl rand -base64 48</code> and
                            set them in the deployment environment.
                        </p>
                    </div>
                )}

                {/* Summary — every figure below is one this page actually has */}
                <div className="md:col-span-3 bg-slate-900 text-white p-6 rounded-2xl shadow-xl overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Activity className="w-32 h-32" />
                    </div>
                    <div className="relative z-10">
                        <h2 className="text-lg font-bold mb-4">Summary</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Last checked</p>
                                <p className="text-sm font-medium">{data ? formatDate(data.timestamp) : 'Not yet'}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Profiles scanned</p>
                                <p className="text-sm font-medium">{data ? data.totalScanned : '—'}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Dependencies down</p>
                                <p className="text-sm font-medium flex items-center gap-1.5">
                                    {data ? (
                                        <>
                                            <span className={`w-2 h-2 rounded-full ${Object.values(data.services).some((s) => !s) ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                                            {Object.values(data.services).filter((s) => !s).length}
                                        </>
                                    ) : (
                                        <>
                                            <span className="w-2 h-2 rounded-full bg-slate-500" />
                                            —
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
