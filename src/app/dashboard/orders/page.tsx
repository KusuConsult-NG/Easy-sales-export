"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Package,
    Truck,
    CheckCircle,
    Clock,
    MapPin,
    Eye,
    MessageCircle,
    AlertTriangle,
    Loader2,
    ShoppingCart,
    Star,
} from "lucide-react";
import { getBuyerOrdersAction, confirmDeliveryAction } from "@/app/actions/order-management";
import { createConversationAction } from "@/app/actions/messaging";
import type { Order, OrderStatus } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

const orderStatuses: OrderStatus[] = [
    "pending_payment",
    "payment_received",
    "processing",
    "shipped",
    "delivered",
    "completed",
];

export default function BuyerOrdersPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [confirmingOrder, setConfirmingOrder] = useState<string | null>(null);

    useEffect(() => {
        loadOrders();
    }, []);

    async function loadOrders() {
        setLoading(true);
        try {
            const result = await getBuyerOrdersAction();
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

    async function handleConfirmDelivery(orderId: string) {
        setConfirmingOrder(orderId);
        try {
            const result = await confirmDeliveryAction(orderId);
            if (result.success) {
                showToast("Delivery confirmed! Payment released to seller.", "success");
                loadOrders();
            } else {
                showToast(result.error || "Failed to confirm delivery", "error");
            }
        } catch (error) {
            showToast("Failed to confirm delivery", "error");
        } finally {
            setConfirmingOrder(null);
        }
    }

    async function handleContactSeller(order: Order) {
        try {
            const result = await createConversationAction({
                recipientId: order.sellerId,
                orderId: order.id,
            });

            if (result.success) {
                router.push(`/dashboard/messages?conversation=${result.conversationId}`);
            } else {
                showToast(result.error || "Failed to start conversation", "error");
            }
        } catch (error) {
            showToast("Failed to start conversation", "error");
        }
    }

    const getStatusIndex = (status: OrderStatus) => {
        return orderStatuses.indexOf(status);
    };

    const getStatusColor = (status: OrderStatus) => {
        switch (status) {
            case "pending_payment":
            case "payment_received":
                return "yellow";
            case "processing":
                return "blue";
            case "shipped":
                return "purple";
            case "delivered":
            case "completed":
                return "green";
            case "cancelled":
            case "disputed":
                return "red";
            default:
                return "gray";
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-5xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        My Orders
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Track and manage your marketplace orders
                    </p>
                </div>

                {/* Orders List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    </div>
                ) : orders.length > 0 ? (
                    <div className="space-y-6">
                        {orders.map((order) => {
                            const statusIndex = getStatusIndex(order.status);
                            const statusColor = getStatusColor(order.status);
                            const canConfirmDelivery =
                                order.status === "delivered" && !order.buyerConfirmed;

                            return (
                                <div
                                    key={order.id}
                                    className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6"
                                >
                                    {/* Order Header */}
                                    <div className="flex items-start justify-between mb-6">
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                                                    {order.orderNumber}
                                                </h3>
                                                <span
                                                    className={`px-3 py-1 bg-${statusColor}-100 dark:bg-${statusColor}-900/20 text-${statusColor}-800 dark:text-${statusColor}-200 text-sm font-semibold rounded-full capitalize`}
                                                >
                                                    {order.status.replace("_", " ")}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                Placed on {new Date(order.createdAt).toLocaleDateString()}
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

                                    {/* Order Status Timeline */}
                                    <div className="mb-6">
                                        <div className="flex items-center justify-between relative">
                                            {/* Progress bar */}
                                            <div className="absolute top-4 left-0 w-full h-1 bg-gray-200 dark:bg-gray-700 -z-10">
                                                <div
                                                    className="h-full bg-primary transition-all duration-500"
                                                    style={{
                                                        width: `${(statusIndex / (orderStatuses.length - 1)) * 100}%`,
                                                    }}
                                                />
                                            </div>

                                            {/* Status steps */}
                                            {[
                                                { icon: Clock, label: "Pending" },
                                                { icon: CheckCircle, label: "Paid" },
                                                { icon: Package, label: "Processing" },
                                                { icon: Truck, label: "Shipped" },
                                                { icon: CheckCircle, label: "Delivered" },
                                            ].map((step, index) => {
                                                const Icon = step.icon;
                                                const isActive = index <= statusIndex;
                                                return (
                                                    <div
                                                        key={index}
                                                        className="flex flex-col items-center"
                                                    >
                                                        <div
                                                            className={`w-8 h-8 rounded-full flex items-center justify-center ${isActive
                                                                ? "bg-primary text-white"
                                                                : "bg-gray-200 dark:bg-gray-700 text-gray-400"
                                                                } transition-all duration-300 mb-2`}
                                                        >
                                                            <Icon className="w-4 h-4" />
                                                        </div>
                                                        <p
                                                            className={`text-xs ${isActive
                                                                ? "text-gray-900 dark:text-white font-semibold"
                                                                : "text-gray-500"
                                                                }`}
                                                        >
                                                            {step.label}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Delivery Info */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <MapPin className="w-4 h-4 text-gray-500" />
                                                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                    Delivery Address
                                                </p>
                                            </div>
                                            <p className="text-sm text-gray-900 dark:text-white">
                                                {order.deliveryAddress.recipientName}
                                            </p>
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                {order.deliveryAddress.street}
                                            </p>
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                {order.deliveryAddress.city}, {order.deliveryAddress.state}
                                            </p>
                                        </div>

                                        {order.trackingNumber && (
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Truck className="w-4 h-4 text-gray-500" />
                                                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                        Tracking Information
                                                    </p>
                                                </div>
                                                <p className="text-sm text-gray-900 dark:text-white font-mono">
                                                    {order.trackingNumber}
                                                </p>
                                                {order.estimatedDeliveryDate && (
                                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                                        Est. Delivery:{" "}
                                                        {new Date(order.estimatedDeliveryDate).toLocaleDateString()}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Order Items */}
                                    <div className="mb-4">
                                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                            Order Items
                                        </p>
                                        <div className="space-y-2">
                                            {order.items.map((item, idx) => (
                                                <div
                                                    key={idx}
                                                    className="flex items-center justify-between text-sm"
                                                >
                                                    <div>
                                                        <span className="text-gray-900 dark:text-white font-medium">
                                                            {item.productTitle}
                                                        </span>
                                                        <span className="text-gray-500 ml-2">
                                                            × {item.quantity}
                                                        </span>
                                                        {item.tier !== "retail" && (
                                                            <span className="ml-2 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-xs font-semibold rounded capitalize">
                                                                {item.tier}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="font-semibold text-gray-900 dark:text-white">
                                                        {formatCurrency(item.totalPrice)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex flex-wrap gap-3">
                                        <button
                                            onClick={() => router.push(`/marketplace/orders/${order.id}`)}
                                            className="flex-1 min-w-[140px] px-4 py-2 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center justify-center gap-2"
                                        >
                                            <Eye className="w-4 h-4" />
                                            View Details
                                        </button>

                                        {canConfirmDelivery && (
                                            <button
                                                onClick={() => handleConfirmDelivery(order.id)}
                                                disabled={confirmingOrder === order.id}
                                                className="flex-1 min-w-[140px] px-4 py-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
                                            >
                                                {confirmingOrder === order.id ? (
                                                    <>
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        Confirming...
                                                    </>
                                                ) : (
                                                    <>
                                                        <CheckCircle className="w-4 h-4" />
                                                        Confirm Delivery
                                                    </>
                                                )}
                                            </button>
                                        )}

                                        <button
                                            onClick={() => handleContactSeller(order)}
                                            className="flex-1 min-w-[140px] px-4 py-2 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition flex items-center justify-center gap-2"
                                        >
                                            <MessageCircle className="w-4 h-4" />
                                            Contact Seller
                                        </button>

                                        {order.status === "completed" && (
                                            <button
                                                onClick={() => router.push(`/dashboard/reviews/new?orderId=${order.id}`)}
                                                className="flex-1 min-w-[140px] px-4 py-2 bg-yellow-600 text-white font-semibold rounded-xl hover:bg-yellow-700 transition flex items-center justify-center gap-2"
                                            >
                                                <Star className="w-4 h-4" />
                                                Leave Review
                                            </button>
                                        )}

                                        {order.status !== "completed" && !order.buyerConfirmed && (
                                            <button
                                                onClick={() => router.push(`/dashboard/disputes/new?orderId=${order.id}`)}
                                                className="flex-1 min-w-[140px] px-4 py-2 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition flex items-center justify-center gap-2"
                                            >
                                                <AlertTriangle className="w-4 h-4" />
                                                Report Issue
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl">
                        <ShoppingCart className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 dark:text-gray-400 text-lg mb-4">
                            You haven't placed any orders yet
                        </p>
                        <button
                            onClick={() => router.push("/marketplace")}
                            className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition"
                        >
                            Browse Products
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
