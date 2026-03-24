"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
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
    ArrowRight,
    ExternalLink,
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
        let mounted = true;

        async function fetchAnalytics() {
            setLoading(true);
            try {
                const result = await getDashboardStatsAction();
                if (mounted && result) {
                    setAnalytics(result);
                }
            } catch (error) {
                logger.error("Error:", error);
            } finally {
                if (mounted) setLoading(false);
            }
        }

        fetchAnalytics();

        return () => { mounted = false; };
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">Loading analytics…</p>
                </div>
            </div>
        );
    }

    if (!analytics) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <p className="text-slate-600 mb-4">
                        Failed to load analytics
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const { platformOverview, revenueByMonth, userGrowthByMonth, moduleUsage, recentTransactions } = analytics;

    const COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4"];

    const overviewCards = [
        {
            label: "Total Users",
            value: (platformOverview?.totalUsers ?? 0).toLocaleString(),
            sub: `${platformOverview?.activeUsers ?? 0} active (30d)`,
            icon: Users,
            bgClass: "from-blue-500 to-blue-600",
            href: "/admin/users",
        },
        {
            label: "Total Revenue",
            value: formatCurrency(platformOverview?.totalRevenue ?? 0),
            sub: `${formatCurrency(platformOverview?.monthlyRevenue ?? 0)} this month`,
            icon: DollarSign,
            bgClass: "from-emerald-500 to-green-600",
            href: "/admin/finance",
        },
        {
            label: "Transactions",
            value: (platformOverview?.totalTransactions ?? 0).toLocaleString(),
            sub: "All time",
            icon: Activity,
            bgClass: "from-purple-500 to-violet-600",
            href: "/admin/cooperatives/transactions",
        },
        {
            label: "Pending Approvals",
            value: (platformOverview?.pendingApprovals ?? 0).toString(),
            sub: "Requires attention",
            icon: AlertCircle,
            bgClass: "from-amber-500 to-orange-500",
            href: "/admin/content-approval",
        },
    ];

    const tooltipStyle = {
        backgroundColor: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: "10px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
        color: "#0f172a",
        fontSize: "13px",
        fontWeight: 500,
        padding: "8px 14px",
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/admin"
                        className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Admin Dashboard
                    </Link>
                    <h1 className="text-4xl font-bold text-slate-900 mb-2">
                        Platform Analytics
                    </h1>
                    <p className="text-slate-600">
                        Comprehensive insights and performance metrics
                    </p>
                </div>

                {/* Overview Cards – clickable with gradient backgrounds */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {overviewCards.map((card) => {
                        const Icon = card.icon;
                        return (
                            <Link
                                key={card.label}
                                href={card.href}
                                className={`group relative bg-linear-to-br ${card.bgClass} rounded-2xl p-6 shadow-lg text-white hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 overflow-hidden`}
                            >
                                {/* Decorative circle */}
                                <div className="absolute -top-4 -right-4 w-24 h-24 bg-white/10 rounded-full" />
                                <div className="relative">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                            <Icon className="w-5 h-5" />
                                        </div>
                                        <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                                    </div>
                                    <p className="text-3xl font-bold mb-1">{card.value}</p>
                                    <p className="text-sm font-medium opacity-90">{card.label}</p>
                                    <p className="text-xs opacity-70 mt-1">{card.sub}</p>
                                </div>
                            </Link>
                        );
                    })}
                </div>

                {/* Secondary Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-2 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-500 mb-1">Growth Rate</p>
                        <p className="text-3xl font-bold text-slate-900">
                            {((platformOverview?.activeUsers ?? 0) / (platformOverview?.totalUsers || 1) * 100).toFixed(1)}%
                        </p>
                        <p className="text-xs text-slate-500 mt-1">Active user ratio</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <p className="text-sm text-slate-500 mb-1">Avg Transaction</p>
                        <p className="text-3xl font-bold text-slate-900">
                            {formatCurrency(
                                (platformOverview?.totalTransactions ?? 0) > 0
                                    ? (platformOverview?.totalRevenue ?? 0) / (platformOverview?.totalTransactions ?? 1)
                                    : 0
                            )}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">Per transaction</p>
                    </div>
                </div>

                {/* Charts Row 1 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Revenue Trend */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-900 mb-6">
                            Revenue Trend (6 Months)
                        </h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={revenueByMonth}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                                <YAxis stroke="#94a3b8" fontSize={12} />
                                <Tooltip
                                    contentStyle={tooltipStyle}
                                    formatter={(value: any) => formatCurrency(value)}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="revenue"
                                    stroke="#10b981"
                                    strokeWidth={3}
                                    dot={{ fill: "#10b981", r: 5 }}
                                    activeDot={{ r: 7, stroke: "#10b981", strokeWidth: 2, fill: "#fff" }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>

                    {/* User Growth */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-900 mb-6">
                            User Growth (6 Months)
                        </h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={userGrowthByMonth}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                                <YAxis stroke="#94a3b8" fontSize={12} />
                                <Tooltip contentStyle={tooltipStyle} />
                                <Bar dataKey="users" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Charts Row 2 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Module Usage */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-900 mb-6">
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
                                    outerRadius={110}
                                    label={false}
                                >
                                    {(moduleUsage || []).map((_entry: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={tooltipStyle}
                                    formatter={(value: any, name: any) => [value, name]}
                                />
                                <Legend
                                    iconType="circle"
                                    formatter={(value) => (
                                        <span style={{ color: "#475569", fontSize: 12 }}>{value}</span>
                                    )}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Recent Transactions */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-slate-900">
                                Recent Transactions
                            </h3>
                            <Link
                                href="/admin/finance"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium transition"
                            >
                                View All
                                <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                        </div>
                        <div className="space-y-3 max-h-[300px] overflow-y-auto">
                            {(recentTransactions || []).length === 0 ? (
                                <div className="text-center py-8">
                                    <Activity className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                    <p className="text-sm text-slate-500">No recent transactions</p>
                                </div>
                            ) : (
                                (recentTransactions || []).slice(0, 8).map((transaction: any) => (
                                    <div
                                        key={transaction.id}
                                        className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                                                <DollarSign className="w-4 h-4 text-blue-600" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900">
                                                    {transaction.type || "Transaction"}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    {(transaction.timestamp || transaction.date)
                                                        ? new Date(transaction.timestamp || transaction.date).toLocaleDateString("en-NG", {
                                                            month: "short",
                                                            day: "numeric",
                                                            hour: "2-digit",
                                                            minute: "2-digit",
                                                        })
                                                        : "—"}
                                                </p>
                                            </div>
                                        </div>
                                        <p className="text-sm font-bold text-emerald-600">
                                            {formatCurrency(transaction.amount || 0)}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
