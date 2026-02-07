"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Package,
    Clock,
    CheckCircle,
    XCircle,
    Truck,
    Eye,
    Filter,
    Search,
    Loader2,
    DollarSign
} from "lucide-react";
import { getSellerOrdersAction, updateOrderStatusAction } from "@/app/actions/order-management";
import type { Order, OrderStatus } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

const statusOptions: { value: OrderStatus; label: string; color: string }[] = [
    { value: "pending_payment", label: "Pending Payment", color: "yellow" },
    { value: "payment_received", label: "Payment Received", color: "blue" },
    { value: "processing", label: "Processing", color: "blue" },
    { value: "shipped", label: "Shipped", color: "purple" },
    { value: "delivered", label: "Delivered", color: "green" },
    { value: "completed", label: "Completed", color: "green" },
    { value: "cancelled", label: "Cancelled", color: "red" },
    { value: "disputed", label: "Disputed", color: "red" },
];

export default function SellerOrdersPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<OrderStatus | "all">("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [newStatus, setNewStatus] = useState<OrderStatus>("processing");
    const [trackingNumber, setTrackingNumber] = useState("");
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        loadOrders();
    }, [filterStatus]);

    async function loadOrders() {
        setLoading(true);
        try {
            const filters = filterStatus !== "all" ? { status: filterStatus } : undefined;
            const result = await getSellerOrdersAction(filters);
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
    }

    async function handleUpdateStatus() {
        if (!selectedOrder) return;

        setUpdating(true);
        try {
            const result = await updateOrderStatusAction(
                selectedOrder.id,
                newStatus,
                trackingNumber || undefined
            );

            if (result.success) {
                showToast("Order status updated successfully", "success");
                setShowStatusModal(false);
                loadOrders();
            } else {
                showToast(result.error || "Failed to update status", "error");
            }
        } catch (error) {
            showToast("Failed to update status", "error");
        } finally {
            setUpdating(false);
        }
    }

    const filteredOrders = orders.filter(order => {
        const matchesSearch =
            order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
            order.deliveryAddress.recipientName.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesSearch;
    });

    // Calculate stats
    const stats = {
        total: orders.length,
        pending: orders.filter(o => o.status === "pending_payment" || o.status === "payment_received").length,
        processing: orders.filter(o => o.status === "processing").length,
        shipped: orders.filter(o => o.status === "shipped").length,
        completed: orders.filter(o => o.status === "completed").length,
        totalRevenue: orders
            .filter(o => o.status === "completed")
            .reduce((sum, o) => sum + o.totalAmount, 0),
    };

    const getStatusColor = (status: OrderStatus) => {
        const option = statusOptions.find(s => s.value === status);
        return option?.color || "gray";
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        My Orders
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Manage and track your marketplace orders
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <div className="flex items-center justify-between mb-2">
                            <Package className="w-5 h-5 text-gray-400" />
                            <span className="text-2xl font-bold text-gray-900 dark:text-white">
                                {stats.total}
                            </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Total Orders</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <div className="flex items-center justify-between mb-2">
                            <Clock className="w-5 h-5 text-yellow-500" />
                            <span className="text-2xl font-bold text-gray-900 dark:text-white">
                                {stats.pending}
                            </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Pending</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <div className="flex items-center justify-between mb-2">
                            <Package className="w-5 h-5 text-blue-500" />
                            <span className="text-2xl font-bold text-gray-900 dark:text-white">
                                {stats.processing}
                            </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Processing</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <div className="flex items-center justify-between mb-2">
                            <Truck className="w-5 h-5 text-purple-500" />
                            <span className="text-2xl font-bold text-gray-900 dark:text-white">
                                {stats.shipped}
                            </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Shipped</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <div className="flex items-center justify-between mb-2">
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            <span className="text-2xl font-bold text-gray-900 dark:text-white">
                                {stats.completed}
                            </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Completed</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow">
                        <div className="flex items-center justify-between mb-2">
                            <DollarSign className="w-5 h-5 text-green-500" />
                            <span className="text-lg font-bold text-gray-900 dark:text-white">
                                {formatCurrency(stats.totalRevenue)}
                            </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Revenue</p>
                    </div>
                </div>

                {/* Filters & Search */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by order number or customer name..."
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                            />
                        </div>

                        <div className="relative">
                            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <select
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value as OrderStatus | "all")}
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary appearance-none"
                            >
                                <option value="all">All Statuses</option>
                                {statusOptions.map(status => (
                                    <option key={status.value} value={status.value}>
                                        {status.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Orders List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    </div>
                ) : filteredOrders.length > 0 ? (
                    <div className="space-y-4">
                        {filteredOrders.map(order => {
                            const statusColor = getStatusColor(order.status);
                            return (
                                <div
                                    key={order.id}
                                    className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 hover:shadow-xl transition"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                                    {order.orderNumber}
                                                </h3>
                                                <span className={`px-3 py-1 bg-${statusColor}-100 dark:bg-${statusColor}-900/20 text-${statusColor}-800 dark:text-${statusColor}-200 text-sm font-semibold rounded-full capitalize`}>
                                                    {order.status.replace("_", " ")}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                {new Date(order.createdAt).toLocaleDateString()} • {order.deliveryAddress.recipientName}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-2xl font-bold text-primary">
                                                {formatCurrency(order.totalAmount)}
                                            </p>
                                            <p className="text-sm text-gray-500">
                                                {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                        <div>
                                            <p className="text-sm text-gray-500 mb-1">Delivery Address</p>
                                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                                {order.deliveryAddress.street}, {order.deliveryAddress.city}
                                            </p>
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                {order.deliveryAddress.state}
                                            </p>
                                        </div>
                                        {order.trackingNumber && (
                                            <div>
                                                <p className="text-sm text-gray-500 mb-1">Tracking Number</p>
                                                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                                    {order.trackingNumber}
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => router.push(`/marketplace/orders/${order.id}`)}
                                            className="flex-1 px-4 py-2 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center justify-center gap-2"
                                        >
                                            <Eye className="w-4 h-4" />
                                            View Details
                                        </button>
                                        <button
                                            onClick={() => {
                                                setSelectedOrder(order);
                                                setNewStatus(order.status);
                                                setTrackingNumber(order.trackingNumber || "");
                                                setShowStatusModal(true);
                                            }}
                                            className="flex-1 px-4 py-2 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition flex items-center justify-center gap-2"
                                        >
                                            <Package className="w-4 h-4" />
                                            Update Status
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-center py-12">
                        <Package className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 dark:text-gray-400 text-lg">
                            {searchQuery || filterStatus !== "all"
                                ? "No orders match your filters"
                                : "No orders yet"}
                        </p>
                    </div>
                )}

                {/* Update Status Modal */}
                {showStatusModal && selectedOrder && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                                Update Order Status
                            </h2>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                                Order: {selectedOrder.orderNumber}
                            </p>

                            <div className="space-y-4 mb-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        New Status
                                    </label>
                                    <select
                                        value={newStatus}
                                        onChange={(e) => setNewStatus(e.target.value as OrderStatus)}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                    >
                                        {statusOptions.map(status => (
                                            <option key={status.value} value={status.value}>
                                                {status.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {(newStatus === "shipped" || newStatus === "delivered") && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            Tracking Number (Optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={trackingNumber}
                                            onChange={(e) => setTrackingNumber(e.target.value)}
                                            placeholder="Enter tracking number"
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowStatusModal(false)}
                                    className="flex-1 px-4 py-3 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleUpdateStatus}
                                    disabled={updating}
                                    className="flex-1 px-4 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {updating ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Updating...
                                        </>
                                    ) : (
                                        "Update Status"
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
