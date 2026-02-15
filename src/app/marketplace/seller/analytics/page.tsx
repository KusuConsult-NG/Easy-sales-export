/**
 * Seller Analytics Dashboard
 * 
 * Detailed performance metrics for sellers
 */

"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import {
    BarChart3,
    TrendingUp,
    Users,
    ShoppingBag,
    DollarSign,
    CreditCard,
    Calendar,
    ArrowUpRight,
    ArrowDownRight,
    Loader2
} from "lucide-react";
import Link from "next/link";
import { getSellerAnalyticsAction } from "@/app/actions/marketplace";
import { formatCurrency } from "@/lib/utils";

export default function SellerAnalyticsPage() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalSales: 0,
        activeListings: 0,
        pendingOrders: 0,
        monthlyRevenue: 0,
        conversionRate: 0,
        averageRating: 0
    });

    useEffect(() => {
        async function loadAnalytics() {
            try {
                const result = await getSellerAnalyticsAction();
                if (result.success && result.analytics) {
                    setStats(result.analytics);
                }
            } catch (error) {
                logger.error("Failed to load analytics:", error);
            } finally {
                setLoading(false);
            }
        }
        loadAnalytics();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-8 px-4 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <div className="max-w-7xl mx-auto px-8 py-6">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Analytics Overview
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Track your sales, revenue, and store performance
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-8">
                {/* Key Metrics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {/* Total Revenue */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <DollarSign className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                            <span className="flex items-center text-sm font-semibold text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-lg">
                                <ArrowUpRight className="w-4 h-4 mr-1" />
                                +12.5%
                            </span>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Total Sales</p>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                            {formatCurrency(stats.totalSales)}
                        </h3>
                    </div>

                    {/* Monthly Revenue */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <Calendar className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <span className="flex items-center text-sm font-semibold text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-lg">
                                <ArrowUpRight className="w-4 h-4 mr-1" />
                                +8.2%
                            </span>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">This Month</p>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                            {formatCurrency(stats.monthlyRevenue)}
                        </h3>
                    </div>

                    {/* Total Orders */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <ShoppingBag className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <span className="flex items-center text-sm font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg">
                                0%
                            </span>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Pending Orders</p>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                            {stats.pendingOrders}
                        </h3>
                    </div>

                    {/* Active Listings */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                                <BarChart3 className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                            </div>
                            <span className="flex items-center text-sm font-semibold text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-lg">
                                <ArrowUpRight className="w-4 h-4 mr-1" />
                                +2
                            </span>
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Active Listings</p>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                            {stats.activeListings}
                        </h3>
                    </div>
                </div>

                {/* Additional Stats */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Performance Metrics</h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <TrendingUp className="w-5 h-5 text-green-600" />
                                    <span className="font-medium text-slate-900 dark:text-white">Conversion Rate</span>
                                </div>
                                <span className="font-bold text-slate-900 dark:text-white">{stats.conversionRate}%</span>
                            </div>
                            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Users className="w-5 h-5 text-blue-600" />
                                    <span className="font-medium text-slate-900 dark:text-white">Average Rating</span>
                                </div>
                                <span className="font-bold text-slate-900 dark:text-white">{stats.averageRating.toFixed(1)} / 5.0</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-linear-to-br from-green-600 to-emerald-700 rounded-xl p-8 text-white">
                        <h3 className="text-2xl font-bold mb-4">Boost Your Sales</h3>
                        <p className="text-green-100 mb-6">
                            Sellers with complete profiles and high-quality product images see 3x more sales on average.
                        </p>
                        <div className="flex flex-col gap-3">
                            <Link
                                href="/marketplace/sell/create"
                                className="bg-white text-green-700 text-center py-3 rounded-lg font-bold hover:bg-green-50 transition-colors"
                            >
                                Add New Product
                            </Link>
                            <Link
                                href="/settings/profile"
                                className="bg-green-700 bg-opacity-50 text-white text-center py-3 rounded-lg font-bold hover:bg-opacity-70 transition-colors border border-green-400"
                            >
                                Optimize Profile
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
