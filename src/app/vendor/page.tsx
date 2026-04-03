/**
 * Vendor Dashboard
 * Live Firestore data — sales stats, inventory, recent activity
 */

"use client";

import { useEffect, useState } from "react";
import {
    Package,
    DollarSign,
    TrendingUp,
    FileText,
    Loader2,
    AlertCircle,
    ArrowRight,
    ShoppingBag,
    BarChart2,
    Settings,
    AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import {
    getVendorSalesStatsAction,
    getVendorInventoryStatsAction,
    getVendorActivityFeedAction,
} from "@/app/actions/vendor-dashboard";

function formatCurrency(amount: number) {
    if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000)     return `₦${(amount / 1_000).toFixed(1)}K`;
    return `₦${amount.toLocaleString()}`;
}

export default function VendorDashboardPage() {
    const [salesStats,    setSalesStats]    = useState<any>(null);
    const [inventory,     setInventory]     = useState<any>(null);
    const [activities,    setActivities]    = useState<any[]>([]);
    const [loading,       setLoading]       = useState(true);
    const [error,         setError]         = useState<string | null>(null);

    useEffect(() => {
        Promise.all([
            getVendorSalesStatsAction(),
            getVendorInventoryStatsAction(),
            getVendorActivityFeedAction(5),
        ])
            .then(([sales, inv, feed]) => {
                if (sales.success) setSalesStats((sales as any).stats);
                if (inv.success)   setInventory((inv as any).stats);
                if (feed.success)  setActivities((feed as any).activities ?? []);
                if (!sales.success && !inv.success) {
                    setError((sales as any).error ?? "Failed to load stats");
                }
            })
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    const statCards = [
        {
            label: "Active Listings",
            value: loading ? "…" : `${inventory?.activeProducts ?? 0}`,
            icon: Package,
            color: "blue",
            subtext: loading ? "" : `${inventory?.totalProducts ?? 0} total`,
        },
        {
            label: "Total Sales",
            value: loading ? "…" : formatCurrency(salesStats?.allTime?.revenue ?? 0),
            icon: DollarSign,
            color: "emerald",
            subtext: loading ? "" : `${salesStats?.allTime?.orders ?? 0} orders`,
        },
        {
            label: "Pending Orders",
            value: loading ? "…" : `${salesStats?.thisWeek?.orders ?? 0}`,
            icon: FileText,
            color: "amber",
            subtext: "This week",
        },
        {
            label: "Revenue (Month)",
            value: loading ? "…" : formatCurrency(salesStats?.thisMonth?.revenue ?? 0),
            icon: TrendingUp,
            color: "purple",
            subtext: loading ? "" : `${salesStats?.thisMonth?.orders ?? 0} orders`,
        },
    ];

    const colorMap: Record<string, { bg: string; text: string; icon: string }> = {
        blue:    { bg: "bg-blue-100",    text: "text-blue-900",    icon: "text-blue-600"    },
        emerald: { bg: "bg-emerald-100", text: "text-emerald-900", icon: "text-emerald-600" },
        amber:   { bg: "bg-amber-100",   text: "text-amber-900",   icon: "text-amber-600"   },
        purple:  { bg: "bg-purple-100",  text: "text-purple-900",  icon: "text-purple-600"  },
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-12 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8 flex items-start justify-between">
                    <div>
                        <h1 className="text-4xl font-bold text-slate-900 mb-2">Vendor Dashboard</h1>
                        <p className="text-slate-600">Manage your products and sales</p>
                    </div>
                    <Link
                        href="/vendor/products/new"
                        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition"
                    >
                        <Package className="w-4 h-4" />
                        Add Product
                    </Link>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="mb-6 flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                        <AlertCircle className="w-5 h-5 shrink-0" />
                        <p className="text-sm">{error}</p>
                    </div>
                )}

                {/* Low Stock Alert */}
                {!loading && (inventory?.lowStock ?? 0) > 0 && (
                    <div className="mb-6 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        <p className="text-sm">
                            <span className="font-semibold">{inventory.lowStock} product{inventory.lowStock > 1 ? "s are" : " is"} running low on stock.</span>{" "}
                            <Link href="/vendor/products" className="underline hover:no-underline">Manage inventory →</Link>
                        </p>
                    </div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {statCards.map((stat, index) => {
                        const Icon    = stat.icon;
                        const palette = colorMap[stat.color];
                        return (
                            <div key={index} className="bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition">
                                <div className={`w-12 h-12 ${palette.bg} rounded-xl flex items-center justify-center mb-4`}>
                                    {loading
                                        ? <Loader2 className={`w-6 h-6 animate-spin ${palette.icon}`} />
                                        : <Icon className={`w-6 h-6 ${palette.icon}`} />
                                    }
                                </div>
                                <p className="text-sm text-slate-500 mb-1">{stat.label}</p>
                                <p className={`text-3xl font-bold ${loading ? "text-slate-300" : "text-slate-900"}`}>
                                    {stat.value}
                                </p>
                                {stat.subtext && (
                                    <p className="text-xs text-slate-400 mt-1">{stat.subtext}</p>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Bottom grid: Quick Actions + Activity */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Quick Actions */}
                    <div className="bg-white rounded-2xl shadow-sm p-6">
                        <h2 className="text-lg font-bold text-slate-900 mb-4">Quick Actions</h2>
                        <div className="space-y-3">
                            {[
                                { href: "/vendor/overview",  label: "Vendor Overview",  desc: "Analytics & metrics",     icon: BarChart2  },
                                { href: "/marketplace/seller/orders", label: "View Orders", desc: "Pending & completed", icon: ShoppingBag },
                                { href: "/vendor/products",  label: "My Products",      desc: "Manage listings",          icon: Package    },
                                { href: "/vendor/settings",  label: "Vendor Settings",  desc: "Store configuration",      icon: Settings   },
                            ].map((item) => {
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className="group flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                                                <Icon className="w-4 h-4 text-blue-600" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                                                <p className="text-xs text-slate-400">{item.desc}</p>
                                            </div>
                                        </div>
                                        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:translate-x-1 group-hover:text-blue-500 transition-all" />
                                    </Link>
                                );
                            })}
                        </div>
                    </div>

                    {/* Recent Activity */}
                    <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-bold text-slate-900">Recent Activity</h2>
                            <Link href="/marketplace/seller/orders" className="text-sm text-blue-600 hover:underline font-semibold">
                                View All
                            </Link>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center h-40">
                                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                            </div>
                        ) : activities.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 text-center">
                                <ShoppingBag className="w-10 h-10 text-slate-200 mb-3" />
                                <p className="text-sm text-slate-500 font-medium">No recent activity</p>
                                <p className="text-xs text-slate-400 mt-1">
                                    Orders and stock alerts will appear here
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {activities.map((activity) => (
                                    <div key={activity.id} className="py-3 flex items-start gap-3">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                                            activity.type === "order"
                                                ? "bg-blue-100"
                                                : "bg-amber-100"
                                        }`}>
                                            {activity.type === "order"
                                                ? <ShoppingBag className="w-4 h-4 text-blue-600" />
                                                : <AlertTriangle className="w-4 h-4 text-amber-600" />
                                            }
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-slate-900 truncate">
                                                {activity.title}
                                            </p>
                                            <p className="text-xs text-slate-500 truncate">
                                                {activity.description}
                                            </p>
                                        </div>
                                        <p className="text-xs text-slate-400 shrink-0">
                                            {activity.timestamp
                                                ? new Date(activity.timestamp).toLocaleDateString("en-NG", {
                                                    month: "short",
                                                    day: "numeric",
                                                })
                                                : ""}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
