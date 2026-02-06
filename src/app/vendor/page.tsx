"use client";

import { Bell, Package, DollarSign, TrendingUp, FileText } from "lucide-react";

export default function VendorDashboardPage() {
    const stats = [
        {
            label: "Active Listings",
            value: "8",
            icon: Package,
            color: "blue",
        },
        {
            label: "Total Sales",
            value: "₦2.4M",
            icon: DollarSign,
            color: "emerald",
        },
        {
            label: "Pending Orders",
            value: "12",
            icon: FileText,
            color: "amber",
        },
        {
            label: "Revenue (Month)",
            value: "₦580K",
            icon: TrendingUp,
            color: "purple",
        },
    ];

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Vendor Dashboard
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Manage your products and sales
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {stats.map((stat, index) => {
                        const Icon = stat.icon;
                        return (
                            <div
                                key={index}
                                className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className={`p-3 rounded-lg bg-${stat.color}-100 dark:bg-${stat.color}-900/20`}>
                                        <Icon className={`w-6 h-6 text-${stat.color}-600`} />
                                    </div>
                                </div>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                    {stat.label}
                                </p>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white">
                                    {stat.value}
                                </p>
                            </div>
                        );
                    })}
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <a
                        href="/vendor/overview"
                        className="bg-white dark:bg-slate-800 rounded-lg p-6 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
                    >
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-2">
                            Vendor Overview
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            View analytics and performance metrics
                        </p>
                    </a>

                    <a
                        href="/vendor/orders"
                        className="bg-white dark:bg-slate-800 rounded-lg p-6 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
                    >
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-2">
                            View Orders
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Manage pending and completed orders
                        </p>
                    </a>

                    <a
                        href="/vendor/settings"
                        className="bg-white dark:bg-slate-800 rounded-lg p-6 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
                    >
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-2">
                            Vendor Settings
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            Configure your store and preferences
                        </p>
                    </a>
                </div>
            </div>
        </div>
    );
}
