"use client";

import { useEffect, useState } from "react";
import { logger } from '@/lib/logger';
import Link from "next/link";
import {
    Users,
    DollarSign,
    TrendingUp,
    FileText,
    Package,
    GraduationCap,
    AlertCircle,
    Loader2,
    Mail,
    ArrowRight,
} from "lucide-react";
import type { AnalyticsData, ModuleRegistrationStats } from "@/app/actions/admin-analytics";
import RegistrationPieChart from "@/components/admin/RegistrationPieChart";

export default function AdminDashboardPage() {
    const [stats, setStats] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [moduleStats, setModuleStats] = useState<ModuleRegistrationStats | null>(null);
    const [moduleStatsLoading, setModuleStatsLoading] = useState(true);

    useEffect(() => {
        async function fetchStats() {
            try {
                // Dynamically import to ensure server action is handled correctly
                const { getDashboardStatsAction } = await import("@/app/actions/admin-analytics");
                const data = await getDashboardStatsAction();
                setStats(data);
            } catch (err) {
                logger.error("Failed to load dashboard stats", err);
                setError("Failed to load dashboard data");
            } finally {
                setLoading(false);
            }
        }

        async function fetchModuleStats() {
            try {
                const { getModuleRegistrationStatsAction } = await import("@/app/actions/admin-analytics");
                const data = await getModuleRegistrationStatsAction();
                setModuleStats(data);
            } catch (err) {
                logger.error("Failed to load module registration stats", err);
                // Non-fatal — chart just won't render
            } finally {
                setModuleStatsLoading(false);
            }
        }

        fetchStats();
        fetchModuleStats();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-16 h-16 text-blue-600 animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="bg-red-100 p-4 rounded-full inline-block mb-4">
                        <AlertCircle className="w-8 h-8 text-red-600" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Error Loading Dashboard</h2>
                    <p className="text-slate-600 mb-6">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    // Fallback if stats is null but no error (mostly shouldn't happen with current action logic)
    if (!stats) return null;

    const colorClasses: Record<string, { bg: string; bgLight: string; text: string }> = {
        blue:    { bg: "bg-blue-500",    bgLight: "bg-blue-50",    text: "text-blue-600" },
        emerald: { bg: "bg-emerald-500", bgLight: "bg-emerald-50", text: "text-emerald-600" },
        purple:  { bg: "bg-purple-500",  bgLight: "bg-purple-50",  text: "text-purple-600" },
        amber:   { bg: "bg-amber-500",   bgLight: "bg-amber-50",   text: "text-amber-600" },
        indigo:  { bg: "bg-indigo-500",  bgLight: "bg-indigo-50",  text: "text-indigo-600" },
        red:     { bg: "bg-red-500",     bgLight: "bg-red-50",     text: "text-red-600" },
        cyan:    { bg: "bg-cyan-500",    bgLight: "bg-cyan-50",    text: "text-cyan-600" },
    };

    const statCards = [
        {
            label: "Total Users",
            value: (stats.platformOverview?.totalUsers ?? 0).toLocaleString(),
            icon: Users,
            color: "blue",
            change: "Total registered accounts",
            href: "/admin/users",
        },
        {
            label: "Active Users (30d)",
            value: (stats.platformOverview?.activeUsers ?? 0).toLocaleString(),
            icon: TrendingUp,
            color: "emerald",
            change: "Logged in recently",
            href: "/admin/users",
        },
        {
            label: "Total Revenue",
            value: `₦${(stats.platformOverview.totalRevenue / 1000000).toFixed(1)}M`,
            icon: DollarSign,
            color: "purple",
            change: "Based on transaction volume",
            href: "/admin/finance",
        },
        {
            label: "Pending Escrows",
            value: stats.counts.pendingEscrows,
            icon: Package,
            color: "amber",
            change: "Requires attention",
            href: "/admin/content-approval",
        },
        {
            label: "Active Land Listings",
            value: stats.counts.activeLandListings,
            icon: FileText,
            color: "indigo",
            change: "Verified listings",
            href: "/admin/farm-nation",
        },
        {
            label: "Pending Loans",
            value: stats.counts.pendingLoans,
            icon: AlertCircle,
            color: "red",
            change: "Requires review",
            href: "/admin/cooperatives/loans",
        },
        {
            label: "Recent Activity",
            value: stats.recentTransactions.length,
            icon: GraduationCap,
            color: "cyan",
            change: "Actions in last 24h",
            href: "/admin/audit-logs",
        },
    ];

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 mb-2">
                        Admin Dashboard
                    </h1>
                    <p className="text-slate-600">
                        Platform overview and key metrics
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
                    {statCards.map((stat, index) => {
                        const Icon = stat.icon;
                        const c = colorClasses[stat.color] ?? colorClasses.blue;

                        return (
                            <Link
                                key={index}
                                href={stat.href}
                                className="group bg-white rounded-xl p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className={`p-3 rounded-lg ${c.bgLight}`}>
                                        <Icon className={`w-6 h-6 ${c.text}`} />
                                    </div>
                                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
                                </div>

                                <p className="text-sm text-slate-600 mb-1">
                                    {stat.label}
                                </p>
                                <p className="text-3xl font-bold text-slate-900 mb-2">
                                    {stat.value}
                                </p>
                                <p className="text-xs text-slate-500">
                                    {stat.change}
                                </p>
                            </Link>
                        );
                    })}
                </div>

                {/* Quick Actions */}
                <div className="mb-8">
                    <h2 className="text-xl font-bold text-slate-900 mb-4">Quick Actions</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Link
                            href="/admin/cooperatives/loans"
                            className="group bg-white rounded-xl p-5 hover:shadow-md transition-all shadow-sm flex items-start gap-4"
                        >
                            <div className="p-2.5 bg-amber-50 rounded-lg shrink-0">
                                <AlertCircle className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 mb-1 group-hover:text-blue-600 transition">
                                    Review Loans
                                </h3>
                                <p className="text-sm text-slate-500">
                                    {stats.counts.pendingLoans} pending applications
                                </p>
                            </div>
                            <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 ml-auto mt-1 transition" />
                        </Link>

                        <Link
                            href="/admin/farm-nation"
                            className="group bg-white rounded-xl p-5 hover:shadow-md transition-all shadow-sm flex items-start gap-4"
                        >
                            <div className="p-2.5 bg-indigo-50 rounded-lg shrink-0">
                                <FileText className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 mb-1 group-hover:text-blue-600 transition">
                                    Verify Land Listings
                                </h3>
                                <p className="text-sm text-slate-500">
                                    Review pending submissions
                                </p>
                            </div>
                            <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 ml-auto mt-1 transition" />
                        </Link>

                        <Link
                            href="/admin/communications"
                            className="group bg-white rounded-xl p-5 hover:shadow-md transition-all shadow-sm border border-green-100 flex items-start gap-4"
                        >
                            <div className="p-2.5 bg-green-50 rounded-lg shrink-0">
                                <Mail className="w-5 h-5 text-green-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 mb-1 group-hover:text-green-600 transition">
                                    Send Broadcast
                                </h3>
                                <p className="text-sm text-slate-500">
                                    Email all or filtered users
                                </p>
                            </div>
                            <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 ml-auto mt-1 transition" />
                        </Link>
                    </div>
                </div>

                {/* Recent Transactions + Module Registration */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Recent Transactions */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-slate-900">
                                Recent Transactions
                            </h2>
                            <Link
                                href="/admin/cooperatives/transactions"
                                className="text-sm text-blue-600 hover:text-blue-700 font-medium transition"
                            >
                                View All →
                            </Link>
                        </div>
                        {stats.recentTransactions.length === 0 ? (
                            <div className="text-center py-8">
                                <DollarSign className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                                <p className="text-sm text-slate-500">No recent transactions</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {stats.recentTransactions.slice(0, 6).map((tx: any, i: number) => (
                                    <div
                                        key={tx.id || i}
                                        className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                                                <DollarSign className="w-4 h-4 text-blue-600" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900 capitalize">
                                                    {(tx.type || "transaction").replace(/_/g, " ")}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    {tx.date
                                                        ? new Date(
                                                              typeof tx.date === "string"
                                                                  ? tx.date
                                                                  : tx.date?.toDate
                                                                    ? tx.date.toDate()
                                                                    : tx.date
                                                          ).toLocaleDateString("en-NG", {
                                                              month: "short",
                                                              day: "numeric",
                                                          })
                                                        : "—"}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-bold text-emerald-600">
                                                ₦{(tx.amount || 0).toLocaleString()}
                                            </p>
                                            <p className={`text-xs capitalize ${
                                                tx.status === "completed"
                                                    ? "text-green-600"
                                                    : tx.status === "pending"
                                                      ? "text-yellow-600"
                                                      : "text-slate-500"
                                            }`}>
                                                {tx.status || "—"}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Module Registration Chart */}
                    <div>
                        {moduleStatsLoading ? (
                            <div className="bg-white rounded-2xl shadow-sm p-8 flex items-center justify-center gap-3 text-slate-400 text-sm h-full">
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Loading registration stats...
                            </div>
                        ) : moduleStats ? (
                            <RegistrationPieChart stats={moduleStats} />
                        ) : (
                            <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-slate-400 text-sm h-full flex items-center justify-center">
                                No registration data available
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
