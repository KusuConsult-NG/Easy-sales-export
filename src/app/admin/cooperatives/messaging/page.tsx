"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
    MessageSquare, Users, Search, CheckSquare, Square,
    Send, Loader2, CheckCircle, XCircle, AlertCircle,
    ChevronLeft, Filter, UserCheck, RefreshCw, X,
} from "lucide-react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import {
    getApprovedCooperativeMembersAction,
    broadcastToCooperativeMembersAction,
    type ApprovedCoopMember,
} from "@/app/actions/messages";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("en-NG", { year: "numeric", month: "short", day: "numeric" })
        .format(new Date(iso));
}

function Avatar({ name }: { name: string }) {
    const initials = name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0] || "")
        .join("")
        .toUpperCase() || "?";
    const colors = [
        "bg-purple-600", "bg-violet-600", "bg-indigo-600",
        "bg-blue-600", "bg-teal-600", "bg-emerald-600",
    ];
    const color = colors[name.charCodeAt(0) % colors.length];
    return (
        <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-white font-bold text-sm flex-shrink-0 ${color}`}>
            {initials}
        </span>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CooperativeMessagingPage() {
    const { showToast } = useToast();

    // Data
    const [members, setMembers] = useState<ApprovedCoopMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Selection
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // Filters
    const [search, setSearch] = useState("");
    const [stateFilter, setStateFilter] = useState("");

    // Compose
    const [message, setMessage] = useState("");
    const MAX_CHARS = 1000;

    // Send state
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{
        sent: number; failed: number; errors: string[];
    } | null>(null);

    // ── Load members ──────────────────────────────────────────────────────────
    const loadMembers = useCallback(async () => {
        setLoading(true);
        setError(null);
        const res = await getApprovedCooperativeMembersAction();
        if (res.success) {
            setMembers(res.data);
        } else {
            setError(res.error || "Failed to load members");
        }
        setLoading(false);
    }, []);

    useEffect(() => { loadMembers(); }, [loadMembers]);

    // ── Derived / filtered list ───────────────────────────────────────────────
    const uniqueStates = useMemo(() => {
        const states = members.map((m) => m.stateOfOrigin).filter(Boolean);
        return Array.from(new Set(states)).sort();
    }, [members]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return members.filter((m) => {
            const matchesSearch =
                !q ||
                m.fullName.toLowerCase().includes(q) ||
                m.email.toLowerCase().includes(q) ||
                m.memberNumber.toLowerCase().includes(q);
            const matchesState = !stateFilter || m.stateOfOrigin === stateFilter;
            return matchesSearch && matchesState;
        });
    }, [members, search, stateFilter]);

    // ── Selection helpers ─────────────────────────────────────────────────────
    const allFilteredSelected =
        filtered.length > 0 && filtered.every((m) => selected.has(m.uid));
    const someFilteredSelected = filtered.some((m) => selected.has(m.uid));

    const toggleAll = () => {
        if (allFilteredSelected) {
            setSelected((prev) => {
                const next = new Set(prev);
                filtered.forEach((m) => next.delete(m.uid));
                return next;
            });
        } else {
            setSelected((prev) => {
                const next = new Set(prev);
                filtered.forEach((m) => next.add(m.uid));
                return next;
            });
        }
    };

    const toggleMember = (uid: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(uid) ? next.delete(uid) : next.add(uid);
            return next;
        });
    };

    const clearSelection = () => setSelected(new Set());

    // ── Send broadcast ────────────────────────────────────────────────────────
    const handleSend = async () => {
        if (selected.size === 0) {
            showToast("Please select at least one member.", "error");
            return;
        }
        if (!message.trim()) {
            showToast("Please write a message.", "error");
            return;
        }

        setSending(true);
        setResult(null);

        const res = await broadcastToCooperativeMembersAction(
            Array.from(selected),
            message,
        );

        setSending(false);
        setResult({ sent: res.sent, failed: res.failed, errors: res.errors });

        if (res.sent > 0) {
            showToast(
                `Message sent to ${res.sent} member${res.sent !== 1 ? "s" : ""}${res.failed > 0 ? ` (${res.failed} failed)` : ""}`,
                res.failed > 0 ? "error" : "success",
            );
            setMessage("");
            clearSelection();
        } else {
            showToast(res.error || "Failed to send message.", "error");
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-slate-50">
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="bg-white border-b border-slate-200 px-6 py-4">
                <div className="max-w-7xl mx-auto flex items-center gap-4">
                    <Link
                        href="/admin/cooperatives"
                        className="p-2 rounded-lg hover:bg-slate-100 transition text-slate-500"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </Link>
                    <div className="flex-1">
                        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <MessageSquare className="w-5 h-5 text-purple-600" />
                            Message Approved Members
                        </h1>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Select approved cooperative members and send them a direct message.
                        </p>
                    </div>
                    <button
                        onClick={loadMembers}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* ── LEFT: Member Selector ─────────────────────────────── */}
                <div className="lg:col-span-3 flex flex-col gap-4">
                    {/* Stats bar */}
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { label: "Approved Members", value: members.length, icon: UserCheck, color: "text-purple-600 bg-purple-50" },
                            { label: "Showing", value: filtered.length, icon: Filter, color: "text-blue-600 bg-blue-50" },
                            { label: "Selected", value: selected.size, icon: CheckSquare, color: "text-emerald-600 bg-emerald-50" },
                        ].map(({ label, value, icon: Icon, color }) => (
                            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                                    <Icon className="w-4 h-4" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-slate-900">{value}</p>
                                    <p className="text-xs text-slate-500">{label}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Search + Filter */}
                    <div className="flex gap-3">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search by name, email or member no..."
                                className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400"
                            />
                            {search && (
                                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                        <select
                            value={stateFilter}
                            onChange={(e) => setStateFilter(e.target.value)}
                            className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 min-w-[140px]"
                        >
                            <option value="">All States</option>
                            {uniqueStates.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>

                    {/* Select-all toolbar */}
                    {filtered.length > 0 && (
                        <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
                            <button
                                onClick={toggleAll}
                                className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-purple-700 transition"
                            >
                                {allFilteredSelected ? (
                                    <CheckSquare className="w-4 h-4 text-purple-600" />
                                ) : someFilteredSelected ? (
                                    <CheckSquare className="w-4 h-4 text-purple-400" />
                                ) : (
                                    <Square className="w-4 h-4 text-slate-400" />
                                )}
                                {allFilteredSelected ? "Deselect all visible" : "Select all visible"}
                                <span className="text-slate-400 font-normal">({filtered.length})</span>
                            </button>
                            {selected.size > 0 && (
                                <button
                                    onClick={clearSelection}
                                    className="text-xs text-slate-400 hover:text-red-500 transition flex items-center gap-1"
                                >
                                    <X className="w-3 h-3" /> Clear selection
                                </button>
                            )}
                        </div>
                    )}

                    {/* Member list */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex-1">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
                                <p className="text-sm text-slate-500">Loading approved members…</p>
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3 text-red-500">
                                <AlertCircle className="w-8 h-8" />
                                <p className="text-sm">{error}</p>
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                <Users className="w-10 h-10 text-slate-300" />
                                <p className="text-sm text-slate-500">
                                    {members.length === 0
                                        ? "No approved members found."
                                        : "No members match your search."}
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
                                {filtered.map((member) => {
                                    const isSelected = selected.has(member.uid);
                                    return (
                                        <button
                                            key={member.uid}
                                            onClick={() => toggleMember(member.uid)}
                                            className={`w-full flex items-center gap-4 px-4 py-3.5 text-left transition-colors ${
                                                isSelected
                                                    ? "bg-purple-50"
                                                    : "hover:bg-slate-50"
                                            }`}
                                        >
                                            {/* Checkbox */}
                                            <div className="flex-shrink-0">
                                                {isSelected ? (
                                                    <CheckSquare className="w-4 h-4 text-purple-600" />
                                                ) : (
                                                    <Square className="w-4 h-4 text-slate-300" />
                                                )}
                                            </div>

                                            {/* Avatar */}
                                            <Avatar name={member.fullName} />

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <p className={`font-semibold text-sm truncate ${isSelected ? "text-purple-900" : "text-slate-900"}`}>
                                                    {member.fullName}
                                                </p>
                                                <p className="text-xs text-slate-500 truncate">{member.email}</p>
                                            </div>

                                            {/* Meta */}
                                            <div className="text-right hidden sm:block flex-shrink-0">
                                                <p className="text-xs font-mono text-slate-600">{member.memberNumber}</p>
                                                {member.stateOfOrigin && (
                                                    <p className="text-xs text-slate-400">{member.stateOfOrigin}</p>
                                                )}
                                            </div>

                                            {/* Status badge */}
                                            <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                                                {member.membershipStatus === "active" ? "Active" : "Approved"}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── RIGHT: Compose Panel ──────────────────────────────── */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                    {/* Selected summary */}
                    <div className={`rounded-xl border p-4 transition-colors ${
                        selected.size > 0
                            ? "bg-purple-50 border-purple-200"
                            : "bg-white border-slate-200"
                    }`}>
                        <div className="flex items-center gap-2 mb-1">
                            <Users className={`w-4 h-4 ${selected.size > 0 ? "text-purple-600" : "text-slate-400"}`} />
                            <span className="text-sm font-semibold text-slate-700">Recipients</span>
                        </div>
                        {selected.size === 0 ? (
                            <p className="text-sm text-slate-400">
                                No members selected yet. Select from the list on the left.
                            </p>
                        ) : (
                            <>
                                <p className="text-2xl font-bold text-purple-700">
                                    {selected.size}
                                    <span className="text-sm font-normal text-purple-500 ml-1">
                                        member{selected.size !== 1 ? "s" : ""} selected
                                    </span>
                                </p>
                                {/* Preview chips — show first 5 */}
                                <div className="mt-2 flex flex-wrap gap-1">
                                    {Array.from(selected).slice(0, 5).map((uid) => {
                                        const m = members.find((x) => x.uid === uid);
                                        return m ? (
                                            <span
                                                key={uid}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-800 text-xs rounded-full"
                                            >
                                                {m.fullName.split(" ")[0]}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); toggleMember(uid); }}
                                                    className="hover:text-red-500"
                                                >
                                                    <X className="w-2.5 h-2.5" />
                                                </button>
                                            </span>
                                        ) : null;
                                    })}
                                    {selected.size > 5 && (
                                        <span className="px-2 py-0.5 bg-purple-100 text-purple-600 text-xs rounded-full">
                                            +{selected.size - 5} more
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Message compose */}
                    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
                        <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-purple-500" />
                            Compose Message
                        </label>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value.slice(0, MAX_CHARS))}
                            placeholder="Type your message to the selected members…"
                            rows={8}
                            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400 text-slate-800 placeholder:text-slate-400"
                        />
                        <div className="flex justify-between items-center text-xs text-slate-400">
                            <span>
                                {message.length > 0 && (
                                    <span className={message.length > MAX_CHARS * 0.9 ? "text-amber-500" : ""}>
                                        {message.length}/{MAX_CHARS}
                                    </span>
                                )}
                            </span>
                            <span>Each member receives an individual message</span>
                        </div>
                    </div>

                    {/* Send button */}
                    <button
                        onClick={handleSend}
                        disabled={sending || selected.size === 0 || !message.trim()}
                        className="flex items-center justify-center gap-2.5 w-full py-3.5 px-6 rounded-xl font-semibold text-white bg-purple-700 hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
                    >
                        {sending ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Sending to {selected.size} member{selected.size !== 1 ? "s" : ""}…
                            </>
                        ) : (
                            <>
                                <Send className="w-4 h-4" />
                                Send to {selected.size > 0 ? `${selected.size} member${selected.size !== 1 ? "s" : ""}` : "members"}
                            </>
                        )}
                    </button>

                    {/* Result summary */}
                    {result && (
                        <div className={`rounded-xl border p-4 ${
                            result.failed === 0
                                ? "bg-emerald-50 border-emerald-200"
                                : result.sent === 0
                                    ? "bg-red-50 border-red-200"
                                    : "bg-amber-50 border-amber-200"
                        }`}>
                            <div className="flex items-start gap-3">
                                {result.failed === 0 ? (
                                    <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                                ) : result.sent === 0 ? (
                                    <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                                ) : (
                                    <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                                )}
                                <div className="text-sm">
                                    <p className="font-semibold text-slate-800">
                                        {result.failed === 0
                                            ? `Successfully sent to ${result.sent} member${result.sent !== 1 ? "s" : ""}`
                                            : result.sent === 0
                                                ? "All messages failed to send"
                                                : `Sent: ${result.sent} · Failed: ${result.failed}`}
                                    </p>
                                    {result.errors.length > 0 && (
                                        <ul className="mt-1 text-xs text-red-600 space-y-0.5">
                                            {result.errors.slice(0, 3).map((e, i) => (
                                                <li key={i}>{e}</li>
                                            ))}
                                            {result.errors.length > 3 && (
                                                <li>…and {result.errors.length - 3} more</li>
                                            )}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Info note */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
                        <p className="font-medium text-slate-600">ℹ️ How it works</p>
                        <p>Each selected member receives the message in their personal inbox (Messages tab). It will appear as a direct message from you.</p>
                        <p>Only members with <strong>approved</strong> or <strong>active</strong> status are shown here.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
