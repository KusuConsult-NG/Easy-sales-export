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
} from "lucide-react";
import type { DashboardStats } from "@/app/actions/admin-analytics";

export default function AdminDashboardPage() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Mock data - in real app, fetch from API
        setStats({
            totalUsers: 1245,
            activeUsers: 892,
            totalRevenue: 5420000,
            pendingEscrows: 35,
            activeLandListings: 128,
            pendingLoans: 47,
            totalCourseEnrollments: 634,
            recentActivity: [],
        });
        setLoading(false);
    }, []);

    if (loading || !stats) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-600 dark:text-slate-400">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    const statCards = [
        {
            label: "Total Users",
            value: stats.totalUsers.toLocaleString(),
            icon: Users,
            color: "blue",
            change: "+12% from last month",
        },
        {
            label: "Active Users (30d)",
            value: stats.activeUsers.toLocaleString(),
            icon: TrendingUp,
            color: "emerald",
            change: "71.6% engagement rate",
        },
        {
            label: "Total Revenue",
            value: `₦${(stats.totalRevenue / 1000000).toFixed(1)}M`,
            icon: DollarSign,
            color: "purple",
            change: "+28% from last month",
        },
        {
            label: "Pending Escrows",
            value: stats.pendingEscrows,
            icon: Package,
            color: "amber",
            change: "Requires attention",
        },
        {
            label: "Active Land Listings",
            value: stats.activeLandListings,
            icon: FileText,
            color: "indigo",
            change: "+15 new this week",
        },
        {
            label: "Pending Loans",
            value: stats.pendingLoans,
            icon: AlertCircle,
            color: "red",
            change: "Requires review",
        },
        {
            label: "Course Enrollments",
            value: stats.totalCourseEnrollments,
            icon: GraduationCap,
            color: "cyan",
            change: "+34 this week",
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
                            {stats.pendingLoans} pending applications
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
