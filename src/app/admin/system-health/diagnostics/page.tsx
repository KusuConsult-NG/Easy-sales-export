"use client";

import { useState, useEffect } from "react";
import { Activity, ShieldCheck, Database, Server, RefreshCw, AlertTriangle, CheckCircle, XCircle, Info, Loader2 } from "lucide-react";
import { runSystemDiagnosticAction } from "@/app/actions/admin";
import { useToast } from "@/contexts/ToastContext";
import { formatDate } from "@/lib/utils";

interface DiagnosticData {
    stats: {
        totalUsers: number;
        corruptedUsers: number;
        legacyVerified: number;
        missingNames: number;
        desyncedRegistrations: number;
        orphanedApplications: number;
    };
    services: {
        redis: boolean;
        paystack: boolean;
        resend: boolean;
        firestore: boolean;
    };
    timestamp: string;
}

export default function AdminDiagnosticsPage() {
    const [data, setData] = useState<DiagnosticData | null>(null);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();

    async function fetchDiagnostics() {
        setLoading(true);
        const result = await runSystemDiagnosticAction();
        if (result.success && result.data) {
            setData(result.data as DiagnosticData);
        } else {
            showToast(result.error || "Failed to load diagnostics", "error");
        }
        setLoading(false);
    }

    useEffect(() => {
        fetchDiagnostics();
    }, []);

    const HealthCard = ({ title, status, icon: Icon, description }: { title: string; status: boolean; icon: any; description: string }) => (
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-xl ${status ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                    <Icon className="w-6 h-6" />
                </div>
                <div className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${status ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {status ? 'Healthy' : 'Down'}
                </div>
            </div>
            <h3 className="font-bold text-slate-900 mb-1">{title}</h3>
            <p className="text-sm text-slate-500">{description}</p>
        </div>
    );

    const StatRow = ({ label, value, color }: { label: string; value: number; color: string }) => (
        <div className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
            <span className="text-sm text-slate-600">{label}</span>
            <span className={`text-sm font-bold ${value > 0 ? color : 'text-slate-400'}`}>
                {value > 0 ? value : 'None'}
            </span>
        </div>
    );

    if (loading && !data) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                <p className="text-slate-500 font-medium animate-pulse">Running system-wide audit...</p>
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
                        System Health & Diagnostics
                    </h1>
                    <p className="text-slate-600">
                        Real-time data integrity audit and service status monitoring
                    </p>
                </div>
                <button
                    onClick={fetchDiagnostics}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh Audit
                </button>
            </div>

            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Service Status */}
                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <HealthCard 
                        title="Firestore Database" 
                        status={data?.services.firestore ?? false} 
                        icon={Database}
                        description="Primary data storage and user profiles"
                    />
                    <HealthCard 
                        title="Upstash Redis" 
                        status={data?.services.redis ?? false} 
                        icon={Server}
                        description="Session caching and rate limiting"
                    />
                    <HealthCard 
                        title="Paystack API" 
                        status={data?.services.paystack ?? false} 
                        icon={CheckCircle}
                        description="Payment gateway and escrow processing"
                    />
                    <HealthCard 
                        title="Resend Mail" 
                        status={data?.services.resend ?? false} 
                        icon={Info}
                        description="Email notifications and alerts"
                    />
                </div>

                {/* Integrity Report */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-6">
                        <ShieldCheck className="w-5 h-5 text-blue-600" />
                        <h2 className="font-bold text-slate-900">Integrity Report</h2>
                    </div>

                    <div className="space-y-1">
                        <StatRow label="Scanned User Profiles" value={data?.stats.totalUsers || 0} color="text-slate-900" />
                        <StatRow label="Corrupted Profiles" value={data?.stats.corruptedUsers || 0} color="text-red-600" />
                        <StatRow label="Legacy Schema (Verified)" value={data?.stats.legacyVerified || 0} color="text-amber-600" />
                        <StatRow label="Missing Required Names" value={data?.stats.missingNames || 0} color="text-red-600" />
                        <StatRow label="Desynced Registrations" value={data?.stats.desyncedRegistrations || 0} color="text-amber-600" />
                        <StatRow label="Orphaned Applications" value={data?.stats.orphanedApplications || 0} color="text-red-600" />
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-50">
                        {data?.stats.corruptedUsers === 0 ? (
                            <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl flex items-start gap-3">
                                <CheckCircle className="w-5 h-5 shrink-0" />
                                <div>
                                    <p className="text-sm font-bold">Data is Stable</p>
                                    <p className="text-xs opacity-80">No critical integrity issues detected in the sampled profiles.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-amber-50 text-amber-700 p-4 rounded-xl flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 shrink-0" />
                                <div>
                                    <p className="text-sm font-bold">Action Required</p>
                                    <p className="text-xs opacity-80">Integrity issues found. Use the CLI recovery tools to repair profiles.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Audit History / Metadata */}
                <div className="md:col-span-3 bg-slate-900 text-white p-6 rounded-2xl shadow-xl overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Activity className="w-32 h-32" />
                    </div>
                    <div className="relative z-10">
                        <h2 className="text-lg font-bold mb-2">Audit Metadata</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Last Audit Run</p>
                                <p className="text-sm font-medium">{data ? formatDate(data.timestamp) : 'Never'}</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Environment</p>
                                <p className="text-sm font-medium">Production (Vercel)</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Audit Level</p>
                                <p className="text-sm font-medium">High Assurance (Sample 100)</p>
                            </div>
                            <div>
                                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Security Status</p>
                                <p className="text-sm font-medium flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                    Active Enforcement
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
