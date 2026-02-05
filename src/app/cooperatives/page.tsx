"use client";

import { useEffect, useState } from "react";
import { Plus, TrendingUp, TrendingDown, ArrowRight, Users, Wallet, DollarSign, Calendar, Loader2, AlertCircle, Award, Clock } from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import dynamic from "next/dynamic";

// Dynamic import for code splitting
const ContributionModal = dynamic(
    () => import("@/components/modals/ContributionModal"),
    { ssr: false }
);
import {
    getCooperativeMembershipAction,
    getCooperativeTransactionsAction,
    type CooperativeMembership,
    type CooperativeTransaction
} from "@/app/actions/cooperative";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function CooperativesPage() {
    const [isContributionModalOpen, setIsContributionModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [membership, setMembership] = useState<CooperativeMembership | null>(null);
    const [transactions, setTransactions] = useState<CooperativeTransaction[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Fetch cooperative data on mount
    useEffect(() => {
        const fetchCooperativeData = async () => {
            setIsLoading(true);
            setError(null);

            const membershipResult = await getCooperativeMembershipAction();

            if (membershipResult.success && membershipResult.data) {
                setMembership(membershipResult.data);

                // Fetch transactions if user is a member
                const transactionsResult = await getCooperativeTransactionsAction(membershipResult.data.cooperativeId);
                if (transactionsResult.success && transactionsResult.data) {
                    setTransactions(transactionsResult.data);
                }
            } else {
                setError(membershipResult.error || "Failed to load cooperative data");
            }

            setIsLoading(false);
        };

        fetchCooperativeData();
    }, []);

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
            day: "numeric"
        }).format(new Date(date));
    };

    // Prepare chart data from transactions
    const chartData = transactions
        .filter(t => t.type === "contribution" && t.status === "completed")
        .slice(0, 6)
        .reverse()
        .map((t, idx) => ({
            name: formatDate(t.date).split(' ')[0] + ' ' + formatDate(t.date).split(' ')[1],
            amount: t.amount,
        }));

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="p-8">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                            Cooperative Savings
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400">
                            Manage your savings, loans, and transactions
                        </p>
                    </div>
                    {membership && (
                        <div className="flex gap-3">
                            <Link
                                href="/cooperatives/contribute"
                                className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all shadow-lg flex items-center gap-2"
                            >
                                <TrendingUp className="w-5 h-5" />
                                Contribute
                            </Link>
                            <Link
                                href="/cooperatives/withdraw"
                                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all shadow-lg flex items-center gap-2"
                            >
                                <TrendingDown className="w-5 h-5" />
                                Withdraw
                            </Link>
                        </div>
                    )}
                </div>

                {/* Loading State */}
                {isLoading && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <span className="ml-3 text-slate-600 dark:text-slate-400">Loading cooperative data...</span>
                    </div>
                )}

                {/* Error State */}
                {error && !isLoading && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
                        <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-3" />
                        <p className="text-red-300">{error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Membership Display */}
                {!isLoading && !error && membership && (
                    <>
                        {/* Enhanced Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                            {/* Savings Balance */}
                            <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-6 rounded-2xl text-white shadow-xl">
                                <div className="flex items-center justify-between mb-4">
                                    <Wallet className="w-8 h-8" />
                                    <span className="text-xs bg-white/20 px-3 py-1 rounded-full">Active</span>
                                </div>
                                <p className="text-sm text-green-50 mb-1">Savings Balance</p>
                                <h3 className="text-3xl font-bold mb-2">
                                    {formatCurrency(membership.savingsBalance)}
                                </h3>
                                <p className="text-xs text-green-100">
                                    Target: {formatCurrency(membership.monthlyTarget)}/month
                                </p>
                            </div>

                            {/* Total Contributions with Tier */}
                            <div className="bg-gradient-to-br from-purple-500 to-pink-600 p-6 rounded-2xl text-white shadow-xl">
                                <div className="flex items-center justify-between mb-4">
                                    <Award className="w-8 h-8" />
                                    <span className="text-xs bg-white/20 px-3 py-1 rounded-full font-semibold">
                                        {membership.tier || 'Basic'}
                                    </span>
                                </div>
                                <p className="text-sm text-purple-50 mb-1">Total Contributions</p>
                                <h3 className="text-3xl font-bold mb-2">
                                    {formatCurrency(membership.totalContributions || 0)}
                                </h3>
                                <p className="text-xs text-purple-100">
                                    Member since {formatDate(membership.memberSince)}
                                </p>
                            </div>

                            {/* Loan Balance */}
                            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-6 rounded-2xl text-white shadow-xl">
                                <div className="flex items-center justify-between mb-4">
                                    <DollarSign className="w-8 h-8" />
                                    {membership.loanBalance > 0 && (
                                        <span className="text-xs bg-white/20 px-3 py-1 rounded-full">Outstanding</span>
                                    )}
                                </div>
                                <p className="text-sm text-blue-50 mb-1">Loan Balance</p>
                                <h3 className="text-3xl font-bold mb-2">
                                    {formatCurrency(membership.loanBalance)}
                                </h3>
                                <p className="text-xs text-blue-100">
                                    {membership.loanBalance === 0 ? "No active loans" : "Make a payment"}
                                </p>
                            </div>

                            {/* Cooperative Info */}
                            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-xl">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center">
                                        <Users className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-900 dark:text-white">
                                            {membership.cooperativeName}
                                        </h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Cooperative</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                    <Clock className="w-4 h-4" />
                                    Member since {new Date(membership.memberSince).getFullYear()}
                                </div>
                            </div>
                        </div>

                        {/* Charts and Activity Row */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                            {/* Contribution History Chart */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl">
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                                    Contribution Trend (Last 6)
                                </h2>
                                {chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={250}>
                                        <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.1} />
                                            <XAxis
                                                dataKey="name"
                                                stroke="#9ca3af"
                                                fontSize={12}
                                                tickLine={false}
                                            />
                                            <YAxis
                                                stroke="#9ca3af"
                                                fontSize={12}
                                                tickLine={false}
                                                tickFormatter={(value) => `₦${(value / 1000).toFixed(0)}k`}
                                            />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#1e293b',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    color: '#fff'
                                                }}
                                                formatter={(value: any) => [`₦${value.toLocaleString()}`, 'Amount']}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="amount"
                                                stroke="#10b981"
                                                strokeWidth={3}
                                                dot={{ fill: '#10b981', r: 5 }}
                                                activeDot={{ r: 7 }}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="text-center py-12">
                                        <TrendingUp className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                        <p className="text-slate-600 dark:text-slate-400">No contribution data yet</p>
                                    </div>
                                )}
                            </div>

                            {/* Recent Activity */}
                            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl">
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                                    Recent Activity
                                </h2>
                                {transactions.slice(0, 5).length > 0 ? (
                                    <div className="space-y-3">
                                        {transactions.slice(0, 5).map((transaction) => (
                                            <div
                                                key={transaction.id}
                                                className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${transaction.type === "contribution"
                                                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                                        : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                                        }`}>
                                                        {transaction.type === "contribution" ? (
                                                            <TrendingUp className="w-5 h-5" />
                                                        ) : (
                                                            <TrendingDown className="w-5 h-5" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-sm text-slate-900 dark:text-white capitalize">
                                                            {transaction.type.replace("_", " ")}
                                                        </p>
                                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                                            {formatDate(transaction.date)}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className={`text-sm font-bold ${transaction.type === "contribution"
                                                        ? "text-green-600 dark:text-green-400"
                                                        : "text-blue-600 dark:text-blue-400"
                                                        }`}>
                                                        {transaction.type === "contribution" ? "+" : "-"}
                                                        {formatCurrency(transaction.amount)}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-12">
                                        <Clock className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                        <p className="text-slate-600 dark:text-slate-400">No recent activity</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Full Transaction History */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                All Transactions
                            </h2>

                            {transactions.length === 0 ? (
                                <div className="text-center py-12">
                                    <DollarSign className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                    <p className="text-slate-600 dark:text-slate-400">No transactions yet</p>
                                    <Link
                                        href="/cooperatives/contribute"
                                        className="mt-4 inline-block px-6 py-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
                                    >
                                        Make Your First Contribution
                                    </Link>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {transactions.map((transaction) => (
                                        <div
                                            key={transaction.id}
                                            className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${transaction.type === "contribution"
                                                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                                    }`}>
                                                    {transaction.type === "contribution" ? (
                                                        <TrendingUp className="w-5 h-5" />
                                                    ) : (
                                                        <TrendingDown className="w-5 h-5" />
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900 dark:text-white capitalize">
                                                        {transaction.type.replace("_", " ")}
                                                    </p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                                        {formatDate(transaction.date)}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className={`text-lg font-bold ${transaction.type === "contribution"
                                                    ? "text-green-600 dark:text-green-400"
                                                    : "text-blue-600 dark:text-blue-400"
                                                    }`}>
                                                    {transaction.type === "contribution" ? "+" : "-"}
                                                    {formatCurrency(transaction.amount)}
                                                </p>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${transaction.status === "completed"
                                                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                    : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                                    }`}>
                                                    {transaction.status}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* Not a Member State */}
                {!isLoading && !error && !membership && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center shadow-xl">
                        <Users className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            Join a Cooperative
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
                            Save together, grow together. Join a cooperative to access group savings,
                            affordable loans, and financial support.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <Link
                                href="/cooperatives/contribute"
                                className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-lg transition-all shadow-lg"
                            >
                                <TrendingUp className="w-5 h-5" />
                                Make Contribution
                            </Link>
                            <Link
                                href="/cooperatives/withdraw"
                                className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-lg transition-all shadow-lg"
                            >
                                <TrendingDown className="w-5 h-5" />
                                Request Withdrawal
                            </Link>
                        </div>
                    </div>
                )}
            </div>

            {/* Contribution Modal */}
            {membership && (
                <ContributionModal
                    isOpen={isContributionModalOpen}
                    onClose={() => setIsContributionModalOpen(false)}
                    cooperativeId={membership.cooperativeId}
                    currentBalance={membership.savingsBalance}
                    loanBalance={membership.loanBalance}
                />
            )}
        </div>
    );
}
