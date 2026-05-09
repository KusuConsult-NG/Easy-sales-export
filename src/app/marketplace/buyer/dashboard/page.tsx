/**
 * Marketplace Buyer Dashboard
 * 
 * Main dashboard for buyers with orders, recommendations, and quick actions
 */

"use client";

export const dynamic = "force-dynamic";

import { ShoppingCart, Package, Clock, CheckCircle, Star, TrendingUp, Search, Loader2, Zap } from "lucide-react";
import { logger } from '@/lib/logger';
import { MarketplaceErrorBoundary } from "@/components/marketplace/MarketplaceErrorBoundary";
import Link from "next/link";
import { useState, useEffect } from "react";
import { getBuyerStatsAction, getBuyerOrdersAction, getRecommendedProductsAction } from "@/app/actions/marketplace";
import type { Order, Product } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { toDate, formatLocalDate } from "@/lib/date-utils";

export default function BuyerDashboard() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        activeOrders: 0,
        completedOrders: 0,
        totalSpent: 0,
        savedSellers: 0
    });
    const [recentOrders, setRecentOrders] = useState<Order[]>([]);
    const [recommendedProducts, setRecommendedProducts] = useState<any[]>([]);

    useEffect(() => {
        async function loadDashboard() {
            try {
                const [statsResult, ordersResult, recommendedResult] = await Promise.all([
                    getBuyerStatsAction(),
                    getBuyerOrdersAction(),
                    getRecommendedProductsAction(3)
                ]);

                if (statsResult.success && statsResult.data?.stats) {
                    setStats(statsResult.data.stats);
                }

                if (ordersResult.success && ordersResult.data?.orders) {
                    // Sort by newest first and take top 5
                    const sorted = ordersResult.data.orders.sort((a: any, b: any) => {
                        return toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime();
                    });
                    setRecentOrders(sorted.slice(0, 5));
                }

                if (recommendedResult.success && recommendedResult.data?.products) {
                    // Transform to match expected format
                    const transformed = recommendedResult.data.products.map((p: any) => ({
                        id: p.id,
                        name: p.title,
                        price: p.pricingTiers[0]?.price || 0,
                        unit: p.unit,
                        seller: p.sellerName || "Unknown Seller",
                        rating: p.rating || 0,
                        image: p.images[0] || "/images/logo.jpg"
                    }));
                    setRecommendedProducts(transformed);
                }
            } catch (error) {
                logger.error("Failed to load buyer dashboard:", error);
            } finally {
                setLoading(false);
            }
        }
        loadDashboard();
    }, []);

    const getStatusBadge = (status: string) => {
        const badges: Record<string, { bg: string; text: string; label: string }> = {
            pending_payment: { bg: "bg-yellow-100", text: "text-yellow-700", label: "Pending Payment" },
            payment_received: { bg: "bg-blue-100", text: "text-blue-700", label: "Paid" },
            processing: { bg: "bg-blue-100", text: "text-blue-700", label: "Processing" },
            shipped: { bg: "bg-purple-100", text: "text-purple-700", label: "Shipped" },
            in_transit: { bg: "bg-orange-100", text: "text-orange-700", label: "In Transit" },
            delivered: { bg: "bg-teal-100", text: "text-teal-700", label: "Delivered" },
            completed: { bg: "bg-green-100", text: "text-green-700", label: "Completed" },
            cancelled: { bg: "bg-red-100", text: "text-red-700", label: "Cancelled" },
            disputed: { bg: "bg-red-100", text: "text-red-700", label: "Disputed" }
        };
        return badges[status] || badges.processing;
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <MarketplaceErrorBoundary>
            <div className="min-h-screen bg-slate-50">
                {/* Header */}
                <div className="bg-white border-b border-slate-200">
                    <div className="max-w-7xl mx-auto px-8 py-6 flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 mb-2">
                                Buyer Dashboard
                            </h1>
                            <p className="text-slate-600">
                                Manage your orders and discover quality agricultural products
                            </p>
                        </div>
                        <Link
                            href="/marketplace/seller/dashboard"
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-200 transition"
                        >
                            <Zap className="w-4 h-4" />
                            Switch to Seller View
                        </Link>
                    </div>
                </div>

                <div className="max-w-7xl mx-auto px-8 py-8">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                        <div className="bg-white rounded-xl p-6 border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                                    <Clock className="w-6 h-6 text-orange-600" />
                                </div>
                            </div>
                            <div className="text-3xl font-bold text-slate-900 mb-1">
                                {stats.activeOrders}
                            </div>
                            <div className="text-sm text-slate-600">Active Orders</div>
                        </div>

                        <div className="bg-white rounded-xl p-6 border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                                    <CheckCircle className="w-6 h-6 text-green-600" />
                                </div>
                            </div>
                            <div className="text-3xl font-bold text-slate-900 mb-1">
                                {stats.completedOrders}
                            </div>
                            <div className="text-sm text-slate-600">Completed Orders</div>
                        </div>

                        <div className="bg-white rounded-xl p-6 border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                                    <TrendingUp className="w-6 h-6 text-blue-600" />
                                </div>
                            </div>
                            <div className="text-3xl font-bold text-slate-900 mb-1">
                                {formatCurrency(stats.totalSpent)}
                            </div>
                            <div className="text-sm text-slate-600">Total Spent</div>
                        </div>

                        <div className="bg-white rounded-xl p-6 border border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                                    <Star className="w-6 h-6 text-purple-600" />
                                </div>
                            </div>
                            <div className="text-3xl font-bold text-slate-900 mb-1">
                                {stats.savedSellers}
                            </div>
                            <div className="text-sm text-slate-600">Saved Sellers</div>
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                        <Link
                            href="/marketplace/products"
                            className="bg-linear-to-br from-green-600 to-emerald-600 text-white rounded-xl p-6 hover:shadow-lg transition-shadow"
                        >
                            <Search className="w-8 h-8 mb-3" />
                            <h3 className="text-lg font-bold mb-1">Browse Products</h3>
                            <p className="text-sm text-green-100">Discover quality agricultural commodities</p>
                        </Link>

                        <Link
                            href="/marketplace/buyer/orders"
                            className="bg-linear-to-br from-blue-600 to-cyan-600 text-white rounded-xl p-6 hover:shadow-lg transition-shadow"
                        >
                            <Package className="w-8 h-8 mb-3" />
                            <h3 className="text-lg font-bold mb-1">View All Orders</h3>
                            <p className="text-sm text-blue-100">Track your purchase history</p>
                        </Link>

                        <Link
                            href="/marketplace/cart"
                            className="bg-linear-to-br from-orange-600 to-amber-600 text-white rounded-xl p-6 hover:shadow-lg transition-shadow"
                        >
                            <ShoppingCart className="w-8 h-8 mb-3" />
                            <h3 className="text-lg font-bold mb-1">Shopping Cart</h3>
                            <p className="text-sm text-orange-100">Review items before checkout</p>
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
                                    href="/marketplace/buyer/orders"
                                    className="text-green-600 hover:text-green-700 font-semibold text-sm"
                                >
                                    View All →
                                </Link>
                            </div>

                            <div className="space-y-4">
                                {recentOrders.length === 0 ? (
                                    <div className="bg-white rounded-xl p-8 text-center border border-slate-200">
                                        <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                        <h3 className="font-semibold text-slate-900">No orders yet</h3>
                                        <p className="text-sm text-slate-500 mb-4">Start shopping to see your orders here</p>
                                        <Link href="/marketplace/products" className="text-green-600 font-semibold hover:underline">
                                            Browse Marketplace
                                        </Link>
                                    </div>
                                ) : (
                                    recentOrders.map((order) => {
                                        const badge = getStatusBadge(order.status);
                                        const formattedDate = formatLocalDate(order.createdAt);

                                        return (
                                            <div
                                                key={order.id}
                                                className="bg-white rounded-xl p-6 border border-slate-200 hover:shadow-md transition-shadow"
                                            >
                                                <div className="flex items-start justify-between mb-4">
                                                    <div>
                                                        <h3 className="font-bold text-slate-900 mb-1">
                                                            Order #{order.orderNumber || order.id.slice(0, 8)}
                                                        </h3>
                                                        <p className="text-sm text-slate-600">
                                                            {order.items.length} Items • {formattedDate}
                                                        </p>
                                                    </div>
                                                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
                                                        {badge.label}
                                                    </span>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm">
                                                    <div>
                                                        <span className="text-slate-500">Products:</span>
                                                        <p className="font-semibold text-slate-900 truncate">
                                                            {order.items.map(i => i.productTitle).join(", ")}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-500">Total Amount:</span>
                                                        <p className="font-semibold text-green-600">{formatCurrency(order.totalAmount)}</p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-end pt-4 border-t border-slate-200">
                                                    <Link
                                                        href={`/marketplace/buyer/orders/${order.id}`}
                                                        className="text-sm text-green-600 hover:text-green-700 font-semibold"
                                                    >
                                                        View Details →
                                                    </Link>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Recommended Products */}
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Recommended for You
                            </h2>

                            <div className="space-y-4">
                                {recommendedProducts.map((product) => (
                                    <div
                                        key={product.id}
                                        className="bg-white rounded-xl overflow-hidden border border-slate-200 hover:shadow-md transition-shadow"
                                    >
                                        <div className="h-32 bg-slate-200 relative">
                                            {/* Placeholder for image */}
                                            <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                                                <Package className="w-8 h-8" />
                                            </div>
                                        </div>
                                        <div className="p-4">
                                            <h3 className="font-bold text-slate-900 mb-1">
                                                {product.name}
                                            </h3>
                                            <p className="text-sm text-slate-600 mb-2">
                                                {product.seller}
                                            </p>
                                            <div className="flex items-center gap-1 mb-3">
                                                <Star className="w-4 h-4 text-yellow-500 fill-current" />
                                                <span className="text-sm font-semibold text-slate-900">
                                                    {product.rating}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-lg font-bold text-green-600">
                                                    {formatCurrency(product.price)}/{product.unit}
                                                </span>
                                                <Link href={`/marketplace/products/${product.id}`} className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700">
                                                    View
                                                </Link>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </MarketplaceErrorBoundary>
    );
}
