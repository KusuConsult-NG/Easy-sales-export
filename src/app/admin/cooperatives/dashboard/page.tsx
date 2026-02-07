"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Users,
    TrendingUp,
    DollarSign,
    Wallet,
    Activity,
    FileText,
    Loader2,
    ArrowUp,
    ArrowDown,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
    getCooperativeStatsAction,
    getContributionReportsAction,
    getRecentActivityAction,
} from "@/app/actions/cooperative-admin";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import Link from "next/link";

export default function AdminCooperativeDashboardPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [reports, setReports] = useState<any>(null);
    const [activities, setActivities] = useState<any[]>([]);

    useEffect(() => {
        loadDashboardData();
    }, []);

    async function loadDashboardData() {
        setLoading(true);
        try {
            const [statsRes, reportsRes, activityRes] = await Promise.all([
                getCooperativeStatsAction(),
                getContributionReportsAction(),
                getRecentActivityAction(),
            ]);

            if (statsRes.success && statsRes.data) {
                setStats(statsRes.data);
            }

            if (reportsRes.success && reportsRes.data) {
                setReports(reportsRes.data);
            }

            if (activityRes.success && activityRes.data) {
                setActivities(activityRes.data);
            }
        } catch (error) {
            console.error("Failed to load dashboard:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Cooperative Dashboard
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Overview of cooperative activities and performance
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                    {/* Total Members */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <Link
                                href="/admin/cooperatives/members"
                                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                View all
                            </Link>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Members</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {stats?.totalMembers || 0}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-sm">
                            <span className="text-green-600">Active: {stats?.activeMembers || 0}</span>
                            <span className="text-yellow-600">Pending: {stats?.pendingMembers || 0}</span>
                        </div>
                    </div>

                    {/* Total Contributions */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                            <Link
                                href="/admin/cooperatives/contributions"
                                className="text-sm text-green-600 dark:text-green-400 hover:underline"
                            >
                                Details
                            </Link>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Contributions</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {formatCurrency(stats?.totalContributions || 0)}
                        </p>
                        <div className="flex items-center gap-1 mt-2 text-sm">
                            <span className="text-gray-600 dark:text-gray-400">This month:</span>
                            <span className="font-semibold text-green-600">
                                {formatCurrency(stats?.monthlyContributions || 0)}
                            </span>
                        </div>
                    </div>

                    {/* Active Loans */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <DollarSign className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <Link
                                href="/admin/cooperatives/loans"
                                className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
                            >
                                Manage
                            </Link>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Active Loans</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {stats?.activeLoans || 0}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-sm">
                            <span className="text-yellow-600">Pending: {stats?.pendingLoans || 0}</span>
                            <span className="text-gray-600">Total: {formatCurrency(stats?.totalLoans || 0)}</span>
                        </div>
                    </div>

                    {/* Total Savings */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center">
                                <Wallet className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Savings</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {formatCurrency(stats?.totalSavings || 0)}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                            Fixed savings deposits
                        </p>
                    </div>

                    {/* Monthly Growth */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                                <Activity className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Monthly Growth</p>
                        <div className="flex items-center gap-2">
                            <p className="text-3xl font-bold text-gray-900 dark:text-white">
                                {stats?.monthlyGrowth?.toFixed(1) || 0}%
                            </p>
                            {stats?.monthlyGrowth >= 0 ? (
                                <ArrowUp className="w-6 h-6 text-green-600" />
                            ) : (
                                <ArrowDown className="w-6 h-6 text-red-600" />
                            )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                            vs. previous month
                        </p>
                    </div>

                    {/* Transactions */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                                <FileText className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                            </div>
                            <Link
                                href="/admin/cooperatives/transactions"
                                className="text-sm text-orange-600 dark:text-orange-400 hover:underline"
                            >
                                View all
                            </Link>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Recent Activity</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {activities.length}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                            Last 10 transactions
                        </p>
                    </div>
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Contribution Trend */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                            Contribution Trend
                        </h2>
                        {reports?.monthlyTrend && reports.monthlyTrend.length > 0 ? (
                            <ResponsiveContainer width="100%" height={250}>
                                <LineChart data={reports.monthlyTrend}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                    <XAxis dataKey="month" stroke="#9CA3AF" />
                                    <YAxis stroke="#9CA3AF" />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: "#1F2937",
                                            border: "none",
                                            borderRadius: "0.5rem",
                                            color: "#fff",
                                        }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="amount"
                                        stroke="#10B981"
                                        strokeWidth={3}
                                        dot={{ fill: "#10B981", r: 4 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <p className="text-center text-gray-500 py-8">No data available</p>
                        )}
                    </div>

                    {/* Recent Activity */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                            Recent Activity
                        </h2>
                        <div className="space-y-3 max-h-64 overflow-y-auto">
                            {activities.length > 0 ? (
                                activities.map((activity, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                                    >
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-white capitalize">
                                                {activity.type}
                                            </p>
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                {activity.description}
                                            </p>
                                        </div>
                                        <p className="text-xs text-gray-500">
                                            {new Date(activity.timestamp).toLocaleDateString()}
                                        </p>
                                    </div>
                                ))
                            ) : (
                                <p className="text-center text-gray-500 py-8">No recent activity</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Link
                        href="/admin/cooperatives/members"
                        className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition"
                    >
                        <Users className="w-8 h-8 mb-3" />
                        <h3 className="text-lg font-bold mb-2">Manage Members</h3>
                        <p className="text-sm text-blue-100">View and manage all cooperative members</p>
                    </Link>

                    <Link
                        href="/admin/cooperatives/transactions"
                        className="bg-gradient-to-br from-green-600 to-green-700 text-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition"
                    >
                        <FileText className="w-8 h-8 mb-3" />
                        <h3 className="text-lg font-bold mb-2">View Transactions</h3>
                        <p className="text-sm text-green-100">Monitor all cooperative transactions</p>
                    </Link>

                    <Link
                        href="/admin/cooperatives/loans"
                        className="bg-gradient-to-br from-purple-600 to-purple-700 text-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition"
                    >
                        <DollarSign className="w-8 h-8 mb-3" />
                        <h3 className="text-lg font-bold mb-2">Review Loans</h3>
                        <p className="text-sm text-purple-100">Approve and manage loan applications</p>
                    </Link>
                </div>
            </div>
        </div>
    );
}
