/**
 * Marketplace Seller Dashboard
 * 
 * Main dashboard for sellers with sales analytics, orders, and product metrics
 */

"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { MarketplaceErrorBoundary } from "@/components/marketplace/MarketplaceErrorBoundary";
import { logger } from '@/lib/logger';
import { Package, DollarSign, ShoppingCart, TrendingUp, AlertCircle, Eye, Clock, CheckCircle, Loader2, Wallet, Zap, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { getSellerAnalyticsAction, getSellerOrdersAction, getSellerProductsAction } from "@/app/actions/marketplace";
import { getFeatureTogglesAction } from "@/app/actions/health";
import type { Order, Product } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { toDate } from "@/lib/date-utils";

export default function SellerDashboard() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalSales: 0,
        activeListings: 0,
        pendingOrders: 0,
        monthlyRevenue: 0,
        conversionRate: 0,
        averageRating: 0
    });
    const [recentOrders, setRecentOrders] = useState<Order[]>([]);
    const [topProducts, setTopProducts] = useState<Product[]>([]);
    const [toggles, setToggles] = useState<Record<string, boolean>>({});

    useEffect(() => {
        async function loadDashboardData() {
            try {
                const [analyticsRes, ordersRes, productsRes, togglesRes] = await Promise.all([
                    getSellerAnalyticsAction(),
                    getSellerOrdersAction(),
                    getSellerProductsAction(),
                    getFeatureTogglesAction()
                ]);

                if (togglesRes.success && togglesRes.data) {
                    setToggles(togglesRes.data);
                }

                if (analyticsRes.success && analyticsRes.data?.analytics) {
                    setStats(analyticsRes.data.analytics as any);
                }

                if (ordersRes.success && ordersRes.data?.orders) {
                    // Sort by date desc and take top 5
                    const sortedOrders = ordersRes.data.orders
                        .sort((a, b) => {
                            // Orders arrive from a server action, so createdAt is
                            // already an ISO string — reading .seconds off it gave
                            // NaN and made this comparator meaningless.
                            return toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime();
                        })
                        .slice(0, 5);
                    setRecentOrders(sortedOrders);
                }

                if (productsRes.success && productsRes.data?.products) {
                    // Sort by sales (orders count) desc and take top 3
                    const sortedProducts = productsRes.data.products
                        .sort((a, b) => (b.orders || 0) - (a.orders || 0))
                        .slice(0, 3);
                    setTopProducts(sortedProducts);
                }

            } catch (error) {
                logger.error("Failed to load dashboard data:", error);
            } finally {
                setLoading(false);
            }
        }

        loadDashboardData();
    }, []);

    const getOrderStatusConfig = (status: string) => {
        const configs: Record<string, { bg: string; text: string; label: string }> = {
            pending_payment: { bg: "bg-yellow-100", text: "text-yellow-700", label: "Pending Payment" },
            payment_received: { bg: "bg-blue-100", text: "text-blue-700", label: "Payment Received" },
            processing: { bg: "bg-orange-100", text: "text-orange-700", label: "Processing" },
            shipped: { bg: "bg-purple-100", text: "text-purple-700", label: "Shipped" },
            delivered: { bg: "bg-teal-100", text: "text-teal-700", label: "Delivered" },
            completed: { bg: "bg-green-100", text: "text-green-700", label: "Completed" },
            cancelled: { bg: "bg-red-100", text: "text-red-700", label: "Cancelled" },
            disputed: { bg: "bg-red-100", text: "text-red-700", label: "Disputed" }
        };
        return configs[status] || configs.pending_payment;
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <MarketplaceErrorBoundary>
            <div className="min-h-screen bg-slate-50">
                {/* Header */}
                <div className="bg-white border-b border-slate-200">
                    <div className="max-w-7xl mx-auto px-8 py-6 flex items-center justify-between">
                        <div className="flex flex-col gap-2">
                            <Link
                                href="/dashboard"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                                Back to Dashboard
                            </Link>
                            <div>
                                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                                    Seller Dashboard
                                </h1>
                                <p className="text-slate-600">
                                    Manage your products, orders, and track your sales performance
                                </p>
                            </div>
                        </div>
                        <Link
                            href="/marketplace/buyer/dashboard"
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-200 transition"
                        >
                            <ShoppingCart className="w-4 h-4" />
                            Switch to Buyer View
                        </Link>
                    </div>
                </div>

                <div className="max-w-7xl mx-auto px-8 py-8">
                    {/* ... stats grid ... */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                        {/* ... */}
                        <div className="bg-white rounded-xl p-6 border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 rounded-xl bg-linear-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-200">
                                    <DollarSign className="w-6 h-6" />
                                </div>
                                <span className="text-xs text-green-600 font-semibold">
                                    {stats.monthlyRevenue > 0 ? "+" : ""}
                                    {formatCurrency(stats.monthlyRevenue)}/mo
                                </span>
                            </div>
                            <div className="text-3xl font-bold text-slate-900 mb-1">
                                {formatCurrency(stats.totalSales)}
                            </div>
                            <div className="text-sm text-slate-600">Total Sales</div>
                        </div>

                        <div className="bg-white rounded-xl p-6 border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 rounded-xl bg-linear-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white shadow-lg shadow-blue-200">
                                    <Package className="w-6 h-6" />
                                </div>
                            </div>
                            <div className="text-3xl font-bold text-slate-900 mb-1">
                                {stats.activeListings}
                            </div>
                            <div className="text-sm text-slate-600">Active Listings</div>
                        </div>

                        <div className="bg-white rounded-xl p-6 border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 rounded-xl bg-linear-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white shadow-lg shadow-orange-200">
                                    <ShoppingCart className="w-6 h-6" />
                                </div>
                            </div>
                            <div className="text-3xl font-bold text-slate-900 mb-1">
                                {stats.pendingOrders}
                            </div>
                            <div className="text-sm text-slate-600">Pending Orders</div>
                        </div>

                        <div className="bg-white rounded-xl p-6 border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 rounded-xl bg-linear-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-purple-200">
                                    <TrendingUp className="w-6 h-6" />
                                </div>
                            </div>
                            <div className="text-3xl font-bold text-slate-900 mb-1">
                                {stats.averageRating.toFixed(1)}
                            </div>
                            <div className="text-sm text-slate-600">Average Rating</div>
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                        <Link
                            href="/marketplace/sell/create"
                            className="bg-linear-to-br from-green-600 to-emerald-600 text-white rounded-xl p-5 hover:shadow-lg transition-shadow"
                        >
                            <Package className="w-7 h-7 mb-2" />
                            <h3 className="text-sm font-bold mb-0.5">Add Product</h3>
                            <p className="text-xs text-green-100">List a new product</p>
                        </Link>

                        <Link
                            href="/marketplace/sell"
                            className="bg-linear-to-br from-blue-600 to-cyan-600 text-white rounded-xl p-5 hover:shadow-lg transition-shadow"
                        >
                            <Clock className="w-7 h-7 mb-2" />
                            <h3 className="text-sm font-bold mb-0.5">My Listings</h3>
                            <p className="text-xs text-blue-100">Manage products</p>
                        </Link>

                        {toggles.wallet_withdrawals && (
                            <Link
                                href="/dashboard/wallet"
                                className="bg-linear-to-br from-amber-500 to-orange-600 text-white rounded-xl p-5 hover:shadow-lg transition-shadow"
                            >
                                <Wallet className="w-7 h-7 mb-2" />
                                <h3 className="text-sm font-bold mb-0.5">Wallet</h3>
                                <p className="text-xs text-amber-100">Balance & withdrawals</p>
                            </Link>
                        )}

                        <Link
                            href="/marketplace/village-market/seller"
                            className="bg-linear-to-br from-orange-500 to-red-500 text-white rounded-xl p-5 hover:shadow-lg transition-shadow"
                        >
                            <Zap className="w-7 h-7 mb-2" />
                            <h3 className="text-sm font-bold mb-0.5">Village Market</h3>
                            <p className="text-xs text-orange-100">Flash sales hub</p>
                        </Link>

                        <Link
                            href="/marketplace/seller"
                            className="bg-linear-to-br from-purple-600 to-pink-600 text-white rounded-xl p-5 hover:shadow-lg transition-shadow"
                        >
                            <TrendingUp className="w-7 h-7 mb-2" />
                            <h3 className="text-sm font-bold mb-0.5">Analytics</h3>
                            <p className="text-xs text-purple-100">Track performance</p>
                        </Link>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Recent Orders */}
                        <div className="lg:col-span-2">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-2xl font-bold text-slate-900">
                                    Recent Orders
                                </h2>
                                <Link
                                    href="/marketplace/seller/orders"
                                    className="text-green-600 hover:text-green-700 font-semibold text-sm"
                                >
                                    View All →
                                </Link>
                            </div>

                            {recentOrders.length === 0 ? (
                                <div className="bg-white rounded-xl p-12 text-center border border-slate-200">
                                    <ShoppingCart className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                    <p className="text-slate-500">No orders yet</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {recentOrders.map((order) => {
                                        const statusConfig = getOrderStatusConfig(order.status);
                                        return (
                                            <div
                                                key={order.id}
                                                className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-md transition-shadow"
                                            >
                                                <div className="flex items-start justify-between mb-4">
                                                    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                                                        <ShoppingCart className="w-5 h-5 text-gray-500" />
                                                    </div>
                                                    <div className="flex-1 ml-4">
                                                        <h3 className="font-bold text-slate-900 mb-1">
                                                            Order #{order.orderNumber || order.id.slice(0, 8)}
                                                        </h3>
                                                        <p className="text-sm text-slate-600">
                                                            {order.items.length} items • {formatCurrency(order.totalAmount)}
                                                        </p>
                                                    </div>
                                                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
                                                        {statusConfig.label}
                                                    </span>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                                                    <div>
                                                        <span className="text-slate-500">Buyer:</span>
                                                        <p className="font-semibold text-slate-900">
                                                            {order.deliveryAddress?.recipientName || "Unknown Buyer"}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-500">Items:</span>
                                                        <p className="font-semibold text-slate-900 truncate">
                                                            {order.items.map(i => i.productTitle).join(", ")}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex gap-2">
                                                    <Link
                                                        href={`/marketplace/seller/orders/${order.id}`}
                                                        className="flex-1 py-2 bg-blue-600 text-white text-center rounded-lg font-semibold hover:bg-blue-700 text-sm"
                                                    >
                                                        View Details
                                                    </Link>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Top Products */}
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Top Products
                            </h2>

                            {topProducts.length === 0 ? (
                                <div className="bg-white rounded-xl p-12 text-center border border-slate-200">
                                    <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                    <p className="text-slate-500">No products yet</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {topProducts.map((product, index) => (
                                        <div
                                            key={product.id}
                                            className="bg-white rounded-xl p-5 border border-slate-200"
                                        >
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-2xl font-bold text-slate-400">#{index + 1}</span>
                                                        <h3 className="font-bold text-slate-900 line-clamp-1">
                                                            {product.title}
                                                        </h3>
                                                    </div>
                                                </div>
                                                {product.status === "out_of_stock" && (
                                                    <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">
                                                        Out of Stock
                                                    </span>
                                                )}
                                            </div>

                                            <div className="space-y-2 text-sm">
                                                <div className="flex justify-between">
                                                    <span className="text-slate-600">Orders:</span>
                                                    <span className="font-semibold text-slate-900">{product.orders || 0}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-slate-600">Stock:</span>
                                                    <span className={`font-semibold ${product.availableQuantity < 50 ? 'text-red-600' : 'text-slate-900'}`}>
                                                        {product.availableQuantity} {product.unit}s
                                                    </span>
                                                </div>
                                            </div>

                                            <Link
                                                href={`/marketplace/seller/products/${product.id}/edit`}
                                                className="block w-full mt-4 py-2 bg-slate-100 text-slate-900 text-center rounded-lg text-sm font-semibold hover:bg-slate-200"
                                            >
                                                Manage Product
                                            </Link>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
                                <div className="flex items-start gap-3">
                                    <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                                    <div className="text-sm">
                                        <p className="font-semibold text-blue-900 mb-1">
                                            Seller Tip
                                        </p>
                                        <p className="text-blue-800">
                                            Keep your stock updated to avoid order cancellations.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </MarketplaceErrorBoundary>
    );
}
