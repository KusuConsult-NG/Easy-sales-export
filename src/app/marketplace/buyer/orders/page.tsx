/**
 * Marketplace Orders Page
 * 
 * View all buyer orders with filtering and tracking
 */

"use client";

import { useState } from "react";
import { Package, Clock, CheckCircle, XCircle, Search, Filter, Eye } from "lucide-react";
import Link from "next/link";

export default function OrdersPage() {
    const [filterStatus, setFilterStatus] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");

    const orders = [
        {
            id: "ORD-001",
            product: "Premium Cashew Nuts",
            seller: "Kogi Farms Cooperative",
            quantity: "50kg",
            amount: 425000,
            status: "in_transit",
            date: "2026-02-06",
            estimatedDelivery: "2026-02-10",
            trackingNumber: "TRK-445623891"
        },
        {
            id: "ORD-002",
            product: "Organic Shea Butter",
            seller: "Kaduna Naturals",
            quantity: "25kg",
            amount: 300000,
            status: "processing",
            date: "2026-02-05",
            estimatedDelivery: "2026-02-12",
            trackingNumber: "TRK-445623892"
        },
        {
            id: "ORD-003",
            product: "Fresh Ginger Roots",
            seller: "Plateau Agro Hub",
            quantity: "100kg",
            amount: 420000,
            status: "delivered",
            date: "2026-02-01",
            deliveredDate: "2026-02-04",
            trackingNumber: "TRK-445623893"
        },
        {
            id: "ORD-004",
            product: "Dried Hibiscus Flowers",
            seller: "Kano Export Hub",
            quantity: "30kg",
            amount: 135000,
            status: "delivered",
            date: "2026-01-28",
            deliveredDate: "2026-01-31",
            trackingNumber: "TRK-445623894"
        },
        {
            id: "ORD-005",
            product: "Tiger Nuts",
            seller: "Lagos Agro Ventures",
            quantity: "40kg",
            amount: 128000,
            status: "cancelled",
            date: "2026-01-25",
            cancelledDate: "2026-01-26",
            cancelReason: "Seller out of stock",
            trackingNumber: "TRK-445623895"
        }
    ];

    const getStatusConfig = (status: string) => {
        const configs = {
            processing: {
                bg: "bg-blue-100 dark:bg-blue-900/30",
                text: "text-blue-700 dark:text-blue-300",
                label: "Processing",
                icon: Clock
            },
            in_transit: {
                bg: "bg-orange-100 dark:bg-orange-900/30",
                text: "text-orange-700 dark:text-orange-300",
                label: "In Transit",
                icon: Package
            },
            delivered: {
                bg: "bg-green-100 dark:bg-green-900/30",
                text: "text-green-700 dark:text-green-300",
                label: "Delivered",
                icon: CheckCircle
            },
            cancelled: {
                bg: "bg-red-100 dark:bg-red-900/30",
                text: "text-red-700 dark:text-red-300",
                label: "Cancelled",
                icon: XCircle
            }
        };
        return configs[status as keyof typeof configs] || configs.processing;
    };

    const filteredOrders = orders.filter(order => {
        const matchesStatus = filterStatus === "all" || order.status === filterStatus;
        const matchesSearch = order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
            order.product.toLowerCase().includes(searchQuery.toLowerCase()) ||
            order.seller.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesStatus && matchesSearch;
    });

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <div className="max-w-7xl mx-auto px-8 py-6">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        My Orders
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Track and manage all your marketplace orders
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-8">
                {/* Filters Bar */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by order ID, product, or seller..."
                                className="w-full pl-12 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                        </div>

                        {/* Status Filter */}
                        <div className="flex gap-2">
                            {["all", "processing", "in_transit", "delivered", "cancelled"].map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${filterStatus === status
                                        ? "bg-green-600 text-white"
                                        : "bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-600"
                                        }`}
                                >
                                    {status === "all" ? "All" : status.replace("_", " ")}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Orders List */}
                <div className="space-y-4">
                    {filteredOrders.length === 0 ? (
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
                            <Package className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                No orders found
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400 mb-6">
                                {searchQuery || filterStatus !== "all"
                                    ? "Try adjusting your filters"
                                    : "Start shopping to see your orders here"}
                            </p>
                            <Link
                                href="/marketplace/products"
                                className="inline-block px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700"
                            >
                                Browse Products
                            </Link>
                        </div>
                    ) : (
                        filteredOrders.map((order) => {
                            const statusConfig = getStatusConfig(order.status);
                            const StatusIcon = statusConfig.icon;

                            return (
                                <div
                                    key={order.id}
                                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 hover:shadow-md transition-shadow"
                                >
                                    {/* Header */}
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-3 rounded-xl ${statusConfig.bg}`}>
                                                <StatusIcon className={`w-6 h-6 ${statusConfig.text}`} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                                                    {order.product}
                                                </h3>
                                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                                    Order {order.id} • {order.date}
                                                </p>
                                            </div>
                                        </div>
                                        <span className={`px-4 py-2 rounded-full text-sm font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
                                            {statusConfig.label}
                                        </span>
                                    </div>

                                    {/* Details Grid */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                        <div>
                                            <span className="text-sm text-slate-500 dark:text-slate-400">Seller</span>
                                            <p className="font-semibold text-slate-900 dark:text-white">{order.seller}</p>
                                        </div>
                                        <div>
                                            <span className="text-sm text-slate-500 dark:text-slate-400">Quantity</span>
                                            <p className="font-semibold text-slate-900 dark:text-white">{order.quantity}</p>
                                        </div>
                                        <div>
                                            <span className="text-sm text-slate-500 dark:text-slate-400">Amount</span>
                                            <p className="font-semibold text-slate-900 dark:text-white">₦{order.amount.toLocaleString()}</p>
                                        </div>
                                        <div>
                                            <span className="text-sm text-slate-500 dark:text-slate-400">Tracking</span>
                                            <p className="font-semibold text-slate-900 dark:text-white">{order.trackingNumber}</p>
                                        </div>
                                    </div>

                                    {/* Status-specific Info */}
                                    {
                                        order.status === "delivered" && (
                                            <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-4">
                                                <p className="text-sm text-green-800 dark:text-green-300">
                                                    ✓ Delivered on {order.deliveredDate}
                                                </p>
                                            </div>
                                        )
                                    }

                                    {
                                        order.status === "in_transit" && (
                                            <div className="bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-lg p-4 mb-4">
                                                <p className="text-sm text-orange-800 dark:text-orange-300">
                                                    🚚 Expected delivery: {order.estimatedDelivery}
                                                </p>
                                            </div>
                                        )
                                    }

                                    {
                                        order.status === "processing" && (
                                            <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                                                <p className="text-sm text-blue-800 dark:text-blue-300">
                                                    ⏳ Order is being prepared by the seller
                                                </p>
                                            </div>
                                        )
                                    }

                                    {
                                        order.status === "cancelled" && (
                                            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
                                                <p className="text-sm text-red-800 dark:text-red-300">
                                                    ✕ Cancelled: {order.cancelReason}
                                                </p>
                                            </div>
                                        )
                                    }

                                    {/* Actions */}
                                    <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                                        <Link
                                            href={`/marketplace/orders/${order.id}`}
                                            className="flex items-center gap-2 text-green-600 hover:text-green-700 font-semibold text-sm"
                                        >
                                            <Eye className="w-4 h-4" />
                                            View Details
                                        </Link>

                                        {order.status === "delivered" && (
                                            <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700">
                                                Leave Review
                                            </button>
                                        )}

                                        {(order.status === "processing" || order.status === "in_transit") && (
                                            <button className="px-4 py-2 border-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-lg text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-700">
                                                Contact Seller
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div >
    );
}
