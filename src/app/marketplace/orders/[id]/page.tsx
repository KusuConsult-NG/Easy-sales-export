"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle, Package, Truck, MapPin, CreditCard, ArrowLeft, Loader2 } from "lucide-react";
import { getOrderByIdAction } from "@/app/actions/orders";
import type { Order } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";

export default function OrderConfirmationPage() {
    const params = useParams();
    const router = useRouter();
    const orderId = params.id as string;

    const [order, setOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (orderId) {
            loadOrder();
        }
    }, [orderId]);

    async function loadOrder() {
        try {
            const result = await getOrderByIdAction(orderId);
            if (result.success && result.order) {
                setOrder(result.order);
            } else {
                router.push("/marketplace");
            }
        } catch (error) {
            console.error("Failed to load order:", error);
            router.push("/marketplace");
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        );
    }

    if (!order) return null;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-4xl mx-auto px-4">
                {/* Order Status Hero */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 mb-8 text-center">
                    <div className="w-20 h-20 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Order Confirmed!
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                        Thank you for your order. We'll notify you when it's on the way.
                    </p>
                    <div className="inline-block px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                        <p className="text-sm text-gray-500 dark:text-gray-400">Order Number</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                            {order.orderNumber}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* Delivery Address */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <MapPin className="w-6 h-6 text-primary" />
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                Delivery Address
                            </h2>
                        </div>
                        <div className="space-y-2 text-gray-600 dark:text-gray-400">
                            <p className="font-semibold text-gray-900 dark:text-white">
                                {order.deliveryAddress.recipientName}
                            </p>
                            <p>{order.deliveryAddress.recipientPhone}</p>
                            <p>{order.deliveryAddress.street}</p>
                            <p>
                                {order.deliveryAddress.city}, {order.deliveryAddress.state}
                            </p>
                            <p>{order.deliveryAddress.lga}</p>
                        </div>
                    </div>

                    {/* Order Status */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <Truck className="w-6 h-6 text-primary" />
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                Order Status
                            </h2>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Status:</span>
                                <span className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 font-semibold rounded-full text-sm capitalize">
                                    {order.status.replace("_", " ")}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-gray-600 dark:text-gray-400">Order Date:</span>
                                <span className="font-semibold text-gray-900 dark:text-white">
                                    {new Date(order.createdAt).toLocaleDateString()}
                                </span>
                            </div>
                            {order.estimatedDeliveryDate && (
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-600 dark:text-gray-400">Est. Delivery:</span>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                        {new Date(order.estimatedDeliveryDate).toLocaleDateString()}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Order Items */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-8">
                    <div className="flex items-center gap-3 mb-6">
                        <Package className="w-6 h-6 text-primary" />
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                            Order Items
                        </h2>
                    </div>
                    <div className="space-y-4">
                        {order.items.map((item, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-gray-700 last:border-0"
                            >
                                <div className="flex-1">
                                    <h3 className="font-semibold text-gray-900 dark:text-white">
                                        {item.productTitle}
                                    </h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                        {formatCurrency(item.unitPrice)} × {item.quantity}
                                        {item.tier !== "retail" && (
                                            <span className="ml-2 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-xs font-semibold rounded capitalize">
                                                {item.tier}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <p className="font-bold text-gray-900 dark:text-white">
                                    {formatCurrency(item.totalPrice)}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Order Summary */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-8">
                    <div className="flex items-center gap-3 mb-6">
                        <CreditCard className="w-6 h-6 text-primary" />
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                            Payment Summary
                        </h2>
                    </div>
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-gray-600 dark:text-gray-400">
                            <span>Subtotal:</span>
                            <span className="font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(order.subtotal)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-gray-600 dark:text-gray-400">
                            <span>Delivery Fee:</span>
                            <span className="font-semibold text-gray-900 dark:text-white">
                                {formatCurrency(order.deliveryFee)}
                            </span>
                        </div>
                        {order.serviceFee > 0 && (
                            <div className="flex items-center justify-between text-gray-600 dark:text-gray-400">
                                <span>Service Fee:</span>
                                <span className="font-semibold text-gray-900 dark:text-white">
                                    {formatCurrency(order.serviceFee)}
                                </span>
                            </div>
                        )}
                        <div className="flex items-center justify-between text-lg font-bold pt-3 border-t border-gray-200 dark:border-gray-700">
                            <span className="text-gray-900 dark:text-white">Total:</span>
                            <span className="text-primary">{formatCurrency(order.totalAmount)}</span>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-4">
                    <button
                        onClick={() => router.push("/marketplace")}
                        className="flex-1 px-6 py-4 border-2 border-primary text-primary font-semibold rounded-xl hover:bg-primary/5 transition flex items-center justify-center gap-2"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Continue Shopping
                    </button>
                    <button
                        onClick={() => router.push("/dashboard/orders")}
                        className="flex-1 px-6 py-4 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition flex items-center justify-center gap-2"
                    >
                        <Package className="w-5 h-5" />
                        View My Orders
                    </button>
                </div>
            </div>
        </div>
    );
}
