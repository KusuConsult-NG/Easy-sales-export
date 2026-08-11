/**
 * Farm Nation Member Dashboard
 * Live Firestore data — stats, listings, and transactions
 */

"use client";

import { useState, useEffect } from "react";
import { logger } from "@/lib/logger";
import Link from "next/link";
import {
    Sprout,
    MapPin,
    TrendingUp,
    ArrowRight,
    CheckCircle,
    Clock,
    DollarSign,
    Loader2,
    Home,
    ShieldCheck,
    AlertCircle,
    Plus,
    Eye,
    Search,
    ChevronLeft,
    ChevronDown,
} from "lucide-react";
import {
    getFarmNationDashboardStatsAction,
    type FarmNationDashboardStats,
} from "@/app/actions/farm-nation";

function formatCurrency(amount: any) {
    const value = Number(amount);
    const safeAmount = isNaN(value) ? 0 : value;
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(safeAmount);
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; cls: string }> = {
        available:         { label: "Available",         cls: "bg-green-100 text-green-700" },
        pending:           { label: "Pending Review",    cls: "bg-yellow-100 text-yellow-700" },
        sold:              { label: "Sold",              cls: "bg-blue-100 text-blue-700" },
        leased:            { label: "Leased",            cls: "bg-purple-100 text-purple-700" },
        deleted:           { label: "Removed",           cls: "bg-red-100 text-red-700" },
        pending_payment:   { label: "Awaiting Payment",  cls: "bg-yellow-100 text-yellow-700" },
        payment_confirmed: { label: "Payment Confirmed", cls: "bg-blue-100 text-blue-700" },
        completed:         { label: "Completed",         cls: "bg-green-100 text-green-700" },
        cancelled:         { label: "Cancelled",         cls: "bg-red-100 text-red-700" },
    };
    const { label, cls } = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
    return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${cls}`}>
            {label}
        </span>
    );
}

export default function FarmNationDashboard() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<FarmNationDashboardStats | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

    useEffect(() => {
        getFarmNationDashboardStatsAction()
            .then((result) => {
                if (result.success && result.data) {
                    setStats(result.data);
                } else {
                    setError(result.error ?? "Failed to load dashboard");
                }
            })
            .catch((err) => {
                logger.error("Dashboard load error:", err);
                setError("Failed to load dashboard data");
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-emerald-600 mx-auto mb-3" />
                    <p className="text-slate-500 text-sm">Loading your dashboard…</p>
                </div>
            </div>
        );
    }

    if (error || !stats) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
                <AlertCircle className="w-12 h-12 text-red-400" />
                <p className="text-slate-600">{error ?? "Something went wrong."}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition"
                >
                    Retry
                </button>
            </div>
        );
    }

    const isSeller = stats.role === "seller" || stats.role === "both";

    return (
        <div className="space-y-8">
            {/* Back to Hub Link */}
            <div className="-mb-4">
                <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700 transition"
                >
                    <ChevronLeft className="w-4 h-4" />
                    Back to Dashboard
                </Link>
            </div>

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-1">
                        Farm Nation Dashboard
                    </h1>
                    <p className="text-slate-500">
                        Manage your land acquisitions and track agricultural investments
                        <span className="ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full capitalize">
                            {stats.role}
                        </span>
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href="/farm-nation/properties"
                        className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-200 transition"
                    >
                        <Search className="w-4 h-4" />
                        Browse Land
                    </Link>
                    {isSeller && (
                        <Link
                            href="/farm-nation/list-land"
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition"
                        >
                            <Plus className="w-4 h-4" />
                            List Property
                        </Link>
                    )}
                </div>
            </div>

            {/* Stats Grid */}
            <div className="space-y-6">
                {/* Seller Section */}
                {(stats.role === "seller" || stats.role === "both") && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-emerald-600" />
                            <h2 className="text-lg font-bold text-slate-800">Seller Overview</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                <p className="text-sm text-slate-500 font-medium mb-1">Total Land Listed</p>
                                <h3 className="text-2xl font-bold text-slate-900">
                                    {stats.totalHectares > 0 ? `${stats.totalHectares.toLocaleString()} Ha` : "0 Ha"}
                                </h3>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                <p className="text-sm text-slate-500 font-medium mb-1">Active Listings</p>
                                <h3 className="text-2xl font-bold text-slate-900">{stats.activeListings} Sites</h3>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                <p className="text-sm text-slate-500 font-medium mb-1">Portfolio Value</p>
                                <h3 className="text-2xl font-bold text-slate-900">{formatCurrency(stats.portfolioValue)}</h3>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                <p className="text-sm text-slate-500 font-medium mb-1">Completed Deals</p>
                                <h3 className="text-2xl font-bold text-slate-900">{stats.completedDeals}</h3>
                            </div>
                        </div>
                    </div>
                )}

                {/* Investor Section */}
                {(stats.role === "buyer" || stats.role === "both") && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-blue-600" />
                            <h2 className="text-lg font-bold text-slate-800">Investor Overview</h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                <p className="text-sm text-slate-500 font-medium mb-1">Properties Acquired</p>
                                <h3 className="text-2xl font-bold text-slate-900">{stats.propertiesAcquired} Units</h3>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                <p className="text-sm text-slate-500 font-medium mb-1">Total Investment</p>
                                <h3 className="text-2xl font-bold text-slate-900">{formatCurrency(stats.totalInvestmentValue)}</h3>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                <p className="text-sm text-slate-500 font-medium mb-1">Pending Inquiries</p>
                                <h3 className="text-2xl font-bold text-slate-900">{stats.pendingTransactions}</h3>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 border-dashed border-blue-200 bg-blue-50/30">
                                <Link href="/farm-nation/properties" className="flex flex-col h-full justify-center">
                                    <p className="text-sm text-blue-600 font-bold flex items-center gap-1">
                                        Explore More Land <ArrowRight className="w-4 h-4" />
                                    </p>
                                </Link>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Recent Listings */}
                <div className="lg:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-slate-900">My Listings</h2>
                        <Link
                            href="/farm-nation/my-properties"
                            className="text-emerald-600 hover:text-emerald-700 font-semibold text-sm"
                        >
                            View All →
                        </Link>
                    </div>

                    {stats.recentListings.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center">
                            <Home className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                            <h3 className="font-semibold text-slate-800 mb-1">No properties listed yet</h3>
                            <p className="text-slate-500 text-sm mb-4">
                                List your first agricultural property to get started.
                            </p>
                            {isSeller && (
                                <Link
                                    href="/farm-nation/list-land"
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition"
                                >
                                    <Plus className="w-4 h-4" />
                                    List a Property
                                </Link>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {stats.recentListings.map((prop) => (
                                <div
                                    key={prop.id}
                                    className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex items-start justify-between gap-4 hover:shadow-md transition"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="w-11 h-11 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                                            <MapPin className="w-5 h-5 text-emerald-600" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="font-semibold text-slate-900 text-sm">{prop.name}</h3>
                                                {prop.verified && (
                                                    <span title="Verified">
                                                        <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500 mb-2">
                                                {typeof prop.location === "object" && prop.location
                                                    ? `${(prop.location as any).address || (prop.location as any).lga || ""}, ${(prop.location as any).state || ""}`.trim().replace(/^,\s*/, "")
                                                    : (prop.location || prop.state || "")} · {prop.size} Ha ·{" "}
                                                <span className="capitalize">{prop.type}</span>
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <StatusBadge status={prop.status} />
                                                <span className="text-xs text-slate-400">
                                                    {new Date(prop.createdAt).toLocaleDateString("en-NG", {
                                                        month: "short",
                                                        day: "numeric",
                                                        year: "numeric",
                                                    })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-sm font-bold text-emerald-700">
                                            {formatCurrency(prop.price)}
                                        </p>
                                        <Link
                                            href={`/farm-nation/properties/${prop.id}`}
                                            className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline mt-1"
                                        >
                                            <Eye className="w-3 h-3" />
                                            View
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Sidebar: Quick Actions + Recent Transactions */}
                <div className="space-y-6">
                    {/* Quick Actions */}
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 mb-4">Quick Actions</h2>
                        <div className="space-y-3">
                            {isSeller && (
                                <Link
                                    href="/farm-nation/list-land"
                                    className="group flex items-center justify-between p-4 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition"
                                >
                                    <div className="flex items-center gap-3">
                                        <Plus className="w-5 h-5" />
                                        <span className="font-semibold text-sm">List New Property</span>
                                    </div>
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </Link>
                            )}
                            <Link
                                href="/farm-nation/properties"
                                className="group flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition"
                            >
                                <div className="flex items-center gap-3">
                                    <MapPin className="w-5 h-5 text-blue-600" />
                                    <span className="font-semibold text-sm text-slate-900">Browse Listings</span>
                                </div>
                                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link
                                href="/farm-nation/my-properties"
                                className="group flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition"
                            >
                                <div className="flex items-center gap-3">
                                    <Home className="w-5 h-5 text-emerald-600" />
                                    <span className="font-semibold text-sm text-slate-900">My Properties</span>
                                </div>
                                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link
                                href="/farm-nation/my-purchases"
                                className="group flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition"
                            >
                                <div className="flex items-center gap-3">
                                    <DollarSign className="w-5 h-5 text-purple-600" />
                                    <span className="font-semibold text-sm text-slate-900">My Transactions</span>
                                </div>
                                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>
                    </div>

                    {/* Recent Transactions */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-lg font-bold text-slate-900">
                                Recent Transactions
                            </h2>
                            {stats.pendingTransactions > 0 && (
                                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-bold rounded-full">
                                    {stats.pendingTransactions} Pending
                                </span>
                            )}
                        </div>

                        {stats.recentTransactions.length === 0 ? (
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 text-center">
                                <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                                <p className="text-sm text-slate-500">No transactions yet</p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
                                {stats.recentTransactions.map((tx) => (
                                    <div
                                        key={tx.id}
                                        onClick={() => setExpandedTxId(expandedTxId === tx.id ? null : tx.id)}
                                        className="p-4 hover:bg-slate-50 transition cursor-pointer border-b border-slate-100 last:border-0"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-slate-900 truncate">
                                                    {tx.propertyName}
                                                </p>
                                                <p className="text-xs text-slate-500 capitalize mt-0.5">
                                                    {tx.propertyType} ·{" "}
                                                    {new Date(tx.createdAt).toLocaleDateString("en-NG", {
                                                        month: "short",
                                                        day: "numeric",
                                                    })}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="text-right">
                                                    <p className="text-sm font-bold text-emerald-700">
                                                        {formatCurrency(tx.amount)}
                                                    </p>
                                                    <StatusBadge status={tx.status} />
                                                </div>
                                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${expandedTxId === tx.id ? "rotate-180" : ""}`} />
                                            </div>
                                        </div>

                                        {/* Expanded details */}
                                        {expandedTxId === tx.id && (
                                            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl">
                                                <div>
                                                    <p className="text-slate-500 font-semibold mb-0.5">Request ID</p>
                                                    <p className="font-mono text-slate-800 select-all">{tx.id}</p>
                                                </div>
                                                <div>
                                                    <p className="text-slate-500 font-semibold mb-0.5">Property Type</p>
                                                    <p className="text-slate-800 capitalize font-medium">{tx.propertyType}</p>
                                                </div>
                                                <div>
                                                    <p className="text-slate-500 font-semibold mb-0.5">Date</p>
                                                    <p className="text-slate-800 font-medium">
                                                        {new Date(tx.createdAt).toLocaleString("en-NG", {
                                                            month: "short",
                                                            day: "numeric",
                                                            year: "numeric",
                                                            hour: "2-digit",
                                                            minute: "2-digit"
                                                        })}
                                                    </p>
                                                </div>
                                                <div>
                                                    <p className="text-slate-500 font-semibold mb-0.5">Escrow Status</p>
                                                    <p className="text-slate-800 capitalize font-medium">{tx.status || "N/A"}</p>
                                                </div>
                                            </div>
                                        )}
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
