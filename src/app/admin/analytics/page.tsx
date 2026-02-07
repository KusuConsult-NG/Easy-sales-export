"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    TrendingUp,
    Users,
    DollarSign,
    Activity,
    Package,
    AlertCircle,
    Loader2,
    ArrowLeft,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getDashboardStatsAction } from "@/app/actions/admin-analytics";
import {
    LineChart,
    Line,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from "recharts";

export default function AdminAnalyticsPage() {
    const [loading, setLoading] = useState(true);
    const [analytics, setAnalytics] = useState<any>(null);

    useEffect(() => {
        loadAnalytics();
    }, []);

    async function loadAnalytics() {
        setLoading(true);
        const result = await getDashboardStatsAction();
        if (result) {
            setAnalytics(result);
        }
        setLoading(false);
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!analytics) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">
                        Failed to load analytics
                    </p>
                </div>
            </div>
        );
    }

    const { platformOverview, revenueByMonth, userGrowthByMonth, moduleUsage, recentTransactions } = analytics;

    const COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444"];

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
                        Platform Analytics
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Comprehensive insights and performance metrics
                    </p>
                </div>

                {/* Platform Overview Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Total Users
                            </p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {platformOverview.totalUsers.toLocaleString()}
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400">
                            {platformOverview.activeUsers} active (30d)
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <DollarSign className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Total Revenue
                            </p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {formatCurrency(platformOverview.totalRevenue)}
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400">
                            {formatCurrency(platformOverview.monthlyRevenue)} this month
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <Activity className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Transactions
                            </p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {platformOverview.totalTransactions.toLocaleString()}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            All time
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/30 rounded-xl flex items-center justify-center">
                                <AlertCircle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Pending Approvals
                            </p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {platformOverview.pendingApprovals}
                        </p>
                        <p className="text-xs text-yellow-600 dark:text-yellow-400">
                            Requires attention
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Growth Rate
                            </p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {((platformOverview.activeUsers / platformOverview.totalUsers) * 100).toFixed(1)}%
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Active user ratio
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                                <Package className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Avg Transaction
                            </p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {formatCurrency(
                                platformOverview.totalTransactions > 0
                                    ? platformOverview.totalRevenue / platformOverview.totalTransactions
                                    : 0
                            )}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Per transaction
                        </p>
                    </div>
                </div>

                {/* Charts Row 1 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Revenue Trend */}
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">
                            Revenue Trend (6 Months)
                        </h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={revenueByMonth}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                <XAxis dataKey="month" stroke="#9ca3af" />
                                <YAxis stroke="#9ca3af" />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: "#1e293b",
                                        border: "none",
                                        borderRadius: "8px",
                                    }}
                                    formatter={(value: any) => formatCurrency(value)}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="revenue"
                                    stroke="#10b981"
                                    strokeWidth={3}
                                    dot={{ fill: "#10b981", r: 5 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>

                    {/* User Growth */}
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">
                            User Growth (6 Months)
                        </h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={userGrowthByMonth}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                <XAxis dataKey="month" stroke="#9ca3af" />
                                <YAxis stroke="#9ca3af" />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: "#1e293b",
                                        border: "none",
                                        borderRadius: "8px",
                                    }}
                                />
                                <Bar dataKey="users" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Charts Row 2 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Module Usage */}
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">
                            Module Usage
                        </h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={moduleUsage}
                                    dataKey="count"
                                    nameKey="module"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={100}
                                    label={(entry) => entry.name}
                                >
                                    {moduleUsage.map((entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: "#1e293b",
                                        border: "none",
                                        borderRadius: "8px",
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Recent Transactions */}
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">
                            Recent Transactions
                        </h3>
                        <div className="space-y-3 max-h-[300px] overflow-y-auto">
                            {recentTransactions.slice(0, 5).map((transaction: any) => (
                                <div
                                    key={transaction.id}
                                    className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700 rounded-lg"
                                >
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                            {transaction.type || "Transaction"}
                                        </p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            {transaction.createdAt
                                                ? new Date(transaction.createdAt).toLocaleDateString()
                                                : "N/A"}
                                        </p>
                                    </div>
                                    <p className="text-sm font-bold text-green-600 dark:text-green-400">
                                        {formatCurrency(transaction.amount || 0)}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
