"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import {
    Users,
    TrendingUp,
    DollarSign,
    Wallet,
    Activity,
    FileText,
    Loader2,
    AlertTriangle,
    ArrowUp,
    ArrowDown,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { formatDateOrDash } from "@/lib/date-utils";
import {
    getCooperativeStatsAction,
    getContributionReportsAction,
    getRecentActivityAction,
} from "@/app/actions/cooperative";
import dynamic from "next/dynamic";

const DashboardLineChart = dynamic(() => import("@/components/admin/DashboardLineChart"), {
    ssr: false,
    loading: () => (
        <div className="flex flex-col items-center justify-center py-10 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400 mb-2" />
            <span className="text-gray-500 text-sm">Loading chart...</span>
        </div>
    )
});
import Link from "next/link";
import { statText, statMoney, statValueClass } from "@/lib/admin-stat-display";

export default function AdminCooperativeDashboardPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [statsFailed, setStatsFailed] = useState(false);
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

            /*
             *   #822 A FAILED READ WAS DRAWN AS A REAL COOPERATIVE WITH NO
             *   MEMBERS AND NO MONEY.
             *
             *   `stats` stayed null on failure and every tile below read
             *   `stats?.x || 0` — so an outage or a permission refusal rendered
             *   0 members, 0 applications and ₦0 contributions. That is not a
             *   blank screen an admin would question; it is a plausible,
             *   catastrophic answer.
             */
            if (statsRes.success && statsRes.data?.stats) {
                setStats(statsRes.data.stats);
                setStatsFailed(false);
            } else {
                setStatsFailed(true);
            }

            if (reportsRes.success && reportsRes.data?.reports) {
                setReports(reportsRes.data.reports);
            }

            if (activityRes.success && activityRes.data?.activities) {
                setActivities(activityRes.data.activities);
            }
        } catch (error) {
            logger.error("Failed to load dashboard:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {

        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    /*
     *   #822 ONE PLACE THAT DECIDES WHAT AN UNREADABLE FIGURE LOOKS LIKE.
     *
     *   Twelve tiles read `stats?.x || 0`, so a failed read drew a real
     *   cooperative with no members and no money. These two helpers make
     *   the unknown case look unknown, and they are the only place that
     *   choice is made — twelve separate ternaries is how the next one
     *   gets forgotten.
     */
    const num = (v: unknown) => statText(v, statsFailed);
    const money = (v: unknown) => statMoney(v, formatCurrency, statsFailed);

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        Cooperative Dashboard
                    </h1>
                    <p className="text-gray-600">
                        Overview of cooperative activities and performance
                    </p>
                </div>

                {/*
                  *   #822 THE TWO THINGS A NUMBER ON THIS SCREEN CAN FAIL TO BE.
                  *
                  *   UNREADABLE — the tiles show "—" rather than 0, and this
                  *   says why. A cooperative with no members and no money is a
                  *   plausible answer, which is exactly what made the old ₦0
                  *   dangerous: nobody questions it.
                  *
                  *   PARTIAL — _coop_admin_reports already returns `truncated`
                  *   "so a partial total must be distinguishable from a complete
                  *   one", and NOTHING READ IT. A partial Total Contributions
                  *   was drawn identically to a complete one.
                  */}
                {statsFailed && (
                    <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                        <div className="text-sm text-red-900">
                            <p className="font-semibold">These figures could not be read.</p>
                            <p className="mt-1">
                                The totals below are shown as &mdash; rather than zero, because zero
                                would look like a real answer. Refresh, and if it persists the
                                cooperative reporting query needs looking at.
                            </p>
                        </div>
                    </div>
                )}

                {!statsFailed && stats?.truncated && (
                    <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-sm text-amber-900">
                            <p className="font-semibold">These totals are partial.</p>
                            <p className="mt-1">
                                More transactions or loans matched than the report reads in one
                                pass, so the money figures below are a floor rather than the
                                whole sum.
                            </p>
                        </div>
                    </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                    {/* Total Members */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                                <Users className="w-6 h-6 text-blue-600" />
                            </div>
                            <Link
                                href="/admin/cooperatives/members"
                                className="text-sm text-blue-600 hover:underline"
                            >
                                View all
                            </Link>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">Paid Members</p>
                        <p className="text-3xl font-bold text-gray-900">
                            {num(stats?.paidMembers)}
                            <span className="text-lg font-medium text-gray-400 ml-2">/ {num(stats?.totalMembers)} Apps</span>
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-sm">
                            <span className="text-green-600">Active: {num(stats?.activeMembers)}</span>
                            <span className="text-yellow-600">Pending: {num(stats?.pendingMembers)}</span>
                        </div>
                    </div>

                    {/* Total Contributions */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-green-600" />
                            </div>
                            <Link
                                href="/admin/cooperatives/contributions"
                                className="text-sm text-green-600 hover:underline"
                            >
                                Details
                            </Link>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">Total Contributions</p>
                        {/*
                          *   #843 The size follows the VALUE. A cooperative's
                          *   contributions total is the figure most likely to
                          *   outgrow its tile, and a money amount that breaks or
                          *   overflows can be read as the wrong number.
                          */}
                        <p className={`${statValueClass(money(stats?.totalContributions))} font-bold text-gray-900 tabular-nums`}>
                            {money(stats?.totalContributions)}
                        </p>
                        <div className="flex items-center gap-1 mt-2 text-sm">
                            <span className="text-gray-600">This month:</span>
                            <span className="font-semibold text-green-600">
                                {money(stats?.monthlyContributions)}
                            </span>
                        </div>
                    </div>

                    {/* Active Loans */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                                <DollarSign className="w-6 h-6 text-purple-600" />
                            </div>
                            <Link
                                href="/admin/cooperatives/loans"
                                className="text-sm text-purple-600 hover:underline"
                            >
                                Manage
                            </Link>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">Active Loans</p>
                        <p className="text-3xl font-bold text-gray-900">
                            {num(stats?.activeLoans)}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-sm">
                            <span className="text-yellow-600">Pending: {num(stats?.pendingLoans)}</span>
                            <span className="text-gray-600">Total: {money(stats?.totalLoans)}</span>
                        </div>
                    </div>

                    {/* Total Savings */}
                    <Link
                        href="/admin/cooperatives/contributions"
                        className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                                <Wallet className="w-6 h-6 text-indigo-600" />
                            </div>
                            <span className="text-xs text-indigo-600 font-semibold">View details →</span>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">Total Savings</p>
                        <p className={`${statValueClass(money(stats?.totalSavings))} font-bold text-gray-900 tabular-nums`}>
                            {money(stats?.totalSavings)}
                        </p>
                        <p className="text-sm text-gray-600 mt-2">Fixed savings deposits</p>
                    </Link>

                    {/* Monthly Growth */}
                    <Link
                        href="/admin/cooperatives/transactions"
                        className="bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                                <Activity className="w-6 h-6 text-emerald-600" />
                            </div>
                            <span className="text-xs text-emerald-600 font-semibold">View transactions →</span>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">Monthly Growth</p>
                        <div className="flex items-center gap-2">
                            <p className="text-3xl font-bold text-gray-900">
                                {stats?.monthlyGrowth?.toFixed(1) || 0}%
                            </p>
                            {stats?.monthlyGrowth >= 0 ? (
                                <ArrowUp className="w-6 h-6 text-green-600" />
                            ) : (
                                <ArrowDown className="w-6 h-6 text-red-600" />
                            )}
                        </div>
                        <p className="text-sm text-gray-600 mt-2">vs. previous month</p>
                    </Link>

                    {/* Transactions */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                                <FileText className="w-6 h-6 text-orange-600" />
                            </div>
                            <Link
                                href="/admin/cooperatives/transactions"
                                className="text-sm text-orange-600 hover:underline"
                            >
                                View all
                            </Link>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">Recent Activity</p>
                        <p className="text-3xl font-bold text-gray-900">
                            {activities.length}
                        </p>
                        <p className="text-sm text-gray-600 mt-2">
                            Last 10 transactions
                        </p>
                    </div>
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Contribution Trend */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <h2 className="text-xl font-bold text-gray-900 mb-4">
                            Contribution Trend
                        </h2>
                        {reports?.monthlyTrend && reports.monthlyTrend.length > 0 ? (
                            <DashboardLineChart monthlyTrend={reports.monthlyTrend} />
                        ) : (
                            <div className="flex flex-col items-center justify-center py-10 text-center">
                                <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mb-3">
                                    <TrendingUp className="w-6 h-6 text-emerald-400" />
                                </div>
                                <p className="text-gray-700 font-medium text-sm">No contribution data yet</p>
                                <p className="text-gray-400 text-xs mt-1 max-w-[220px]">
                                    The monthly trend chart will populate once members start making contributions.
                                </p>
                                {stats?.totalMembers > 0 && (
                                    <p className="text-xs text-emerald-600 font-semibold mt-3">
                                        {stats.paidMembers} paid member{stats.paidMembers !== 1 ? 's' : ''} registered
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Recent Activity */}
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <h2 className="text-xl font-bold text-gray-900 mb-4">
                            Recent Activity
                        </h2>
                        <div className="space-y-3 max-h-64 overflow-y-auto">
                            {activities.length > 0 ? (
                                activities.map((activity, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                    >
                                        <div>
                                            <p className="font-semibold text-gray-900 capitalize">
                                                {activity.type}
                                            </p>
                                            <p className="text-sm text-gray-600">
                                                {activity.description}
                                            </p>
                                        </div>
                                        <p className="text-xs text-gray-500">
                                            {/* #604 — same "Invalid Date" as the system-log screen. */}
                                            {formatDateOrDash(activity.timestamp, { dateStyle: "medium" })}
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
                        className="bg-linear-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition"
                    >
                        <Users className="w-8 h-8 mb-3" />
                        <h3 className="text-lg font-bold mb-2">Manage Members</h3>
                        <p className="text-sm text-blue-100">View and manage all cooperative members</p>
                    </Link>

                    <Link
                        href="/admin/cooperatives/transactions"
                        className="bg-linear-to-br from-green-600 to-green-700 text-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition"
                    >
                        <FileText className="w-8 h-8 mb-3" />
                        <h3 className="text-lg font-bold mb-2">View Transactions</h3>
                        <p className="text-sm text-green-100">Monitor all cooperative transactions</p>
                    </Link>

                    <Link
                        href="/admin/cooperatives/loans"
                        className="bg-linear-to-br from-purple-600 to-purple-700 text-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition"
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
