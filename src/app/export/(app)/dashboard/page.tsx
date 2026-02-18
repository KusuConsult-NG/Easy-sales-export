/**
 * Export Windows Dashboard
 * 
 * Main dashboard for verified Export Windows users
 * Shows portfolio overview, active investments, and quick actions
 */

"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import Link from "next/link";
import {
    TrendingUp,
    Package,
    DollarSign,
    Clock,
    ArrowRight,
    PieChart,
    AlertCircle,
} from "lucide-react";
import { getUserExportStatsAction, getUserExportInvestmentsAction } from "@/app/actions/export";

interface PortfolioStats {
    totalInvested: number;
    activeInvestments: number;
    totalReturns: number;
    pendingReturns: number;
}

interface ActiveInvestment {
    id: string;
    commodity: string;
    amount: number;
    expectedReturn: number;
    status: "active" | "completed" | "pending";
    daysRemaining: number;
}

export default function ExportDashboardPage() {
    const [stats, setStats] = useState<PortfolioStats>({
        totalInvested: 0,
        activeInvestments: 0,
        totalReturns: 0,
        pendingReturns: 0,
    });

    const [investments, setInvestments] = useState<ActiveInvestment[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadDashboardData() {
            try {
                const [statsResult, investmentsResult] = await Promise.all([
                    getUserExportStatsAction(),
                    getUserExportInvestmentsAction(5)
                ]);

                if (statsResult.success && statsResult.data) {
                    setStats(statsResult.data);
                }

                if (investmentsResult.success && investmentsResult.data) {
                    setInvestments(investmentsResult.data as ActiveInvestment[]);
                }
            } catch (error) {
                logger.error("Failed to load dashboard:", error);
            } finally {
                setLoading(false);
            }
        }

        loadDashboardData();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-orange-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-600">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Export Windows Dashboard
                    </h1>
                    <p className="text-slate-600">
                        Manage your export investments and track returns
                    </p>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {/* Total Invested */}
                    <div className="bg-white rounded-xl p-6 border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                                <DollarSign className="w-6 h-6 text-orange-600" />
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 mb-1">
                            ₦{stats.totalInvested.toLocaleString()}
                        </div>
                        <div className="text-sm text-slate-600">
                            Total Invested
                        </div>
                    </div>

                    {/* Active Investments */}
                    <div className="bg-white rounded-xl p-6 border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                                <Package className="w-6 h-6 text-blue-600" />
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 mb-1">
                            {stats.activeInvestments}
                        </div>
                        <div className="text-sm text-slate-600">
                            Active Investments
                        </div>
                    </div>

                    {/* Total Returns */}
                    <div className="bg-white rounded-xl p-6 border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-green-600" />
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 mb-1">
                            ₦{stats.totalReturns.toLocaleString()}
                        </div>
                        <div className="text-sm text-slate-600">
                            Total Returns
                        </div>
                    </div>

                    {/* Pending Returns */}
                    <div className="bg-white rounded-xl p-6 border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
                                <Clock className="w-6 h-6 text-amber-600" />
                            </div>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 mb-1">
                            ₦{stats.pendingReturns.toLocaleString()}
                        </div>
                        <div className="text-sm text-slate-600">
                            Pending Returns
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Active Investments */}
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-xl border border-slate-200">
                            <div className="p-6 border-b border-slate-200">
                                <h2 className="text-xl font-bold text-slate-900">
                                    Active Investments
                                </h2>
                            </div>
                            <div className="p-6">
                                <div className="space-y-4">
                                    {investments.map((investment) => (
                                        <div
                                            key={investment.id}
                                            className="p-4 border border-slate-200 rounded-lg hover:border-orange-300 transition-colors"
                                        >
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex-1">
                                                    <h3 className="font-semibold text-slate-900 mb-1">
                                                        {investment.commodity}
                                                    </h3>
                                                    <p className="text-sm text-slate-600">
                                                        Investment: ₦{investment.amount.toLocaleString()}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-sm font-medium text-green-600">
                                                        +₦{investment.expectedReturn.toLocaleString()}
                                                    </div>
                                                    <div className="text-xs text-slate-500">Expected Return</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-sm text-slate-600">
                                                    <Clock className="w-4 h-4" />
                                                    {investment.daysRemaining} days remaining
                                                </div>
                                                <Link
                                                    href={`/export/investments/${investment.id}`}
                                                    className="text-sm text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
                                                >
                                                    View Details
                                                    <ArrowRight className="w-4 h-4" />
                                                </Link>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {investments.length === 0 && (
                                    <div className="text-center py-12">
                                        <Package className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                                        <p className="text-slate-600 mb-4">
                                            No active investments yet
                                        </p>
                                        <Link
                                            href="/export/opportunities"
                                            className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold"
                                        >
                                            Browse Opportunities
                                            <ArrowRight className="w-5 h-5" />
                                        </Link>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Quick Actions & Info */}
                    <div className="space-y-6">
                        {/* Quick Actions */}
                        <div className="bg-white rounded-xl border border-slate-200 p-6">
                            <h3 className="font-bold text-slate-900 mb-4">
                                Quick Actions
                            </h3>
                            <div className="space-y-3">
                                <Link
                                    href="/export/opportunities"
                                    className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:border-orange-300 transition-colors"
                                >
                                    <Package className="w-5 h-5 text-orange-600" />
                                    <span className="text-sm font-medium text-slate-900">
                                        Browse Opportunities
                                    </span>
                                    <ArrowRight className="w-4 h-4 ml-auto text-slate-400" />
                                </Link>
                                <Link
                                    href="/export/portfolio"
                                    className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:border-orange-300 transition-colors"
                                >
                                    <PieChart className="w-5 h-5 text-blue-600" />
                                    <span className="text-sm font-medium text-slate-900">
                                        View Portfolio
                                    </span>
                                    <ArrowRight className="w-4 h-4 ml-auto text-slate-400" />
                                </Link>
                                <Link
                                    href="/export/transactions"
                                    className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:border-orange-300 transition-colors"
                                >
                                    <Clock className="w-5 h-5 text-green-600" />
                                    <span className="text-sm font-medium text-slate-900">
                                        Transaction History
                                    </span>
                                    <ArrowRight className="w-4 h-4 ml-auto text-slate-400" />
                                </Link>
                            </div>
                        </div>

                        {/* Info Banner */}
                        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 p-8">
                            <h3 className="font-bold mb-2">New Opportunities Available</h3>
                            <p className="text-sm text-orange-50 mb-4">
                                3 new export windows are now open for investment. Explore premium
                                opportunities with up to 22% ROI.
                            </p>
                            <Link
                                href="/export/opportunities"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-white text-orange-600 rounded-lg hover:bg-orange-50 transition-colors font-semibold text-sm"
                            >
                                View Now
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
