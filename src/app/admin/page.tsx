"use client";

import { useEffect, useState } from "react";
import {
    Users,
    DollarSign,
    TrendingUp,
    FileText,
    Package,
    GraduationCap,
    AlertCircle,
    Loader2,
} from "lucide-react";
import type { AnalyticsData } from "@/app/actions/admin-analytics";

export default function AdminDashboardPage() {
    const [stats, setStats] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchStats() {
            try {
                // Dynamically import to ensure server action is handled correctly
                const { getDashboardStatsAction } = await import("@/app/actions/admin-analytics");
                const data = await getDashboardStatsAction();
                setStats(data);
            } catch (err) {
                console.error("Failed to load dashboard stats", err);
                setError("Failed to load dashboard data");
            } finally {
                setLoading(false);
            }
        }

        fetchStats();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="w-16 h-16 text-blue-600 animate-spin mx-auto mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="bg-red-100 p-4 rounded-full inline-block mb-4">
                        <AlertCircle className="w-8 h-8 text-red-600" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Error Loading Dashboard</h2>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">{error}</p>
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

    const statCards = [
        {
            label: "Total Users",
            value: stats.platformOverview.totalUsers.toLocaleString(),
            icon: Users,
            color: "blue",
            change: "Total registered accounts",
        },
        {
            label: "Active Users (30d)",
            value: stats.platformOverview.activeUsers.toLocaleString(),
            icon: TrendingUp,
            color: "emerald",
            change: "Logged in recently",
        },
        {
            label: "Total RevenueEstimate",
            value: `₦${(stats.platformOverview.totalRevenue / 1000000).toFixed(1)}M`,
            icon: DollarSign,
            color: "purple",
            change: "Based on transaction volume",
        },
        {
            label: "Pending Escrows",
            value: stats.counts.pendingEscrows,
            icon: Package,
            color: "amber",
            change: "Requires attention",
        },
        {
            label: "Active Land Listings",
            value: stats.counts.activeLandListings,
            icon: FileText,
            color: "indigo",
            change: "Verified listings",
        },
        {
            label: "Pending Loans",
            value: stats.counts.pendingLoans,
            icon: AlertCircle,
            color: "red",
            change: "Requires review",
        },
        {
            label: "Recent Activity",
            value: stats.recentTransactions.length,
            icon: GraduationCap,
            color: "cyan",
            change: "Actions in last 24h",
        },
    ];

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Admin Dashboard
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Platform overview and key metrics
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
                    {statCards.map((stat, index) => {
                        const Icon = stat.icon;
                        const colorMap = {
                            blue: "bg-blue-500",
                            emerald: "bg-emerald-500",
                            purple: "bg-purple-500",
                            amber: "bg-amber-500",
                            indigo: "bg-indigo-500",
                            red: "bg-red-500",
                            cyan: "bg-cyan-500",
                        };

                        return (
                            <div
                                key={index}
                                className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm hover:shadow-md transition"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div
                                        className={`p-3 rounded-lg ${colorMap[stat.color as keyof typeof colorMap]
                                            } bg-opacity-10`}
                                    >
                                        <Icon
                                            className={`w-6 h-6 ${stat.color === "blue"
                                                ? "text-blue-600"
                                                : stat.color === "emerald"
                                                    ? "text-emerald-600"
                                                    : stat.color === "purple"
                                                        ? "text-purple-600"
                                                        : stat.color === "amber"
                                                            ? "text-amber-600"
                                                            : stat.color === "indigo"
                                                                ? "text-indigo-600"
                                                                : stat.color === "red"
                                                                    ? "text-red-600"
                                                                    : "text-cyan-600"
                                                }`}
                                        />
                                    </div>
                                </div>

                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                    {stat.label}
                                </p>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                                    {stat.value}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-500">
                                    {stat.change}
                                </p>
                            </div>
                        );
                    })}
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <a
                        href="/admin/loans"
                        className="bg-white dark:bg-slate-800 rounded-lg p-6 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
                    >
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-2">
                            Review Loans
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            {stats.counts.pendingLoans} pending applications
                        </p>
                    </a>

                    <a
                        href="/admin/land-verification"
                        className="bg-white dark:bg-slate-800 rounded-lg p-6 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
                    >
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-2">
                            Verify Land Listings
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Review pending submissions
                        </p>
                    </a>
                </div>
            </div>
        </div>
    );
}
