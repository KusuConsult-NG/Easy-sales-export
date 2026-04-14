"use client";

import { useState, useEffect, useCallback } from "react";
import {
    MessageCircle, Users, AlertTriangle, CheckCircle2,
    Loader2, RefreshCw, Filter, Eye, TrendingUp,
} from "lucide-react";
import Link from "next/link";
import {
    getChatSessionsAction,
    getChatbotStatsAction,
    type ChatSessionsResult,
} from "@/app/actions/chatbot-admin";
import { MODULE_CONFIGS, type ChatbotModule } from "@/lib/chatbot-knowledge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MODULE_OPTIONS: { value: string; label: string }[] = [
    { value: "", label: "All Modules" },
    { value: "hub", label: "Hub" },
    { value: "marketplace", label: "Marketplace" },
    { value: "cooperative", label: "Cooperative" },
    { value: "export", label: "Export" },
    { value: "academy", label: "Academy" },
    { value: "wave", label: "WAVE" },
    { value: "farm-nation", label: "Farm Nation" },
];

function ModuleBadge({ module }: { module: ChatbotModule }) {
    const cfg = MODULE_CONFIGS[module];
    return (
        <span
            className="px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
            style={{ backgroundColor: cfg.accentColor }}
        >
            {cfg.name.replace(" Assistant", "")}
        </span>
    );
}

export default function AdminChatbotPage() {
    const [loading, setLoading] = useState(true);
    const [sessions, setSessions] = useState<ChatSessionsResult["sessions"]>([]);
    const [stats, setStats] = useState<{
        totalSessions: number; escalatedUnresolved: number;
        resolvedToday: number; mostActiveModule: ChatbotModule | null;
    } | null>(null);
    const [filterModule, setFilterModule] = useState("");
    const [filterEscalated, setFilterEscalated] = useState(false);
    const [filterUnresolved, setFilterUnresolved] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [lastId, setLastId] = useState<string | undefined>();

    const load = useCallback(async (reset = true) => {
        setLoading(true);
        try {
            const [sessionsRes, statsRes] = await Promise.all([
                getChatSessionsAction({
                    module: filterModule as ChatbotModule || undefined,
                    escalatedOnly: filterEscalated || undefined,
                    unresolvedOnly: filterUnresolved || undefined,
                    limit: 25,
                    startAfter: reset ? undefined : lastId,
                }),
                reset ? getChatbotStatsAction() : Promise.resolve(null),
            ]);

            if (reset) {
                setSessions(sessionsRes.sessions);
                if (statsRes) setStats(statsRes);
            } else {
                setSessions(prev => [...prev, ...sessionsRes.sessions]);
            }
            setHasMore(sessionsRes.hasMore ?? false);
            if (sessionsRes.sessions.length > 0) {
                setLastId(sessionsRes.sessions[sessionsRes.sessions.length - 1].id);
            }

            if (sessionsRes.error) toast.error(sessionsRes.error);
        } catch {
            toast.error("Failed to load chatbot sessions");
        } finally {
            setLoading(false);
        }
    }, [filterModule, filterEscalated, filterUnresolved, lastId]);

    useEffect(() => { load(true); }, [filterModule, filterEscalated, filterUnresolved]); // eslint-disable-line

    const statCards = [
        {
            label: "Total Sessions",
            value: stats?.totalSessions ?? "—",
            icon: MessageCircle,
            color: "text-blue-600",
            bg: "bg-blue-50",
        },
        {
            label: "Escalated & Unresolved",
            value: stats?.escalatedUnresolved ?? "—",
            icon: AlertTriangle,
            color: "text-amber-600",
            bg: "bg-amber-50",
        },
        {
            label: "Resolved Today",
            value: stats?.resolvedToday ?? "—",
            icon: CheckCircle2,
            color: "text-green-600",
            bg: "bg-green-50",
        },
        {
            label: "Most Active Module",
            value: stats?.mostActiveModule
                ? MODULE_CONFIGS[stats.mostActiveModule].name.replace(" Assistant", "")
                : "—",
            icon: TrendingUp,
            color: "text-purple-600",
            bg: "bg-purple-50",
        },
    ];

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <MessageCircle className="w-6 h-6 text-green-600" />
                        AI Chatbot — Admin Console
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Monitor conversations, escalations, and resolve support threads.
                    </p>
                </div>
                <button
                    onClick={() => load(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                    <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                    Refresh
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map(card => (
                    <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-3", card.bg)}>
                            <card.icon className={cn("w-5 h-5", card.color)} />
                        </div>
                        <p className="text-2xl font-bold text-slate-900">{card.value}</p>
                        <p className="text-xs text-slate-500 mt-1">{card.label}</p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <select
                        value={filterModule}
                        onChange={e => setFilterModule(e.target.value)}
                        className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 outline-none focus:ring-2 focus:ring-green-500/30"
                    >
                        {MODULE_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={filterEscalated}
                            onChange={e => setFilterEscalated(e.target.checked)}
                            className="rounded accent-amber-500"
                        />
                        Escalated only
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={filterUnresolved}
                            onChange={e => setFilterUnresolved(e.target.checked)}
                            className="rounded accent-red-500"
                        />
                        Unresolved only
                    </label>
                </div>
            </div>

            {/* Sessions Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {loading && sessions.length === 0 ? (
                    <div className="flex items-center justify-center h-48">
                        <Loader2 className="w-8 h-8 animate-spin text-green-600" />
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                        <Users className="w-12 h-12 mb-3 opacity-30" />
                        <p className="text-sm">No sessions found with current filters.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {["User", "Module", "Messages", "Last Active", "Status", "Action"].map(h => (
                                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sessions.map(session => (
                                    <tr key={session.id} className="hover:bg-slate-50/60 transition-colors">
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-slate-900 truncate max-w-[160px]">{session.userEmail}</p>
                                            <p className="text-xs text-slate-400 font-mono">{session.id.slice(0, 8)}…</p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <ModuleBadge module={session.module} />
                                        </td>
                                        <td className="px-4 py-3 text-slate-600">
                                            {session.messageCount}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                                            {session.lastMessageAt.toLocaleString("en-NG", {
                                                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
                                            })}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col gap-1">
                                                {session.escalated && (
                                                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                                        <AlertTriangle className="w-3 h-3" /> Escalated
                                                    </span>
                                                )}
                                                {session.resolved ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                                                        <CheckCircle2 className="w-3 h-3" /> Resolved
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                                        Open
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Link
                                                href={`/admin/chatbot/${session.id}`}
                                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                                            >
                                                <Eye className="w-3.5 h-3.5" /> View
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {hasMore && (
                            <div className="flex justify-center border-t border-slate-100 p-4">
                                <button
                                    onClick={() => load(false)}
                                    disabled={loading}
                                    className="text-sm text-blue-600 hover:underline disabled:opacity-50"
                                >
                                    {loading ? "Loading…" : "Load more"}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
