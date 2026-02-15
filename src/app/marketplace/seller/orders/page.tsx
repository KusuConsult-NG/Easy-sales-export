/**
 * Seller Orders Management
 * 
 * View and process seller orders
 */

"use client";

import { useState, useEffect } from "react";
import { Package, Search, Eye, Truck, CheckCircle, Clock, XCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { getSellerOrdersAction } from "@/app/actions/marketplace";
import type { Order } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import BackButton from "@/components/ui/BackButton";

export default function SellerOrdersPage() {
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState<Order[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState("all");

    useEffect(() => {
        async function loadOrders() {
            try {
                const result = await getSellerOrdersAction();
                if (result.success && result.orders) {
                    setOrders(result.orders);
                }
            } catch (error) {
                console.error("Failed to load orders:", error);
            } finally {
                setLoading(false);
            }
        }
        loadOrders();
    }, []);

    const getStatusConfig = (status: string) => {
        const configs: Record<string, { bg: string; text: string; label: string; icon: any }> = {
            pending_payment: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-700 dark:text-yellow-300", label: "Pending Payment", icon: Clock },
            payment_received: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", label: "Payment Received", icon: CheckCircle },
            processing: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", label: "Processing", icon: Clock },
            shipped: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", label: "Shipped", icon: Truck },
            delivered: { bg: "bg-teal-100 dark:bg-teal-900/30", text: "text-teal-700 dark:text-teal-300", label: "Delivered", icon: CheckCircle },
            completed: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-300", label: "Completed", icon: CheckCircle },
            cancelled: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "Cancelled", icon: XCircle },
            disputed: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "Disputed", icon: XCircle }
        };
        return configs[status] || configs.pending_payment;
    };

    const filteredOrders = orders.filter(order => {
        const matchesSearch =
            order.orderNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            order.items.some(item => item.productTitle.toLowerCase().includes(searchQuery.toLowerCase())) ||
            order.deliveryAddress?.recipientName.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesStatus = filterStatus === "all" || order.status === filterStatus;
        return matchesSearch && matchesStatus;
    });

    const pendingCount = orders.filter(o => o.status === "processing" || o.status === "payment_received").length;

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
                    <BackButton fallbackPath="/marketplace/seller/dashboard" />
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Orders Management
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Process and fulfill customer orders
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-8">
                {/* Pending Alert */}
                {pendingCount > 0 && (
                    <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4 mb-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-orange-600 rounded-full flex items-center justify-center">
                                    <Clock className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <p className="font-semibold text-orange-900 dark:text-orange-200">
                                        {pendingCount} {pendingCount === 1 ? 'order' : 'orders'} awaiting fulfillment
                                    </p>
                                    <p className="text-sm text-orange-800 dark:text-orange-300">
                                        Process orders within 24 hours to maintain good standing
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setFilterStatus("processing")}
                                className="px-4 py-2 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700"
                            >
                                View Pending
                            </button>
                        </div>
                    </div>
                )}

                {/* Search and Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by order ID, product, or buyer..."
                                className="w-full pl-12 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                        </div>

                        {/* Status Filter */}
                        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
                            {["all", "processing", "shipped", "completed", "cancelled"].map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors whitespace-nowrap ${filterStatus === status
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
                            <p className="text-slate-600 dark:text-slate-400">
                                {searchQuery || filterStatus !== "all"
                                    ? "Try adjusting your filters"
                                    : "Orders will appear here when buyers purchase your products"}
                            </p>
                        </div>
                    ) : (
                        filteredOrders.map((order) => {
                            const statusConfig = getStatusConfig(order.status);
                            const StatusIcon = statusConfig.icon;
                            const formattedDate = order.createdAt instanceof Date
                                ? order.createdAt.toLocaleDateString()
                                : new Date((order.createdAt as any).seconds * 1000).toLocaleDateString();

                            return (
                                <div
                                    key={order.id}
                                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 hover:shadow-md transition-shadow"
                                >
                                    {/* Header */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-3 rounded-xl ${statusConfig.bg}`}>
                                                <StatusIcon className={`w-6 h-6 ${statusConfig.text}`} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                                                    Order #{order.orderNumber || order.id.slice(0, 8)}
                                                </h3>
                                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                                    {formattedDate} • {order.items.length} Items
                                                </p>
                                            </div>
                                        </div>
                                        <span className={`px-4 py-2 rounded-full text-sm font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
                                            {statusConfig.label}
                                        </span>
                                    </div>

                                    {/* Details Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                                        <div>
                                            <span className="text-sm text-slate-500 dark:text-slate-400">Buyer</span>
                                            <p className="font-semibold text-slate-900 dark:text-white">{order.deliveryAddress?.recipientName}</p>
                                        </div>
                                        <div>
                                            <span className="text-sm text-slate-500 dark:text-slate-400">Products</span>
                                            <p className="font-semibold text-slate-900 dark:text-white truncate">
                                                {order.items.map(i => i.productTitle).join(", ")}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-sm text-slate-500 dark:text-slate-400">Amount</span>
                                            <p className="font-semibold text-green-600">{formatCurrency(order.totalAmount)}</p>
                                        </div>
                                        <div>
                                            <span className="text-sm text-slate-500 dark:text-slate-400">Location</span>
                                            <p className="font-semibold text-slate-900 dark:text-white">
                                                {order.deliveryAddress?.city}, {order.deliveryAddress?.state}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Status-specific Actions */}
                                    {(order.status === "processing" || order.status === "payment_received") && (
                                        <div className="bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-lg p-4 mb-4">
                                            <p className="text-sm text-orange-800 dark:text-orange-300 mb-3">
                                                ⏳ Awaiting fulfillment. Please pack and ship the items.
                                            </p>
                                            <Link
                                                href={`/marketplace/seller/orders/${order.id}`}
                                                className="block w-full py-2 bg-green-600 text-white text-center rounded-lg font-semibold hover:bg-green-700"
                                            >
                                                Start Fulfillment
                                            </Link>
                                        </div>
                                    )}

                                    {order.status === "shipped" && (
                                        <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                                            <p className="text-sm text-blue-800 dark:text-blue-300 mb-2">
                                                🚚 Tracking: {order.trackingNumber || "N/A"}
                                            </p>
                                            <div className="flex gap-2">
                                                <button className="flex-1 py-2 border-2 border-blue-600 text-blue-600 rounded-lg font-semibold hover:bg-blue-50 dark:hover:bg-blue-900/20">
                                                    Update Tracking
                                                </button>
                                                <button className="flex-1 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700">
                                                    Mark as Delivered
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {order.status === "completed" && (
                                        <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-lg p-3">
                                            <p className="text-sm text-green-800 dark:text-green-300">
                                                ✓ Completed • Payment released to your account
                                            </p>
                                        </div>
                                    )}

                                    {/* View Details Link */}
                                    <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-700">
                                        <Link
                                            href={`/marketplace/seller/orders/${order.id}`}
                                            className="flex items-center gap-2 text-green-600 hover:text-green-700 font-semibold text-sm"
                                        >
                                            <Eye className="w-4 h-4" />
                                            View Full Details
                                        </Link>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
