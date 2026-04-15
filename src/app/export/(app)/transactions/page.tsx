"use client";

import { useState, useEffect } from "react";
import { Calendar, ArrowDownCircle, ArrowUpCircle, Clock, Loader2, AlertCircle } from "lucide-react";
import { getMyExportInvestmentsAction } from "@/app/actions/export";

interface TransactionRow {
    id: string;
    type: "investment" | "return";
    description: string;
    amount: number;
    status: "completed" | "pending" | "active";
    date: Date | null;
}

export default function ExportTransactionsPage() {
    const [transactions, setTransactions] = useState<TransactionRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getMyExportInvestmentsAction().then((result) => {
            if (result.success ) {
                // Each slot = one investment transaction + one pending return
                const rows: TransactionRow[] = [];
                for (const inv of (result.data || []) as any[]) {
                    rows.push({
                        id: `inv-${inv.id}`,
                        type: "investment",
                        description: `Investment — ${inv.windowTitle || "Export Window"}`,
                        amount: -(inv.amount || 0),
                        status: "completed",
                        date: inv.purchaseDate || inv.createdAt,
                    });
                    rows.push({
                        id: `ret-${inv.id}`,
                        type: "return",
                        description: `Expected Return — ${inv.windowTitle || "Export Window"}`,
                        amount: inv.expectedReturn || 0,
                        status: inv.status === "completed" ? "completed" : "pending",
                        date: null,
                    });
                }
                // Sort: most recent first, pending returns last
                rows.sort((a, b) => {
                    if (!a.date && !b.date) return 0;
                    if (!a.date) return 1;
                    if (!b.date) return -1;
                    return new Date(b.date).getTime() - new Date(a.date).getTime();
                });
                setTransactions(rows);
            }
            setLoading(false);
        });
    }, []);

    const getIcon = (type: string) => {
        if (type === "return") return <ArrowDownCircle className="w-5 h-5 text-green-600" />;
        return <ArrowUpCircle className="w-5 h-5 text-red-600" />;
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            completed: "bg-green-100 text-green-700",
            pending: "bg-amber-100 text-amber-700",
            active: "bg-blue-100 text-blue-700",
        };
        return (
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${styles[status] ?? "bg-slate-100 text-slate-700"}`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
        );
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Transaction History</h1>
                    <p className="text-slate-600">View all your export investment transactions</p>
                </div>

                {loading ? (
                    <div className="bg-white rounded-xl border border-slate-200 p-12 flex justify-center">
                        <Loader2 className="w-10 h-10 animate-spin text-purple-600" />
                    </div>
                ) : transactions.length === 0 ? (
                    <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                        <Clock className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                        <h3 className="text-lg font-semibold text-slate-900 mb-2">No Transactions Yet</h3>
                        <p className="text-slate-600">Your transaction history will appear here once you start investing.</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl border border-slate-200">
                        <div className="divide-y divide-slate-200">
                            {transactions.map((tx) => (
                                <div key={tx.id} className="p-6 hover:bg-slate-50 transition-colors">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-start gap-4 flex-1">
                                            <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                                                {getIcon(tx.type)}
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="font-semibold text-slate-900 mb-1">{tx.description}</h3>
                                                <div className="flex items-center gap-4 text-sm text-slate-600">
                                                    <div className="flex items-center gap-1">
                                                        <Calendar className="w-4 h-4" />
                                                        {tx.date
                                                            ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                                            : "Date TBD"}
                                                    </div>
                                                    <span className="capitalize">{tx.type}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right flex flex-col items-end gap-2">
                                            <div className={`text-xl font-bold ${tx.amount > 0 ? "text-green-600" : "text-red-600"}`}>
                                                {tx.amount > 0 ? "+" : ""}₦{Math.abs(tx.amount).toLocaleString()}
                                            </div>
                                            {getStatusBadge(tx.status)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
