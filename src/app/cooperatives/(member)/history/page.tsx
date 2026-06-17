/**
 * Cooperative Member History
 * 
 * Transaction and activity history
 */

"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { History as HistoryIcon, Download, Search, Calendar, ChevronDown, Loader2 } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { getTransactionsAction } from "@/app/actions/cooperative";
import type { CooperativeTransaction } from "@/lib/types/cooperative";

export default function CooperativeHistoryPage() {
    const [loading, setLoading] = useState(true);
    const [transactions, setTransactions] = useState<CooperativeTransaction[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [filterType, setFilterType] = useState("all");
    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        async function loadData() {
            try {
                const res = await getTransactionsAction();
                if (res.success && res.data?.transactions) {
                    setTransactions(res.data.transactions);
                }
            } catch (error) {
                logger.error("Failed to load history:", error);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, []);


    const filteredTransactions = transactions.filter(t => {
        const matchesSearch = t.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            t.id.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter = filterType === "all" || t.type === filterType;
        return matchesSearch && matchesFilter;
    });

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <HistoryIcon className="w-8 h-8 text-purple-600" />
                        Transaction History
                    </h1>
                    <p className="text-slate-600 mt-1">
                        View all your cooperative activities and transactions
                    </p>
                </div>
                <div className="flex gap-2">
                    <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition">
                        <Download className="w-4 h-4" />
                        <span>Export</span>
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search transactions..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                </div>
                <div className="flex gap-2">
                    <div className="relative">
                        <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            className="appearance-none pl-4 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                        >
                            <option value="all">All Types</option>
                            <option value="contribution">Contributions</option>
                            <option value="withdrawal">Withdrawals</option>
                            <option value="loan">Loans</option>
                            <option value="interest">Interest</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                    <button className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 hover:text-purple-600">
                        <Calendar className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Transactions List */}
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-200">
                {loading ? (
                    <div className="p-12 text-center">
                        <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-500">Loading history...</p>
                    </div>
                ) : filteredTransactions.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <HistoryIcon className="w-8 h-8 text-slate-400" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-2">No transactions found</h3>
                        <p className="text-slate-500">
                            {searchTerm || filterType !== "all"
                                ? "Try adjusting your filters"
                                : "You haven't made any transactions yet"}
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {filteredTransactions.map((t) => (
                            <div
                                key={t.id}
                                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                                className="p-5 hover:bg-slate-50 transition cursor-pointer"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-start gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
                                            <HistoryIcon className="w-5 h-5 text-purple-600" />
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-slate-900 text-sm">
                                                {t.description || "Transaction"}
                                            </h4>
                                            <p className="text-xs text-slate-500 mt-0.5">
                                                {formatDateTime(t.date)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right">
                                            <p className={`font-bold text-sm ${t.amount > 0 ? "text-green-600" : "text-slate-900"}`}>
                                                {t.amount > 0 ? "+" : ""}
                                                {formatCurrency(t.amount)}
                                            </p>
                                            <span className="capitalize px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                                                {t.type.replace('_', ' ')}
                                            </span>
                                        </div>
                                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${expandedId === t.id ? "rotate-180" : ""}`} />
                                    </div>
                                </div>

                                {/* Expanded details */}
                                {expandedId === t.id && (
                                    <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl">
                                        <div>
                                            <p className="text-slate-500 font-semibold mb-0.5">Transaction ID</p>
                                            <p className="font-mono text-slate-800 select-all">{t.id}</p>
                                        </div>
                                        <div>
                                            <p className="text-slate-500 font-semibold mb-0.5">Status</p>
                                            <span className={`capitalize px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                                t.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                t.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-red-100 text-red-700'
                                            }`}>
                                                {t.status}
                                            </span>
                                        </div>
                                        {t.description && (
                                            <div className="col-span-1 md:col-span-2">
                                                <p className="text-slate-500 font-semibold mb-0.5">Description</p>
                                                <p className="text-slate-700 font-medium">{t.description}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
