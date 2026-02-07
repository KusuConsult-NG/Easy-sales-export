"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Package, Eye, Truck, CheckCircle, Clock, Loader2, Filter, DollarSign } from "lucide-react";
import { getVendorOrdersAction, updateVendorOrderStatusAction } from "@/app/actions/vendor";
import type { VendorOrder } from "@/app/actions/vendor";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

export default function VendorOrdersPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [orders, setOrders] = useState<VendorOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<VendorOrder["status"] | "all">("all");

    useEffect(() => {
        loadOrders();
    }, [filterStatus]);

    const loadOrders = async () => {
        setLoading(true);
        try {
            const filters = filterStatus !== "all" ? { status: filterStatus } : undefined;
            const result = await getVendorOrdersAction(filters);

            if (result.success) {
                setOrders(result.orders || []);
            } else {
                showToast(result.error || "Failed to load orders", "error");
            }
        } catch (error) {
            showToast("Failed to load orders", "error");
        } finally {
            setLoading(false);
        }
    };

    const stats = {
        total: orders.length,
        pending: orders.filter(o => o.status === "pending").length,
        processing: orders.filter(o => o.status === "processing").length,
        shipped: orders.filter(o => o.status === "shipped").length,
        revenue: orders.reduce((sum, o) => sum + o.totalAmount, 0),
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
            <div className="max-w-7xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
                    Vendor Orders
                </h1>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <p className="text-sm text-gray-600 dark:text-gray-400">Total Orders</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <p className="text-sm text-gray-600 dark:text-gray-400">Pending</p>
                        <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <p className="text-sm text-gray-600 dark:text-gray-400">Processing</p>
                        <p className="text-2xl font-bold text-blue-600">{stats.processing}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <p className="text-sm text-gray-600 dark:text-gray-400">Shipped</p>
                        <p className="text-2xl font-bold text-green-600">{stats.shipped}</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <p className="text-sm text-gray-600 dark:text-gray-400">Revenue</p>
                        <p className="text-xl font-bold text-purple-600">{formatCurrency(stats.revenue)}</p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow mb-6">
                    <div className="flex items-center gap-2 overflow-x-auto">
                        <Filter className="w-5 h-5 text-gray-400 shrink-0" />
                        {[
                            { key: "all", label: "All" },
                            { key: "pending", label: "Pending" },
                            { key: "processing", label: "Processing" },
                            { key: "shipped", label: "Shipped" },
                            { key: "delivered", label: "Delivered" }
                        ].map((f) => (
                            <button
                                key={f.key}
                                onClick={() => setFilterStatus(f.key as any)}
                                className={`px-4 py-2 rounded-lg font-medium transition whitespace-nowrap ${filterStatus === f.key
                                        ? "bg-blue-600 text-white"
                                        : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                                    }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Orders List */}
                {orders.length === 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-12 text-center shadow">
                        <Package className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No Orders Found</h3>
                        <p className="text-gray-600 dark:text-gray-400">
                            {filterStatus === "all" ? "No orders yet" : `No ${filterStatus} orders`}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {orders.map((order) => (
                            <div key={order.id} className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow hover:shadow-lg transition">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                                            {order.orderNumber}
                                        </h3>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            {order.customerName} • {new Date(order.createdAt.toDate()).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <span className={`px-4 py-2 rounded-lg font-bold text-sm capitalize ${order.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                                            order.status === "processing" ? "bg-blue-100 text-blue-700" :
                                                order.status === "shipped" ? "bg-purple-100 text-purple-700" :
                                                    "bg-green-100 text-green-700"
                                        }`}>
                                        {order.status}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                    <div className="space-y-2">
                                        {order.items.map((item, idx) => (
                                            <div key={idx} className="flex justify-between text-sm">
                                                <span className="text-gray-600 dark:text-gray-400">
                                                    {item.productName} x{item.quantity}
                                                </span>
                                                <span className="font-semibold text-gray-900 dark:text-white">
                                                    {formatCurrency(item.price * item.quantity)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="text-right">
                                        <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                            {formatCurrency(order.totalAmount)}
                                        </p>
                                        <p className={`text-sm font-semibold ${order.paymentStatus === "paid" ? "text-green-600" : "text-yellow-600"
                                            }`}>
                                            {order.paymentStatus === "paid" ? "✓ Paid" : "Payment Pending"}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => router.push(`/vendor/orders/${order.id}`)}
                                        className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center gap-2"
                                    >
                                        <Eye className="w-4 h-4" />
                                        View
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
