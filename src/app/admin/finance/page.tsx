"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    DollarSign,
    TrendingUp,
    TrendingDown,
    Wallet,
    ArrowLeft,
    Download,
    AlertCircle,
    CheckCircle,
    XCircle,
    Clock,
    ChevronDown,
    Mail,
    Loader2,
    RefreshCw,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
// Timestamp is used only for an instanceof check. Imported from
// firestore-compat so this page no longer pulls in the browser database client.
import { Timestamp } from "@/lib/firestore-compat";
import { getFinancialOverviewAction } from "@/app/actions/admin-analytics";
import { recordExport } from "@/lib/record-export";

// ─── Types ─────────────────────────────────────────────────────────────────
interface Transaction {
    id: string;
    type: string;
    amount: number;
    status: string;
    reference: string | null;
    timestamp: string | null;
    phone?: string | null;
}

interface FailedTransaction {
    id: string;
    type: string;
    amount: number;
    status: "failed" | "abandoned";
    gatewayResponse: string | null;
    timestamp: string | null;
    phone?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function toIso(ts: any): string | null {
    if (!ts) return null;
    if (ts instanceof Timestamp) return ts.toDate().toISOString();
    if (ts?.toDate) return ts.toDate().toISOString();
    if (typeof ts === "string") return ts;
    return new Date(ts).toISOString();
}

function fmtDateTime(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-NG", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function typeLabel(raw: string | null | undefined): string {
    if (!raw) return "Payment";
    return raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function AdminFinancePage() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [failedTx, setFailedTx] = useState<FailedTransaction[]>([]);
    const [totalRevenue, setTotalRevenue] = useState(0);
    const [totalSuccessfulCount, setTotalSuccessfulCount] = useState<number | null>(null);
    const [totalAbandonedCount, setTotalAbandonedCount] = useState<number | null>(null);
    const [totalFailedCount, setTotalFailedCount] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<"successful" | "failed" | "abandoned">("successful");
    const [visibleCount, setVisibleCount] = useState(50);
    const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
    const [isSending, setIsSending] = useState(false);
    const [sendResult, setSendResult] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<string | null>(null);
    const [lastSynced, setLastSynced] = useState<string | null>(null);

    // Reset pagination + selection when switching tabs
    useEffect(() => {
        setVisibleCount(50);
        setSelectedRefs(new Set());
        setSendResult(null);
    }, [activeTab]);

    // ── Auto-sync on page load — silently back-fills any Paystack txs missing from Firestore
    // The Firestore real-time listeners above pick up the new docs automatically.
    useEffect(() => {
        handlePaystackSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [loading, setLoading] = useState(true);

    async function loadFinanceData(silent = false) {
        if (!silent) setLoading(true);
        const res = await getFinancialOverviewAction();
        if (res.success && res.recentTransactions) {
            setTotalRevenue(res.totalRevenue ?? 0);
            setTransactions(res.recentTransactions as Transaction[]);
            setFailedTx(res.failedTransactions as FailedTransaction[]);
            setTotalSuccessfulCount(res.totalSuccessfulCount ?? null);
            setTotalAbandonedCount(res.totalAbandonedCount ?? null);
            setTotalFailedCount(res.totalFailedCount ?? null);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadFinanceData();
    }, []);

    const abandonedTx = failedTx.filter(t => t.status === "abandoned");
    const errorTx = failedTx.filter(t => t.status === "failed");

    const displayedTx =
        activeTab === "successful" ? transactions :
        activeTab === "abandoned" ? abandonedTx :
        errorTx;

    // Slice for rendering — full array used for CSV export
    const visibleTx = displayedTx.slice(0, visibleCount);
    const hasMore = visibleCount < displayedTx.length;
    const isRecoveryTab = activeTab !== "successful";

    // ── Selection helpers ────────────────────────────────────────────────────
    const toggleSelect = (id: string) => {
        setSelectedRefs(prev => {
            const next = new Set(prev);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };
    function toggleSelectAll() {
        if (selectedRefs.size === visibleTx.length) {
            setSelectedRefs(new Set());
        } else {
            setSelectedRefs(new Set(visibleTx.map(t => t.id)));
        }
    };

    // ── Recovery email handler ───────────────────────────────────────────────
    async function sendRecoveryEmails() {
        if (selectedRefs.size === 0 || isSending) return;
        setIsSending(true);
        setSendResult(null);
        try {
            const res = await fetch("/api/admin/finance/recovery-emails", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ references: Array.from(selectedRefs) }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed");
            setSendResult(`✓ ${data.sent} sent, ${data.skipped} skipped (no email), ${data.errors} errors`);
            setSelectedRefs(new Set());
        } catch (err: any) {
            setSendResult(`✗ Error: ${err.message}`);
        } finally {
            setIsSending(false);
        }
    };

    async function handlePaystackSync(silent = false) {
        if (isSyncing) return;
        setIsSyncing(true);
        if (!silent) setSyncResult(null);
        try {
            const res = await fetch("/api/admin/finance/paystack-sync");
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || "Sync failed");
            const now = new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
            setLastSynced(now);
            if (!silent) {
                const msg = data.synced > 0
                    ? `✓ Synced ${data.synced} new transaction${data.synced !== 1 ? 's' : ''} from Paystack (success: ${data.breakdown?.success ?? "?"}, failed: ${data.breakdown?.failed ?? "?"}, abandoned: ${data.breakdown?.abandoned ?? "?"})`
                    : `✓ All Paystack transactions are up to date`;
                setSyncResult(msg);
            }
        } catch (err: any) {
            if (!silent) setSyncResult(`✗ Sync error: ${err.message}`);
        } finally {
            setIsSyncing(false);
            // Always reload finance data after sync — counts + tables reflect the latest Firestore state
            // without requiring a manual page refresh.
            await loadFinanceData(true);
        }
    }

    function exportCsv() {
        const rows = displayedTx.map(t => [
            t.id,
            typeLabel(t.type),
            t.amount.toString(),
            fmtDateTime(t.timestamp),
            (t as any).phone ?? "",
            (t as any).status ?? activeTab,
            (t as any).gatewayResponse ?? "",
        ]);
        const csv = [["ID", "Type", "Amount (NGN)", "Date & Time", "Phone", "Status", "Reason"], ...rows]
            .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
            .join("\n");
        const a = Object.assign(document.createElement("a"), {
            href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
            download: `transactions-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`,
        });
        a.click();
        // #309 The download is recorded. This screen exports the finance
        // transaction list — amounts, phone numbers and reasons — and left no
        // trace at all. recordExport never throws and never blocks.
        recordExport("finance_report", { count: rows.length, filters: { tab: activeTab } });
    }

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <Link href="/admin" className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition">
                        <ArrowLeft className="w-4 h-4" />
                        Back to Admin Dashboard
                    </Link>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-4xl font-bold text-slate-900 mb-2">Financial Dashboard</h1>
                            <p className="text-slate-600">Live data — updates automatically</p>
                        </div>
                        {/* Live indicator (now static loaded) */}
                        <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2">
                            <span className="text-sm font-semibold text-slate-700">Financial Suite</span>
                        </div>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                    <div className="bg-linear-to-br from-green-500 to-emerald-600 rounded-2xl p-6 shadow-lg text-white">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                <DollarSign className="w-5 h-5" />
                            </div>
                            <p className="text-sm font-medium opacity-90">Total Revenue</p>
                        </div>
                        <p className="text-3xl font-bold">{formatCurrency(totalRevenue)}</p>
                        <p className="text-xs opacity-75 mt-1">{totalSuccessfulCount ?? transactions.length} successful payments</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                                <CheckCircle className="w-5 h-5 text-green-600" />
                            </div>
                            <p className="text-sm text-slate-600">Successful</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">{totalSuccessfulCount ?? transactions.length}</p>
                        <p className="text-xs text-slate-500 mt-1">Confirmed payments</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                                <Clock className="w-5 h-5 text-yellow-600" />
                            </div>
                            <p className="text-sm text-slate-600">Abandoned</p>
                        </div>
                        <p className="text-3xl font-bold text-yellow-600">{totalAbandonedCount ?? abandonedTx.length}</p>
                        <p className="text-xs text-slate-500 mt-1">Left checkout</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                                <XCircle className="w-5 h-5 text-red-600" />
                            </div>
                            <p className="text-sm text-slate-600">Failed</p>
                        </div>
                        <p className="text-3xl font-bold text-red-600">{totalFailedCount ?? errorTx.length}</p>
                        <p className="text-xs text-slate-500 mt-1">Card / network errors</p>
                    </div>
                </div>

                {/* Tabs + Table */}
                <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8">
                    <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex gap-2">
                                {(["successful", "abandoned", "failed"] as const).map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                                            activeTab === tab
                                                ? tab === "successful" ? "bg-green-600 text-white"
                                                : tab === "abandoned" ? "bg-yellow-500 text-white"
                                                : "bg-red-600 text-white"
                                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                        }`}
                                    >
                                        {tab.charAt(0).toUpperCase() + tab.slice(1)}&nbsp;
                                        ({tab === "successful" ? (totalSuccessfulCount ?? transactions.length) : tab === "abandoned" ? (totalAbandonedCount ?? abandonedTx.length) : (totalFailedCount ?? errorTx.length)})
                                    </button>
                                ))}
                            </div>
                            {isRecoveryTab && visibleTx.length > 0 && (
                                <button
                                    onClick={toggleSelectAll}
                                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2 transition"
                                >
                                    {selectedRefs.size === visibleTx.length ? "Deselect all" : `Select all ${visibleTx.length}`}
                                </button>
                            )}
                        </div>
                        {/* Temporarily removed Export CSV button */}
                        {/* <button
                            onClick={exportCsv}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition"
                        >
                            <Download className="w-4 h-4" />
                            Export CSV
                        </button> */}
                        <div className="flex items-center gap-2">
                            {lastSynced && !isSyncing && (
                                <span className="text-xs text-slate-400">Synced {lastSynced}</span>
                            )}
                            <button
                                onClick={() => handlePaystackSync(false)}
                                disabled={isSyncing}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl font-semibold transition"
                                title="Re-fetch all transactions from Paystack"
                            >
                                {isSyncing
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Syncing…</>
                                    : <><RefreshCw className="w-4 h-4" /> Refresh</>}
                            </button>
                        </div>
                    </div>

                    {/* Recovery Email Action Bar */}
                    {isRecoveryTab && selectedRefs.size > 0 && (
                        <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between gap-4 flex-wrap">
                            <p className="text-sm font-semibold text-blue-800">
                                {selectedRefs.size} transaction{selectedRefs.size > 1 ? "s" : ""} selected
                            </p>
                            <div className="flex items-center gap-3">
                                {sendResult && (
                                    <p className={`text-xs font-medium ${
                                        sendResult.startsWith("✓") ? "text-green-700" : "text-red-600"
                                    }`}>{sendResult}</p>
                                )}
                                <button
                                    onClick={sendRecoveryEmails}
                                    disabled={isSending}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-semibold transition"
                                >
                                    {isSending
                                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                                        : <><Mail className="w-4 h-4" /> Send Recovery Email</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Paystack Sync Result Banner */}
                    {syncResult && (
                        <div className={`px-6 py-3 border-b flex items-center justify-between gap-4 flex-wrap ${
                            syncResult.startsWith("✓")
                                ? "bg-emerald-50 border-emerald-100"
                                : "bg-red-50 border-red-100"
                        }`}>
                            <p className={`text-sm font-semibold ${
                                syncResult.startsWith("✓") ? "text-emerald-800" : "text-red-700"
                            }`}>{syncResult}</p>
                            <button
                                onClick={() => setSyncResult(null)}
                                className="text-xs text-slate-500 hover:text-slate-700 transition"
                            >
                                Dismiss
                            </button>
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50">
                                <tr>
                                    {isRecoveryTab && (
                                        <th className="px-4 py-4 w-10"></th>
                                    )}
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Type</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Amount</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Date & Time</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        {activeTab === "successful" ? "Status" : "Reason"}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="py-12 text-center">
                                            <Loader2 className="w-8 h-8 animate-spin text-slate-300 mx-auto" />
                                            <p className="text-slate-500 mt-2">Loading transactions...</p>
                                        </td>
                                    </tr>
                                ) : visibleTx.map((tx, i) => {
                                    const isFailed = activeTab !== "successful";
                                    const failed = tx as FailedTransaction;
                                    const isChecked = selectedRefs.has(tx.id);
                                    return (
                                        <tr
                                            key={tx.id || i}
                                            onClick={() => isRecoveryTab && toggleSelect(tx.id)}
                                            className={`transition ${
                                                isRecoveryTab ? "cursor-pointer" : ""
                                            } ${
                                                isChecked ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-slate-50"
                                            }`}
                                        >
                                            {isRecoveryTab && (
                                                <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => toggleSelect(tx.id)}
                                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                                                    />
                                                </td>
                                            )}
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                                                        activeTab === "successful" ? "bg-green-100" :
                                                        activeTab === "abandoned" ? "bg-yellow-100" : "bg-red-100"
                                                    }`}>
                                                        {activeTab === "successful"
                                                            ? <CheckCircle className="w-4 h-4 text-green-600" />
                                                            : activeTab === "abandoned"
                                                            ? <Clock className="w-4 h-4 text-yellow-600" />
                                                            : <XCircle className="w-4 h-4 text-red-600" />
                                                        }
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-900">{typeLabel(tx.type)}</p>
                                                        <p className="text-xs text-slate-500">Ref: {tx.id.slice(0, 12)}…</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className={`text-sm font-bold ${
                                                    activeTab === "successful" ? "text-slate-900" :
                                                    activeTab === "abandoned" ? "text-yellow-700" : "text-red-700"
                                                }`}>
                                                    {formatCurrency(tx.amount)}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm text-slate-600">{fmtDateTime(tx.timestamp)}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                {isFailed ? (
                                                    <p className="text-xs text-slate-500 max-w-[200px]">{failed.gatewayResponse ?? "—"}</p>
                                                ) : (
                                                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                                                        Completed
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {displayedTx.length === 0 && (
                            <div className="text-center py-12">
                                <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                <p className="text-slate-500">
                                    {activeTab === "successful" ? "No transactions yet" :
                                     activeTab === "abandoned" ? "No abandoned transactions" :
                                     "No failed transactions"}
                                </p>
                            </div>
                        )}

                        {/* Load More */}
                        {hasMore && (
                            <div className="flex flex-col items-center gap-2 py-6 border-t border-slate-100">
                                <p className="text-xs text-slate-400">
                                    Showing {visibleTx.length} of {displayedTx.length.toLocaleString()} transactions
                                </p>
                                <button
                                    onClick={() => setVisibleCount(c => c + 50)}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-700 font-semibold rounded-xl shadow-sm hover:shadow transition-all"
                                >
                                    <ChevronDown className="w-4 h-4" />
                                    Load 50 more
                                </button>
                            </div>
                        )}

                        {!hasMore && displayedTx.length > 0 && (
                            <p className="text-center text-xs text-slate-400 py-4">
                                All {displayedTx.length.toLocaleString()} transactions loaded
                            </p>
                        )}
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Link href="/admin/marketplace/withdrawals" className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition flex items-center justify-between group">
                        <div>
                            <h3 className="font-bold text-slate-900 mb-1">Process Withdrawals</h3>
                            <p className="text-sm text-slate-600">Review pending requests</p>
                        </div>
                        <TrendingDown className="w-6 h-6 text-blue-600 group-hover:translate-x-1 transition" />
                    </Link>
                    <Link href="/admin/cooperatives/transactions" className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition flex items-center justify-between group">
                        <div>
                            <h3 className="font-bold text-slate-900 mb-1">Cooperative Transactions</h3>
                            <p className="text-sm text-slate-600">Member payment records</p>
                        </div>
                        <DollarSign className="w-6 h-6 text-green-600 group-hover:translate-x-1 transition" />
                    </Link>
                    <Link href="/admin/audit-logs" className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition flex items-center justify-between group">
                        <div>
                            <h3 className="font-bold text-slate-900 mb-1">Audit Logs</h3>
                            <p className="text-sm text-slate-600">Review system activity</p>
                        </div>
                        <TrendingUp className="w-6 h-6 text-purple-600 group-hover:translate-x-1 transition" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
