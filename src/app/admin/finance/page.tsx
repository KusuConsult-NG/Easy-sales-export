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
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, query, limit, Timestamp } from "firebase/firestore";

// ─── Types ─────────────────────────────────────────────────────────────────
interface Transaction {
    id: string;
    type: string;
    amount: number;
    status: string;
    reference: string | null;
    timestamp: string | null;
}

interface FailedTransaction {
    id: string;
    type: string;
    amount: number;
    status: "failed" | "abandoned";
    gatewayResponse: string | null;
    timestamp: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function toIso(ts: any): string | null {
    if (!ts) return null;
    if (ts instanceof Timestamp) return ts.toDate().toISOString();
    if (ts?.toDate) return ts.toDate().toISOString();
    if (typeof ts === "string") return ts;
    return new Date(ts).toISOString();
}

function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" });
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
    const [activeTab, setActiveTab] = useState<"successful" | "failed" | "abandoned">("successful");

    // ── Real-time listener: processedPayments (all successful Paystack payments)
    useEffect(() => {
        // No orderBy — sorting in-memory to avoid dropping docs without that field index
        const q = query(
            collection(db, "processedPayments"),
            limit(500)
        );
        const unsub = onSnapshot(q, (snap) => {
            const txs: Transaction[] = snap.docs.map(doc => {
                const d = doc.data();
                const ts = d.processedAt ?? d.createdAt ?? d.timestamp ?? null;
                return {
                    id: doc.id,
                    type: d.type ?? "payment",
                    amount: Number(d.amount) || 0,
                    status: d.status ?? "completed",
                    reference: d.reference ?? doc.id,
                    timestamp: toIso(ts),
                };
            }).filter(t => t.amount > 0)
              .sort((a, b) => {
                  const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                  const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                  return tb - ta;
              });
            setTransactions(txs);
            setTotalRevenue(txs.reduce((sum, t) => sum + t.amount, 0));
        }, () => {
            // Silently handle permission errors - show what we have
        });
        return () => unsub();
    }, []);

    // ── Real-time listener: failedPayments (failed + abandoned)
    useEffect(() => {
        const q = query(
            collection(db, "failedPayments"),
            limit(500)
        );
        const unsub = onSnapshot(q, (snap) => {
            const txs: FailedTransaction[] = snap.docs.map(doc => {
                const d = doc.data();
                const ts = d.failedAt ?? d.abandonedAt ?? null;
                return {
                    id: doc.id,
                    type: d.type ?? "unknown",
                    amount: Number(d.amount) || 0,
                    status: (d.status === "abandoned" ? "abandoned" : "failed") as "failed" | "abandoned",
                    gatewayResponse: d.gatewayResponse ?? null,
                    timestamp: toIso(ts),
                };
            }).sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return tb - ta;
            });
            setFailedTx(txs);
        }, () => {
            // Silently handle — collection may not exist yet (no failed payments)
        });
        return () => unsub();
    }, []);

    const abandonedTx = failedTx.filter(t => t.status === "abandoned");
    const errorTx = failedTx.filter(t => t.status === "failed");

    const displayedTx =
        activeTab === "successful" ? transactions :
        activeTab === "abandoned" ? abandonedTx :
        errorTx;

    function exportCsv() {
        const rows = displayedTx.map(t => [
            t.id,
            typeLabel(t.type),
            t.amount.toString(),
            fmtDate(t.timestamp),
            (t as any).status ?? activeTab,
            (t as any).gatewayResponse ?? "",
        ]);
        const csv = [["ID", "Type", "Amount (NGN)", "Date", "Status", "Reason"], ...rows]
            .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
            .join("\n");
        const a = Object.assign(document.createElement("a"), {
            href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
            download: `transactions-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`,
        });
        a.click();
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
                        {/* Live indicator */}
                        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2">
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-sm font-semibold text-green-700">Live</span>
                        </div>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-6 shadow-lg text-white">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                <DollarSign className="w-5 h-5" />
                            </div>
                            <p className="text-sm font-medium opacity-90">Total Revenue</p>
                        </div>
                        <p className="text-3xl font-bold">{formatCurrency(totalRevenue)}</p>
                        <p className="text-xs opacity-75 mt-1">{transactions.length} successful payments</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                                <CheckCircle className="w-5 h-5 text-green-600" />
                            </div>
                            <p className="text-sm text-slate-600">Successful</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">{transactions.length}</p>
                        <p className="text-xs text-slate-500 mt-1">Confirmed payments</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-yellow-100 rounded-xl flex items-center justify-center">
                                <Clock className="w-5 h-5 text-yellow-600" />
                            </div>
                            <p className="text-sm text-slate-600">Abandoned</p>
                        </div>
                        <p className="text-3xl font-bold text-yellow-600">{abandonedTx.length}</p>
                        <p className="text-xs text-slate-500 mt-1">Left checkout</p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                                <XCircle className="w-5 h-5 text-red-600" />
                            </div>
                            <p className="text-sm text-slate-600">Failed</p>
                        </div>
                        <p className="text-3xl font-bold text-red-600">{errorTx.length}</p>
                        <p className="text-xs text-slate-500 mt-1">Card / network errors</p>
                    </div>
                </div>

                {/* Tabs + Table */}
                <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8">
                    <div className="p-6 border-b border-slate-200 flex items-center justify-between flex-wrap gap-4">
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
                                    ({tab === "successful" ? transactions.length : tab === "abandoned" ? abandonedTx.length : errorTx.length})
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={exportCsv}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition"
                        >
                            <Download className="w-4 h-4" />
                            Export CSV
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Type</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Amount</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Date</th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                        {activeTab === "successful" ? "Status" : "Reason"}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {displayedTx.map((tx, i) => {
                                    const isFailed = activeTab !== "successful";
                                    const failed = tx as FailedTransaction;
                                    return (
                                        <tr key={tx.id || i} className="hover:bg-slate-50 transition">
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
                                                <p className="text-sm text-slate-600">{fmtDate(tx.timestamp)}</p>
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
