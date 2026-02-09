/**
 * Marketplace Buyer Dashboard
 * 
 * Main dashboard for buyers with orders, recommendations, and quick actions
 */

"use client";

import { ShoppingCart, Package, Clock, CheckCircle, Star, TrendingUp, Search, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { getBuyerStatsAction, getBuyerOrdersAction } from "@/app/actions/marketplace";
import type { Order } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";

export default function BuyerDashboard() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        activeOrders: 0,
        completedOrders: 0,
        totalSpent: 0,
        savedSellers: 0
    });
    const [recentOrders, setRecentOrders] = useState<Order[]>([]);

    useEffect(() => {
        async function loadDashboard() {
            try {
                const [statsResult, ordersResult] = await Promise.all([
                    getBuyerStatsAction(),
                    getBuyerOrdersAction()
                ]);

                if (statsResult.success && statsResult.stats) {
                    setStats(statsResult.stats);
                }

                if (ordersResult.success && ordersResult.orders) {
                    // Sort by newest first and take top 5
                    const sorted = ordersResult.orders.sort((a, b) => {
                        const dateA = a.createdAt instanceof Date ? a.createdAt : new Date((a.createdAt as any).seconds * 1000);
                        const dateB = b.createdAt instanceof Date ? b.createdAt : new Date((b.createdAt as any).seconds * 1000);
                        return dateB.getTime() - dateA.getTime();
                    });
                    setRecentOrders(sorted.slice(0, 5));
                }
            } catch (error) {
                console.error("Failed to load buyer dashboard:", error);
            } finally {
                setLoading(false);
            }
        }
        loadDashboard();
    }, []);

    const recommendedProducts = [
        {
            id: 1,
            name: "Dried Hibiscus Flowers",
            price: 3500,
            unit: "kg",
            seller: "Kano Export Hub",
            rating: 4.8,
            image: "/images/logo.jpg"
        },
        {
            id: 2,
            name: "Tiger Nuts",
            price: 2800,
            unit: "kg",
            seller: "Lagos Agro Ventures",
            rating: 4.7,
            image: "/images/logo.jpg"
        },
        {
            id: 3,
            name: "Sesame Seeds",
            price: 4200,
            unit: "kg",
            seller: "Benue Farms Alliance",
            rating: 4.9,
            image: "/images/logo.jpg"
        }
    ];

    const getStatusBadge = (status: string) => {
        const badges: Record<string, { bg: string; text: string; label: string }> = {
            pending_payment: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-300", label: "Pending Payment" },
            payment_received: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", label: "Paid" },
            processing: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", label: "Processing" },
            shipped: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-300", label: "Shipped" },
            in_transit: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", label: "In Transit" },
            delivered: { bg: "bg-teal-100 dark:bg-teal-900/30", text: "text-teal-700 dark:text-teal-300", label: "Delivered" },
            completed: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", label: "Completed" },
            cancelled: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "Cancelled" },
            disputed: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "Disputed" }
        };
        return badges[status] || badges.processing;
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
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
                        Buyer Dashboard
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Manage your orders and discover quality agricultural products
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-8">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                                <Clock className="w-6 h-6 text-orange-600" />
                            </div>
                        </div>
                        <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {stats.activeOrders}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">Active Orders</div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                            </div>
                        </div>
                        <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {stats.completedOrders}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">Completed Orders</div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-blue-600" />
                            </div>
                        </div>
                        <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {formatCurrency(stats.totalSpent)}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">Total Spent</div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <Star className="w-6 h-6 text-purple-600" />
                            </div>
                        </div>
                        <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
                            {stats.savedSellers}
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">Saved Sellers</div>
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
                        href="/marketplace/orders"
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
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Recent Orders
                            </h2>
                            <Link
                                href="/marketplace/orders"
                                className="text-green-600 hover:text-green-700 font-semibold text-sm"
                            >
                                View All →
                            </Link>
                        </div>

                        <div className="space-y-4">
                            {recentOrders.length === 0 ? (
                                <div className="bg-white dark:bg-slate-800 rounded-xl p-8 text-center border border-slate-200 dark:border-slate-700">
                                    <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                    <h3 className="font-semibold text-slate-900 dark:text-white">No orders yet</h3>
                                    <p className="text-sm text-slate-500 mb-4">Start shopping to see your orders here</p>
                                    <Link href="/marketplace/products" className="text-green-600 font-semibold hover:underline">
                                        Browse Marketplace
                                    </Link>
                                </div>
                            ) : (
                                recentOrders.map((order) => {
                                    const badge = getStatusBadge(order.status);
                                    const formattedDate = order.createdAt instanceof Date
                                        ? order.createdAt.toLocaleDateString()
                                        : new Date((order.createdAt as any).seconds * 1000).toLocaleDateString();

                                    return (
                                        <div
                                            key={order.id}
                                            className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow"
                                        >
                                            <div className="flex items-start justify-between mb-4">
                                                <div>
                                                    <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                                                        Order #{order.orderNumber || order.id.slice(0, 8)}
                                                    </h3>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                                        {order.items.length} Items • {formattedDate}
                                                    </p>
                                                </div>
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
                                                    {badge.label}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm">
                                                <div>
                                                    <span className="text-slate-500 dark:text-slate-400">Products:</span>
                                                    <p className="font-semibold text-slate-900 dark:text-white truncate">
                                                        {order.items.map(i => i.productTitle).join(", ")}
                                                    </p>
                                                </div>
                                                <div>
                                                    <span className="text-slate-500 dark:text-slate-400">Total Amount:</span>
                                                    <p className="font-semibold text-green-600">{formatCurrency(order.totalAmount)}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-end pt-4 border-t border-slate-200 dark:border-slate-700">
                                                <Link
                                                    href={`/marketplace/orders/${order.id}`}
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
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                            Recommended for You
                        </h2>

                        <div className="space-y-4">
                            {recommendedProducts.map((product) => (
                                <div
                                    key={product.id}
                                    className="bg-white dark:bg-slate-800 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow"
                                >
                                    <div className="h-32 bg-slate-200 dark:bg-slate-700 relative">
                                        {/* Placeholder for image */}
                                        <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                                            <Package className="w-8 h-8" />
                                        </div>
                                    </div>
                                    <div className="p-4">
                                        <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                                            {product.name}
                                        </h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                                            {product.seller}
                                        </p>
                                        <div className="flex items-center gap-1 mb-3">
                                            <Star className="w-4 h-4 text-yellow-500 fill-current" />
                                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
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
    );
}
