/**
 * Buyer Order Detail Page
 * Full view of a single marketplace order
 */

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
    Package, ArrowLeft, CheckCircle, XCircle, Truck,
    Clock, ShieldCheck, MapPin, Loader2, AlertCircle,
    Star, Copy, Check
} from "lucide-react";
import { getOrderByIdAction } from "@/app/actions/orders";
import { confirmOrderReceiptAction } from "@/app/actions/marketplace-buyer";
import { useToast } from "@/contexts/ToastContext";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { Order, OrderStatus } from "@/lib/types/marketplace";

export default function BuyerOrderDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { showToast } = useToast();

    const [order, setOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!id) return;
        getOrderByIdAction(id as string).then((res) => {
            if (res.success && res.data?.order) {
                setOrder(res.data.order as Order);
            } else {
                setError((res as any).error || "Order not found");
            }
            setLoading(false);
        });
    }, [id]);

    const copyOrderId = () => {
        navigator.clipboard.writeText(id as string);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    async function handleConfirmReceipt() {
        if (!confirm("Confirm you received this order? This will release funds to the seller.")) return;
        setConfirming(true);
        try {
            const result = await confirmOrderReceiptAction(id as string);
            if (result.success) {
                showToast("Order confirmed! Funds released to seller.", "success");
                setOrder(prev => prev ? { ...prev, status: "delivered" as OrderStatus, buyerConfirmed: true } : prev);
            } else {
                showToast((result as any).error || "Failed to confirm", "error");
            }
        } catch {
            showToast("An error occurred", "error");
        } finally {
            setConfirming(false);
        }
    };

    const getStatusConfig = (status: OrderStatus) => {
        const configs: Record<OrderStatus, { bg: string; text: string; border: string; label: string; icon: any }> = {
            pending_payment:   { bg: "bg-yellow-50",  text: "text-yellow-700",  border: "border-yellow-200",  label: "Pending Payment",   icon: Clock },
            payment_received:  { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "Payment Received",  icon: CheckCircle },
            confirmed:         { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "Confirmed",         icon: CheckCircle },
            processing:        { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "Processing",        icon: Clock },
            shipped:           { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200",  label: "Shipped",           icon: Truck },
            delivered:         { bg: "bg-green-50",   text: "text-green-700",   border: "border-green-200",   label: "Delivered",         icon: CheckCircle },
            completed:         { bg: "bg-green-50",   text: "text-green-700",   border: "border-green-200",   label: "Completed",         icon: CheckCircle },
            cancelled:         { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200",     label: "Cancelled",         icon: XCircle },
            disputed:          { bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200",    label: "Disputed",          icon: AlertCircle },
        };
        return configs[status] ?? configs.processing;
    };


    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    if (error || !order) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center max-w-md w-full">
                    <AlertCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Order Not Found</h2>
                    <p className="text-slate-500 mb-6">{error || "This order does not exist or you don't have access."}</p>
                    <Link href="/marketplace/buyer/orders" className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700">
                        Back to Orders
                    </Link>
                </div>
            </div>
        );
    }

    const statusConfig = getStatusConfig(order.status);
    const StatusIcon = statusConfig.icon;

    // Escrow is "active" if there is an escrow transaction and order is not yet released
    const escrowActive = !!order.escrowTransactionId && !order.escrowReleased;
    const canConfirm =
        !order.buyerConfirmed &&
        (order.status === "processing" || order.status === "shipped" || order.status === "payment_received") &&
        escrowActive;
    const canReview =
        (order.status === "delivered" || order.status === "completed") &&
        !order.reviewSubmitted;

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-6 py-5">
                    <Link
                        href="/marketplace/buyer/orders"
                        className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm font-medium mb-4 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to My Orders
                    </Link>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Order Details</h1>
                            <div className="flex items-center gap-2 mt-1">
                                <p className="text-slate-500 text-sm font-mono">#{order.orderNumber || id}</p>
                                <button onClick={copyOrderId} className="text-slate-400 hover:text-slate-700 transition-colors">
                                    {copied
                                        ? <Check className="w-4 h-4 text-green-500" />
                                        : <Copy className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                        <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}>
                            <StatusIcon className="w-4 h-4" />
                            {statusConfig.label}
                        </span>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

                {/* Escrow Banner */}
                {escrowActive && order.status !== "delivered" && order.status !== "completed" && (
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex items-center gap-3">
                        <ShieldCheck className="w-6 h-6 text-purple-600 shrink-0" />
                        <div>
                            <p className="font-semibold text-purple-900 text-sm">Payment Secured in Escrow</p>
                            <p className="text-purple-700 text-xs mt-0.5">
                                Funds are locked and will only release to the seller once you confirm receipt.
                            </p>
                        </div>
                    </div>
                )}

                {/* Escrow Released Banner */}
                {order.escrowReleased && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                        <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
                        <div>
                            <p className="font-semibold text-green-900 text-sm">Payment Released</p>
                            <p className="text-green-700 text-xs mt-0.5">
                                Funds have been released to the seller.{order.sellerAmountPaid ? ` Seller received ${formatCurrency(order.sellerAmountPaid)}.` : ""}
                            </p>
                        </div>
                    </div>
                )}

                {/* Dispute Banner */}
                {order.status === "disputed" && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center gap-3">
                        <AlertCircle className="w-6 h-6 text-rose-600 shrink-0" />
                        <div>
                            <p className="font-semibold text-rose-900 text-sm">Order Under Review</p>
                            <p className="text-rose-700 text-xs mt-0.5">Our team is reviewing this dispute. We'll reach out via your registered email.</p>
                        </div>
                    </div>
                )}

                {/* Order Items */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h2 className="font-bold text-slate-900">Order Items</h2>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {order.items.map((item, idx) => (
                            <div key={idx} className="px-6 py-4 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                                        <Package className="w-6 h-6 text-slate-400" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-slate-900">{item.productTitle}</p>
                                        <p className="text-sm text-slate-500">
                                            Qty: {item.quantity} × {formatCurrency(item.unitPrice)}
                                        </p>
                                    </div>
                                </div>
                                <p className="font-bold text-slate-900 shrink-0">{formatCurrency(item.totalPrice)}</p>
                            </div>
                        ))}
                    </div>

                    {/* Totals */}
                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 space-y-2">
                        <div className="flex justify-between text-sm text-slate-600">
                            <span>Subtotal</span>
                            <span>{formatCurrency(order.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-600">
                            <span>Delivery Fee</span>
                            <span>{formatCurrency(order.deliveryFee || 0)}</span>
                        </div>
                        {(order.serviceFee ?? 0) > 0 && (
                            <div className="flex justify-between text-sm text-slate-600">
                                <span>Service Fee</span>
                                <span>{formatCurrency(order.serviceFee)}</span>
                            </div>
                        )}
                        <div className="flex justify-between font-bold text-slate-900 text-base pt-2 border-t border-slate-200">
                            <span>Total</span>
                            <span className="text-green-600">{formatCurrency(order.totalAmount)}</span>
                        </div>
                    </div>
                </div>

                {/* Delivery Address */}
                {order.deliveryAddress && (
                    <div className="bg-white rounded-xl border border-slate-200 p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <MapPin className="w-5 h-5 text-green-600" />
                            <h2 className="font-bold text-slate-900">Delivery Address</h2>
                        </div>
                        <div className="text-sm text-slate-700 space-y-1">
                            <p className="font-semibold text-slate-900">{order.deliveryAddress.recipientName}</p>
                            {order.deliveryAddress.recipientPhone && (
                                <p className="text-slate-500">{order.deliveryAddress.recipientPhone}</p>
                            )}
                            <p>{order.deliveryAddress.street}</p>
                            <p>
                                {order.deliveryAddress.city}
                                {order.deliveryAddress.lga ? `, ${order.deliveryAddress.lga}` : ""} — {order.deliveryAddress.state}
                            </p>
                        </div>
                    </div>
                )}

                {/* Order Timeline */}
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                    <h2 className="font-bold text-slate-900 mb-4">Order Timeline</h2>
                    <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Order Placed</span>
                            <span className="font-medium text-slate-900">{formatDateTime(order.createdAt)}</span>
                        </div>
                        {order.updatedAt && (
                            <div className="flex justify-between">
                                <span className="text-slate-500">Last Updated</span>
                                <span className="font-medium text-slate-900">{formatDateTime(order.updatedAt)}</span>
                            </div>
                        )}
                        {order.trackingNumber && (
                            <div className="flex justify-between">
                                <span className="text-slate-500">Tracking Number</span>
                                <span className="font-mono font-medium text-slate-900">{order.trackingNumber}</span>
                            </div>
                        )}
                        {order.estimatedDeliveryDate && (
                            <div className="flex justify-between">
                                <span className="text-slate-500">Est. Delivery</span>
                                <span className="font-medium text-slate-900">{formatDateTime(order.estimatedDeliveryDate)}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3">
                    {canConfirm && (
                        <button
                            onClick={handleConfirmReceipt}
                            disabled={confirming}
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all"
                        >
                            {confirming
                                ? <Loader2 className="w-5 h-5 animate-spin" />
                                : <CheckCircle className="w-5 h-5" />}
                            Confirm Receipt &amp; Release Funds
                        </button>
                    )}

                    {canReview && (
                        <Link
                            href={`/marketplace/buyer/orders/${id}/review?productId=${order.items[0]?.productId || ""}&sellerId=${order.sellerId}`}
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 border-2 border-yellow-400 text-yellow-700 rounded-xl font-bold hover:bg-yellow-50 transition-all"
                        >
                            <Star className="w-5 h-5" />
                            Leave a Review
                        </Link>
                    )}

                    {order.status === "cancelled" && (
                        <Link
                            href="/marketplace"
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-all"
                        >
                            <Package className="w-5 h-5" />
                            Browse Marketplace
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}
