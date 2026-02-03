"use client";

import { TrendingUp, TrendingDown, DollarSign, Package } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function DashboardPage() {
    const stats = [
        {
            label: "Savings Balance",
            value: formatCurrency(1450000),
            change: "+12.5%",
            trend: "up",
            icon: "💰",
        },
        {
            label: "Active Loans",
            value: formatCurrency(320000),
            change: "Next: 14 Oct",
            trend: "neutral",
            icon: "💳",
        },
        {
            label: "Export Slots",
            value: "08 Active",
            change: "70% funded",
            trend: "up",
            icon: "📦",
        },
        {
            label: "Members Invited",
            value: "24 Active",
            change: "+6 this month",
            trend: "up",
            icon: "👥",
        },
    ];

    const exportWindows = [
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
        },
    ];

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

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {stats.map((stat, index) => (
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
                                            : stat.trend === "down"
                                                ? "text-red-600 bg-red-50 dark:bg-red-900/20"
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

                {/* Export Windows */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                            Active Export Windows
                        </h2>
                        <a
                            href="/export"
                            className="text-primary font-semibold hover:underline"
                        >
                            View All
                        </a>
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
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                    </div>
                </div>
            </div>
        </div>
    );
}
