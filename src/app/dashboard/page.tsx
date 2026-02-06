"use client";

import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, DollarSign, Package, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import RevenueChart from "@/components/features/RevenueChart";
import CommodityPieChart from "@/components/features/CommodityPieChart";
import ActivityFeed from "@/components/features/ActivityFeed";
import OnboardingTour from "@/components/OnboardingTour";
import {
    getDashboardStatsAction,
    getRecentActivityAction,
    getEscrowStatusAction,
    type DashboardStats,
    type RecentActivity,
    type EscrowStatus
} from "@/app/actions/dashboard";

export default function DashboardPage() {
    const [exportFilter, setExportFilter] = useState<"all" | "active" | "completed">("all");
    const [isLoading, setIsLoading] = useState(true);
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [recentActivity, setRecentActivity] = useState<RecentActivity>([]);
    const [escrowStatus, setEscrowStatus] = useState<EscrowStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showOnboarding, setShowOnboarding] = useState(false);

    // Fetch dashboard data on mount
    useEffect(() => {
        const fetchDashboardData = async () => {
            setIsLoading(true);
            setError(null);

            try {
                const [statsResult, activityResult, escrowResult] = await Promise.all([
                    getDashboardStatsAction(),
                    getRecentActivityAction(),
                    getEscrowStatusAction(),
                ]);

                if (statsResult.success && statsResult.data) {
                    setStats(statsResult.data);

                    // Check if user has completed onboarding
                    if (statsResult.data.onboardingCompleted === false) {
                        setShowOnboarding(true);
                    }
                } else {
                    setError(statsResult.error || "Failed to load stats");
                }

                if (activityResult.success && activityResult.data) {
                    setRecentActivity(activityResult.data);
                }

                if (escrowResult.success && escrowResult.data) {
                    setEscrowStatus(escrowResult.data);
                }
            } catch (err) {
                console.error("Dashboard fetch error:", err);
                setError("Failed to load dashboard data");
            } finally {
                setIsLoading(false);
            }
        };

        fetchDashboardData();
    }, []);

    // Display stats cards based on real data
    const displayStats = stats ? [
        {
            label: "Total Exports",
            value: stats.totalExports.toString(),
            change: `${stats.activeOrders} active`,
            trend: stats.activeOrders > 0 ? "up" as const : "neutral" as const,
            icon: "📦",
        },
        {
            label: "Escrow Balance",
            value: formatCurrency(stats.totalEscrow),
            change: escrowStatus?.nextReleaseDate
                ? `Next: ${new Date(escrowStatus.nextReleaseDate).toLocaleDateString()}`
                : "No pending",
            trend: stats.totalEscrow > 0 ? "up" as const : "neutral" as const,
            icon: "💰",
        },
        {
            label: "Cooperative Savings",
            value: formatCurrency(stats.cooperativeSavings),
            change: stats.cooperativeSavings > 0 ? "Active member" : "Not a member",
            trend: stats.cooperativeSavings > 0 ? "up" as const : "neutral" as const,
            icon: "🏦",
        },
        {
            label: "Academy Courses",
            value: stats.academyEnrollments.toString(),
            change: stats.academyEnrollments > 0 ? "Enrolled" : "Get started",
            trend: stats.academyEnrollments > 0 ? "up" as const : "neutral" as const,
            icon: "🎓",
        },
    ] : [];

    const allExportWindows = [
        {
            id: "1",
            commodity: "Yam Tubers Export - Phase 2",
            destination: "UK",
            roi: "22%",
            target: 150000000,
            funded: 117000000,
            percentage: 78,
            daysLeft: 4,
            icon: "🌾",
            status: "active" as const,
        },
        {
            id: "2",
            commodity: "Sesame Seeds Export",
            destination: "Dubai",
            roi: "20%",
            target: 80000000,
            funded: 25600000,
            percentage: 32,
            daysLeft: 12,
            icon: "🌰",
            status: "active" as const,
        },
        {
            id: "3",
            commodity: "Hibiscus Export - December",
            destination: "USA",
            roi: "18%",
            target: 60000000,
            funded: 60000000,
            percentage: 100,
            daysLeft: 0,
            icon: "🌺",
            status: "completed" as const,
        },
    ];

    const exportWindows = allExportWindows.filter((window) => {
        if (exportFilter === "active") return window.status === "active";
        if (exportFilter === "completed") return window.status === "completed";
        return true;
    });

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="p-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Welcome back!
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Here's what's happening with your investments today.
                    </p>
                </div>

                {/* Loading State */}
                {isLoading && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <span className="ml-3 text-slate-600 dark:text-slate-400">Loading dashboard...</span>
                    </div>
                )}

                {/* Error State */}
                {error && !isLoading && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
                        <p className="text-red-300">{error}</p>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Main Content */}
                {!isLoading && !error && stats && (
                    <>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                            {displayStats.map((stat, index) => (
                                <div
                                    key={index}
                                    className="bg-white dark:bg-slate-800 p-6 rounded-2xl elevation-2 hover-lift animate-[slideInUp_0.6s_ease-out]"
                                    style={{ animationDelay: `${index * 100}ms` }}
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="text-4xl">{stat.icon}</div>
                                        <span
                                            className={`text-xs font-medium px-2 py-1 rounded ${stat.trend === "up"
                                                ? "text-green-600 bg-green-50 dark:bg-green-900/20"
                                                : "text-slate-600 bg-slate-50 dark:bg-slate-900/20"
                                                }`}
                                        >
                                            {stat.change}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">
                                        {stat.label}
                                    </p>
                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                                        {stat.value}
                                    </h3>
                                </div>
                            ))}
                        </div>

                        {/* Analytics Charts */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                            <RevenueChart />
                            <CommodityPieChart />
                        </div>

                        {/* Recent Activity */}
                        <div className="mb-8">
                            <ActivityFeed />
                        </div>

                        {/* Export Windows */}
                        <div className="mb-8">
                            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                    Export Windows
                                </h2>
                                <div className="flex items-center gap-3">
                                    {/* Filter Tabs */}
                                    <div className="inline-flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                                        <button
                                            onClick={() => setExportFilter("all")}
                                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${exportFilter === "all"
                                                ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                                }`}
                                        >
                                            All
                                        </button>
                                        <button
                                            onClick={() => setExportFilter("active")}
                                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${exportFilter === "active"
                                                ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                                }`}
                                        >
                                            Active
                                        </button>
                                        <button
                                            onClick={() => setExportFilter("completed")}
                                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${exportFilter === "completed"
                                                ? "bg-white dark:bg-slate-700 text-primary shadow-sm"
                                                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                                }`}
                                        >
                                            Completed
                                        </button>
                                    </div>
                                    <a
                                        href="/export"
                                        className="text-primary font-semibold hover:underline"
                                    >
                                        View All
                                    </a>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {exportWindows.map((window) => (
                                    <div
                                        key={window.id}
                                        className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-primary/30 transition-colors"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-slate-100 dark:bg-slate-700 rounded-xl flex items-center justify-center text-2xl">
                                                    {window.icon}
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-slate-900 dark:text-white">
                                                        {window.commodity}
                                                    </h4>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                                        Destination: {window.destination} | ROI: {window.roi}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-accent">
                                                    Ending in {window.daysLeft} days
                                                </p>
                                                <p className="text-xs text-slate-400">
                                                    Target: {formatCurrency(window.target)}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-400">
                                                <span>{window.percentage}% Funded</span>
                                                <span>
                                                    {formatCurrency(window.funded)} /{" "}
                                                    {formatCurrency(window.target)}
                                                </span>
                                            </div>
                                            <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                <div
                                                    className="bg-primary h-full rounded-full transition-all"
                                                    style={{ width: `${window.percentage}%` }}
                                                />
                                            </div>
                                        </div>

                                        <div className="mt-6 flex items-center justify-between">
                                            <div className="text-sm text-slate-600 dark:text-slate-400">
                                                <span className="font-semibold">1,200+</span> investors
                                            </div>
                                            <button className="px-6 py-2 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-colors">
                                                Invest Now
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                                Quick Actions
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <a
                                    href="/marketplace"
                                    className="group bg-linear-to-br from-green-500 to-emerald-600 p-6 rounded-2xl text-white hover-lift elevation-2"
                                >
                                    <Package className="w-8 h-8 mb-3" />
                                    <h3 className="font-bold text-lg mb-2">Browse Marketplace</h3>
                                    <p className="text-sm text-green-50">
                                        Buy quality agricultural products
                                    </p>
                                </a>

                                <a
                                    href="/cooperatives"
                                    className="group bg-linear-to-br from-purple-500 to-indigo-600 p-6 rounded-2xl text-white hover-lift elevation-2"
                                >
                                    <TrendingUp className="w-8 h-8 mb-3" />
                                    <h3 className="font-bold text-lg mb-2">Cooperative Savings</h3>
                                    <p className="text-sm text-purple-50">
                                        View your savings and transactions
                                    </p>
                                </a>

                                <a
                                    href="/wave"
                                    className="group bg-linear-to-br from-pink-500 to-rose-600 p-6 rounded-2xl text-white hover-lift elevation-2"
                                >
                                    <DollarSign className="w-8 h-8 mb-3" />
                                    <h3 className="font-bold text-lg mb-2">Apply for WAVE</h3>
                                    <p className="text-sm text-pink-50">
                                        Get funding and training for women farmers
                                    </p>
                                </a>

                                <a
                                    href="/dashboard/digital-id"
                                    className="group bg-linear-to-br from-blue-500 to-cyan-600 p-6 rounded-2xl text-white hover-lift elevation-2"
                                >
                                    <svg className="w-8 h-8 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                                    </svg>
                                    <h3 className="font-bold text-lg mb-2">Digital Member ID</h3>
                                    <p className="text-sm text-blue-50">
                                        View and download your digital ID card
                                    </p>
                                </a>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Onboarding Tour */}
            <OnboardingTour
                isOpen={showOnboarding}
                onComplete={async () => {
                    setShowOnboarding(false);
                    // Mark onboarding as complete
                    await fetch("/api/onboarding/complete", { method: "POST" });
                }}
                userRole={stats?.cooperativeSavings ? "member" : "user"}
            />
        </div>
    );
}

