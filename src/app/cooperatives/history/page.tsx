"use client";

import { useState, useEffect } from "react";
import { Calendar, Download, Filter, Loader2, TrendingUp, Receipt } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getTransactionsAction } from "@/app/actions/cooperative";
import type { CooperativeTransaction } from "@/lib/types/cooperative";

export default function ContributionHistoryPage() {
    const [loading, setLoading] = useState(true);
    const [transactions, setTransactions] = useState<CooperativeTransaction[]>([]);
    const [dateFilter, setDateFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");

    useEffect(() => {
        loadHistory();
    }, []);

    async function loadHistory() {
        setLoading(true);
        try {
            const result = await getTransactionsAction();
            if (result.success && result.data) {
                setTransactions(result.data);
            }
        } catch (error) {
            console.error("Failed to load history:", error);
        } finally {
            setLoading(false);
        }
    }

    function formatDate(date: Date) {
        const d = date instanceof Date ? date : new Date(date);
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(d);
    }

    // Filter transactions
    const filteredTransactions = transactions.filter((t) => {
        const date = t.date instanceof Date ? t.date : new Date(t.date);
        const now = new Date();

        let dateMatch = true;
        if (dateFilter === "week") {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            dateMatch = date >= weekAgo;
        } else if (dateFilter === "month") {
            const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            dateMatch = date >= monthAgo;
        } else if (dateFilter === "year") {
            const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            dateMatch = date >= yearAgo;
        }

        const statusMatch = statusFilter === "all" || t.status === statusFilter;

        return dateMatch && statusMatch;
    });

    // Calculate totals
    const contributionTxns = filteredTransactions.filter((t) => t.type === "contribution");
    const totalContributions = contributionTxns.reduce((sum, t) => sum + t.amount, 0);
    const completedCount = contributionTxns.filter((t) => t.status === "completed").length;
    const pendingCount = contributionTxns.filter((t) => t.status === "pending").length;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                            Contribution History
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400">
                            View your complete contribution timeline
                        </p>
                    </div>
                    <button className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition flex items-center gap-2">
                        <Download className="w-5 h-5" />
                        Download Statement
                    </button>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Total Contributed</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {formatCurrency(totalContributions)}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <Receipt className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Transactions</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {contributionTxns.length}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Status</p>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                            <span className="text-green-600 font-semibold">✓ {completedCount}</span>
                            <span className="text-yellow-600 font-semibold">⏱ {pendingCount}</span>
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Time Period
                            </label>
                            <select
                                value={dateFilter}
                                onChange={(e) => setDateFilter(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600"
                            >
                                <option value="all">All Time</option>
                                <option value="week">Last 7 Days</option>
                                <option value="month">Last 30 Days</option>
                                <option value="year">Last Year</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Status
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600"
                            >
                                <option value="all">All Status</option>
                                <option value="completed">Completed</option>
                                <option value="pending">Pending</option>
                                <option value="failed">Failed</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Transactions List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-green-600" />
                    </div>
                ) : filteredTransactions.length > 0 ? (
                    <div className="space-y-4">
                        {filteredTransactions.map((transaction) => {
                            const date = transaction.date instanceof Date ? transaction.date : new Date(transaction.date);
                            return (
                                <div
                                    key={transaction.id}
                                    className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-lg font-bold text-slate-900 dark:text-white capitalize">
                                                    {transaction.type.replace("_", " ")}
                                                </h3>
                                                <span
                                                    className={`px-3 py-1 text-xs font-semibold rounded-full ${transaction.status === "completed"
                                                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                        : transaction.status === "pending"
                                                            ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                                            : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                                        }`}
                                                >
                                                    {transaction.status}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                                {formatDate(date)}
                                            </p>
                                            {transaction.description && (
                                                <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                                                    {transaction.description}
                                                </p>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <p className="text-2xl font-bold text-green-600">
                                                {formatCurrency(transaction.amount)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-12 text-center">
                        <Filter className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                            No Transactions Found
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Try adjusting your filters or make your first contribution
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
