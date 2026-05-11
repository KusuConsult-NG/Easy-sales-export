/**
 * Admin Broadcast History
 * /admin/communications/history
 *
 * Shows all past broadcasts with status, delivery stats, and message preview.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    History, ChevronLeft, Mail, Users, CheckCircle, AlertTriangle,
    Loader2, RefreshCw, Eye, ChevronDown, ChevronUp, MessageSquare, Bell,
} from "lucide-react";
import { getBroadcastHistoryAction } from "@/app/actions/broadcast";
import type { BroadcastLog, BroadcastAudience } from "@/app/actions/broadcast";
import { formatDateTime } from "@/lib/utils";

const AUDIENCE_LABELS: Record<BroadcastAudience, string> = {
    all: "All Users",
    buyers: "Buyers",
    sellers: "All Sellers",
    wholesale_sellers: "Wholesale Sellers",
    retail_sellers: "Retail Sellers",
    marketplace_onboarded: "Marketplace Users",
    cooperative_members: "Cooperative Members",
    wave_applicants: "WAVE Applicants",
    wave_briefing_registrants: "WAVE Briefing Registrants",
    academy_users: "Academy Users",
    export_users: "Export Users",
    farm_nation_users: "Farm Nation Users",
    pending_applicants: "All Pending Applicants",
    unpaid_applicants: "Unpaid Applicants",
    abandoned_failed_transactions: "Abandoned / Failed Transactions",
    stalled_users: "⚠️ Stalled Users",
    ghost_users: "👻 Ghost Users",
    pending_users: "Pending Users",
    active_users: "Active Users",
    csv_upload: "CSV Upload",
};



function StatusBadge({ status }: { status: BroadcastLog["status"] }) {
    const map = {
        done: "bg-green-100 text-green-800",
        partial: "bg-amber-100 text-amber-800",
        sending: "bg-blue-100 text-blue-800",
    };
    return (
        <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${map[status]}`}>
            {status === "done" ? "Delivered" : status === "partial" ? "Partial" : "Sending…"}
        </span>
    );
}

function LogRow({ log }: { log: BroadcastLog }) {
    const [expanded, setExpanded] = useState(false);
    const deliveryRate = log.totalRecipients > 0
        ? Math.round((log.successCount / log.totalRecipients) * 100)
        : 0;

    const isSms = log.channel === "sms";
    const isInApp = log.channel === "in-app";

    const accentIcon  = isSms ? "text-blue-700"  : isInApp ? "text-purple-700" : "text-green-700";
    const accentBg    = isSms ? "bg-blue-100"     : isInApp ? "bg-purple-100" : "bg-green-100";
    const accentBar   = isSms ? "bg-blue-500"     : isInApp ? "bg-purple-500" : "bg-green-500";
    const accentCount = isSms ? "text-blue-600"   : isInApp ? "text-purple-600" : "text-green-600";
    const channelLabel = isSms ? "📱 SMS" : isInApp ? "🔔 In-App" : "📧 Email";

    return (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-5 flex flex-col sm:flex-row sm:items-start gap-4">
                {/* Icon */}
                <div className={`w-10 h-10 rounded-xl ${accentBg} flex items-center justify-center shrink-0`}>
                    {isSms
                        ? <MessageSquare className={`w-5 h-5 ${accentIcon}`} />
                        : isInApp ? <Bell className={`w-5 h-5 ${accentIcon}`} />
                        : <Mail className={`w-5 h-5 ${accentIcon}`} />
                    }
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${isSms ? "bg-blue-100 text-blue-800" : isInApp ? "bg-purple-100 text-purple-800" : "bg-green-100 text-green-800"}`}>
                            {channelLabel}
                        </span>
                        <h3 className="font-bold text-slate-900 truncate">{log.subject}</h3>
                        <StatusBadge status={log.status} />
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {AUDIENCE_LABELS[log.audience] ?? log.audience}
                            {log.filters?.state ? ` · ${log.filters.state}` : ""}
                        </span>
                        <span>{formatDateTime(log.sentAt)}</span>
                        <span className="text-slate-400">by {log.sentByName}</span>
                    </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-5 shrink-0">
                    <div className="text-center">
                        <p className="text-xl font-bold text-slate-900">{(log.totalRecipients ?? 0).toLocaleString()}</p>
                        <p className="text-xs text-slate-500">Total</p>
                    </div>
                    <div className="text-center">
                        <p className={`text-xl font-bold ${accentCount}`}>{(log.successCount ?? 0).toLocaleString()}</p>
                        <p className="text-xs text-slate-500">Sent</p>
                    </div>
                    {log.failCount > 0 && (
                        <div className="text-center">
                            <p className="text-xl font-bold text-red-500">{(log.failCount ?? 0).toLocaleString()}</p>
                            <p className="text-xs text-slate-500">Failed</p>
                        </div>
                    )}
                    <div className="text-center">
                        <p className="text-xl font-bold text-blue-600">{deliveryRate}%</p>
                        <p className="text-xs text-slate-500">Rate</p>
                    </div>
                    <button onClick={() => setExpanded(!expanded)} className="p-2 hover:bg-slate-100 rounded-xl transition">
                        {expanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </button>
                </div>
            </div>

            {/* Delivery bar */}
            <div className="mx-5 mb-4">
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${accentBar} rounded-full`} style={{ width: `${deliveryRate}%` }} />
                </div>
            </div>

            {/* Expanded body */}
            {expanded && (
                <div className="border-t border-slate-100 px-5 py-4 bg-slate-50">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                        {isSms ? "SMS Message" : isInApp ? "In-App Notification" : "Email Body"}
                    </p>
                    <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{log.body}</pre>
                </div>
            )}
        </div>
    );
}

export default function BroadcastHistoryPage() {
    const [logs, setLogs] = useState<BroadcastLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        setError(null);
        const res = await getBroadcastHistoryAction();
        setLoading(false);
        if (!res.success) { setError(res.error || "Failed to load history"); return; }
        setLogs(res.data);
    };

     
    useEffect(() => { load(); }, []);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-5xl mx-auto px-8 py-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/admin/communications" className="p-2 rounded-xl hover:bg-slate-100 transition">
                            <ChevronLeft className="w-5 h-5 text-slate-600" />
                        </Link>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                                <History className="w-5 h-5 text-slate-600" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-slate-900">Broadcast History</h1>
                                <p className="text-sm text-slate-500">{logs.length > 0 ? `${logs.length} broadcasts logged` : "All past broadcasts"}</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={load} disabled={loading} className="p-2.5 border border-slate-300 rounded-xl hover:bg-slate-50 transition disabled:opacity-50">
                            <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? "animate-spin" : ""}`} />
                        </button>
                        <Link href="/admin/communications/broadcast"
                            className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition text-sm">
                            <Mail className="w-4 h-4" /> New Broadcast
                        </Link>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-8 py-8 space-y-4">
                {/* Loading */}
                {loading && (
                    <div className="py-20 text-center">
                        <Loader2 className="w-8 h-8 animate-spin text-slate-400 mx-auto mb-3" />
                        <p className="text-slate-500">Loading broadcast history…</p>
                    </div>
                )}

                {/* Error */}
                {!loading && error && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-red-800">Failed to load history</p>
                            <p className="text-sm text-red-600 mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {/* Empty */}
                {!loading && !error && logs.length === 0 && (
                    <div className="py-20 text-center">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                            <Mail className="w-8 h-8 text-slate-400" />
                        </div>
                        <h3 className="font-bold text-slate-900 mb-1">No broadcasts yet</h3>
                        <p className="text-slate-500 text-sm mb-6">Past broadcasts will appear here once you send one.</p>
                        <Link href="/admin/communications/broadcast"
                            className="inline-flex items-center gap-2 px-5 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition">
                            <Mail className="w-4 h-4" /> Send Your First Broadcast
                        </Link>
                    </div>
                )}

                {/* Log list */}
                {!loading && logs.map((log) => <LogRow key={log.id} log={log} />)}

                {/* Summary footer */}
                {!loading && logs.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <div className="grid grid-cols-3 divide-x divide-slate-200 text-center">
                            <div className="px-4">
                                <p className="text-2xl font-bold text-slate-900">{logs.length}</p>
                                <p className="text-sm text-slate-500">Total Broadcasts</p>
                            </div>
                            <div className="px-4">
                                <p className="text-2xl font-bold text-green-600">
                                    {logs.reduce((acc, l) => acc + l.successCount, 0).toLocaleString()}
                                </p>
                                <p className="text-sm text-slate-500">Messages Delivered</p>
                            </div>
                            <div className="px-4">
                                <p className="text-2xl font-bold text-slate-900">
                                    {logs.reduce((acc, l) => acc + l.totalRecipients, 0).toLocaleString()}
                                </p>
                                <p className="text-sm text-slate-500">Total Recipients</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
