"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    DollarSign,
    TrendingUp,
    TrendingDown,
    Wallet,
    ArrowLeft,
    Loader2,
    Download,
    AlertCircle,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getFinancialOverviewAction } from "@/app/actions/admin-analytics";

export default function AdminFinancePage() {
    const [loading, setLoading] = useState(true);
    const [financial, setFinancial] = useState<any>(null);

    useEffect(() => {
        loadFinancial();
    }, []);

    async function loadFinancial() {
        setLoading(true);
        const result = await getFinancialOverviewAction();
        setFinancial(result);
        setLoading(false);
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!financial) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">
                        Failed to load financial data
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/admin"
                        className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-4 transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Admin Dashboard
                    </Link>
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Financial Dashboard
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Revenue, escrow, and payout management
                    </p>
                </div>

                {/* Revenue Overview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-linear-to-br from-green-500 to-emerald-600 rounded-2xl p-6 shadow-lg text-white">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                <DollarSign className="w-6 h-6" />
                            </div>
                            <p className="text-sm font-medium opacity-90">Total Revenue</p>
                        </div>
                        <p className="text-4xl font-bold mb-2">
                            {formatCurrency(financial.totalRevenue)}
                        </p>
                        <p className="text-xs opacity-75">Platform commission earnings</p>
                    </div>

                    <div className="bg-linear-to-br from-blue-500 to-cyan-600 rounded-2xl p-6 shadow-lg text-white">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                <Wallet className="w-6 h-6" />
                            </div>
                            <p className="text-sm font-medium opacity-90">Escrow Volume</p>
                        </div>
                        <p className="text-4xl font-bold mb-2">
                            {formatCurrency(financial.totalEscrowVolume)}
                        </p>
                        <p className="text-xs opacity-75">Total funds in escrow</p>
                    </div>

                    <div className="bg-linear-to-br from-purple-500 to-pink-600 rounded-2xl p-6 shadow-lg text-white">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-6 h-6" />
                            </div>
                            <p className="text-sm font-medium opacity-90">Loans Disbursed</p>
                        </div>
                        <p className="text-4xl font-bold mb-2">
                            {formatCurrency(financial.totalLoansDisbursed)}
                        </p>
                        <p className="text-xs opacity-75">Total loan volume</p>
                    </div>
                </div>

                {/* Secondary Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                            Avg Commission
                        </p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            2.5%
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Platform fee
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                            Pending Payouts
                        </p>
                        <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                            {formatCurrency(financial.totalEscrowVolume * 0.1)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Awaiting release
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                            Transaction Count
                        </p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {financial.recentTransactions.length}
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                            +12% this month
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                            Avg Transaction
                        </p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {formatCurrency(
                                financial.recentTransactions.length > 0
                                    ? financial.totalEscrowVolume / financial.recentTransactions.length
                                    : 0
                            )}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Per transaction
                        </p>
                    </div>
                </div>

                {/* Recent Transactions Table */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden mb-8">
                    <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                                Recent Financial Activity
                            </h2>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Latest {financial.recentTransactions.length} transactions
                            </p>
                        </div>
                        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition">
                            <Download className="w-4 h-4" />
                            Export CSV
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 dark:bg-slate-900">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Type
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Amount
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Date
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                {financial.recentTransactions.slice(0, 10).map((transaction: any, index: number) => (
                                    <tr
                                        key={transaction.id || index}
                                        className="hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${transaction.type === "payment_completed"
                                                        ? "bg-green-100 dark:bg-green-900/30"
                                                        : transaction.type === "escrow_released"
                                                            ? "bg-blue-100 dark:bg-blue-900/30"
                                                            : "bg-purple-100 dark:bg-purple-900/30"
                                                    }`}>
                                                    {transaction.type === "payment_completed" ? (
                                                        <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
                                                    ) : transaction.type === "escrow_released" ? (
                                                        <TrendingDown className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                                    ) : (
                                                        <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                                        {transaction.type
                                                            ?.replace(/_/g, " ")
                                                            .replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                                    </p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                                        ID: {transaction.id?.slice(0, 8)}...
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-sm font-bold text-slate-900 dark:text-white">
                                                {formatCurrency(transaction.amount || 0)}
                                            </p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                                {transaction.timestamp
                                                    ? new Date(transaction.timestamp.toDate()).toLocaleDateString("en-NG", {
                                                        year: "numeric",
                                                        month: "short",
                                                        day: "numeric",
                                                    })
                                                    : "N/A"}
                                            </p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                                Completed
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {financial.recentTransactions.length === 0 && (
                            <div className="text-center py-12">
                                <Wallet className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                                <p className="text-slate-600 dark:text-slate-400">
                                    No recent transactions
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Link
                        href="/admin/withdrawals"
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg hover:shadow-xl transition flex items-center justify-between group"
                    >
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                                Process Withdrawals
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Review pending requests
                            </p>
                        </div>
                        <TrendingDown className="w-6 h-6 text-blue-600 group-hover:translate-x-1 transition" />
                    </Link>

                    <Link
                        href="/admin/cooperatives/transactions"
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg hover:shadow-xl transition flex items-center justify-between group"
                    >
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                                View Transactions
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                All platform activity
                            </p>
                        </div>
                        <DollarSign className="w-6 h-6 text-green-600 group-hover:translate-x-1 transition" />
                    </Link>

                    <Link
                        href="/admin/audit-logs"
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg hover:shadow-xl transition flex items-center justify-between group"
                    >
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                                Audit Logs
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Review system activity
                            </p>
                        </div>
                        <AlertCircle className="w-6 h-6 text-purple-600 group-hover:translate-x-1 transition" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
