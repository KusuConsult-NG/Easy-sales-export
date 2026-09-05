/**
 * Seller Order Detail Page
 * Full order view with fulfillment controls
 */

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft, Package, CheckCircle, XCircle, Truck, Clock,
    MapPin, Loader2, AlertCircle, Copy, Check, Phone
} from "lucide-react";
import { getOrderByIdForSellerAction } from "@/app/actions/order-management";
import { updateOrderStatusAction, getTrackingUpdatesAction } from "@/app/actions/order-management";
import { SELLER_AWAITING_AUTO_RELEASE, SELLER_COMPLETED_NOT_RELEASED } from "@/lib/escrow-release-copy";
import type { TrackingUpdate } from "@/lib/logistics";
import { useToast } from "@/contexts/ToastContext";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { Order, OrderStatus } from "@/lib/types/marketplace";

export default function SellerOrderDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { showToast } = useToast();

    const [order, setOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState(false);
    const [copied, setCopied] = useState(false);
    const [trackingNumber, setTrackingNumber] = useState("");
    const [trackingUpdates, setTrackingUpdates] = useState<TrackingUpdate[]>([]);
    const [loadingTracking, setLoadingTracking] = useState(false);

    useEffect(() => {
        if (!id) return;
        getOrderByIdForSellerAction(id as string).then((res) => {
            if (res.success && res.data?.order) {
                setOrder(res.data.order);
                setTrackingNumber(res.data.order.trackingNumber || "");
            } else {
                setError(res.error || "Order not found");
            }
            setLoading(false);
        });
    }, [id]);

    useEffect(() => {
        if (!order?.trackingNumber) return;
        setLoadingTracking(true);
        getTrackingUpdatesAction(order.trackingNumber).then((res) => {
            if (res.success && res.data?.updates) {
                setTrackingUpdates(res.data.updates as any);
            }
            setLoadingTracking(false);
        });
    }, [order?.trackingNumber]);

    const copyOrderId = () => {
        navigator.clipboard.writeText(id as string);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    async function handleStatusUpdate(newStatus: OrderStatus) {
        if (!order) return;
        setUpdating(true);
        try {
            const result = await updateOrderStatusAction(order.id, newStatus, trackingNumber || undefined);
            if (result.success) {
                showToast(result.data?.message || `Order status updated to ${newStatus.replace(/_/g, " ")}`, "success");
                setOrder(prev => prev ? { ...prev, status: newStatus, trackingNumber: trackingNumber || prev.trackingNumber } : prev);
            } else {
                showToast(result.error || "Failed to update status", "error");
            }
        } catch {
            showToast("An error occurred", "error");
        } finally {
            setUpdating(false);
        }
    };

    const getStatusConfig = (status: OrderStatus) => {
        const configs: Record<OrderStatus, { bg: string; text: string; border: string; label: string; icon: any }> = {
            pending_payment:  { bg: "bg-yellow-50",  text: "text-yellow-700",  border: "border-yellow-200",  label: "Pending Payment",  icon: Clock },
            payment_received: { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "Payment Received", icon: CheckCircle },
            confirmed:        { bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-200",  label: "Confirmed",        icon: CheckCircle },
            processing:       { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200",  label: "Processing",       icon: Clock },
            shipped:          { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "Shipped",          icon: Truck },
            delivered:        { bg: "bg-teal-50",    text: "text-teal-700",    border: "border-teal-200",    label: "Delivered",        icon: CheckCircle },
            completed:        { bg: "bg-green-50",   text: "text-green-700",   border: "border-green-200",   label: "Completed",        icon: CheckCircle },
            cancelled:        { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200",     label: "Cancelled",        icon: XCircle },
            disputed:         { bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200",    label: "Disputed",         icon: AlertCircle },
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
                    <Link href="/marketplace/seller/orders" className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700">
                        Back to Orders
                    </Link>
                </div>
            </div>
        );
    }

    const statusConfig = getStatusConfig(order.status);
    const StatusIcon = statusConfig.icon;

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-6 py-5">
                    <Link
                        href="/marketplace/seller/orders"
                        className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm font-medium mb-4 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Orders
                    </Link>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Order #{order.orderNumber || id}</h1>
                            <div className="flex items-center gap-2 mt-1">
                                <p className="text-slate-500 text-xs font-mono">{id}</p>
                                <button onClick={copyOrderId} className="text-slate-400 hover:text-slate-700 transition-colors">
                                    {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
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

                {/* Fulfillment Actions */}
                {(order.status === "payment_received" || order.status === "processing") && (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
                        <p className="font-semibold text-orange-900 mb-1">⏳ Action Required — Awaiting Fulfillment</p>
                        <p className="text-sm text-orange-700 mb-4">Pack and ship the items, then enter a tracking number and mark as shipped.</p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <input
                                type="text"
                                value={trackingNumber}
                                onChange={e => setTrackingNumber(e.target.value)}
                                placeholder="Tracking number (optional)"
                                className="flex-1 px-4 py-2.5 border border-orange-300 rounded-lg bg-white text-slate-900 text-sm focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                            />
                            <button
                                onClick={() => handleStatusUpdate("shipped")}
                                disabled={updating}
                                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700 disabled:opacity-50 transition-all"
                            >
                                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                                Mark as Shipped
                            </button>
                        </div>
                    </div>
                )}

                {order.status === "shipped" && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                        <p className="font-semibold text-blue-900 mb-1">🚚 Order Shipped</p>
                        <p className="text-sm text-blue-700 mb-4">
                            Tracking: <span className="font-mono font-semibold">{order.trackingNumber || "N/A"}</span>
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <input
                                type="text"
                                value={trackingNumber}
                                onChange={e => setTrackingNumber(e.target.value)}
                                placeholder="Update tracking number"
                                className="flex-1 px-4 py-2.5 border border-blue-300 rounded-lg bg-white text-slate-900 text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                            />
                            <button
                                onClick={() => handleStatusUpdate("shipped")}
                                disabled={updating}
                                className="px-5 py-2.5 border-2 border-blue-600 text-blue-600 rounded-lg font-semibold text-sm hover:bg-blue-50 disabled:opacity-50 transition-all"
                            >
                                Update Tracking
                            </button>
                        </div>
                    </div>
                )}

                {(order.status === "completed" || order.status === "delivered") && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                        <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
                        <div>
                            <p className="font-semibold text-green-900 text-sm">Order Completed</p>
                            <p className="text-green-700 text-xs mt-0.5">
                                {/* #390. The false branch read "Awaiting buyer confirmation to
                                    release payment." — but this panel renders on status
                                    "delivered", which is set BY the buyer confirming. So the
                                    seller was told they were waiting for the thing that had
                                    already happened, on every order in that state. Split, so
                                    a confirmed-but-unpaid order and a completed-but-unpaid
                                    one each say what is actually true of them. */}
                                {order.escrowReleased
                                    ? `Payment has been released to your account.${order.sellerAmountPaid ? ` You received ${formatCurrency(order.sellerAmountPaid)}.` : ""}`
                                    : order.status === "delivered"
                                        ? SELLER_AWAITING_AUTO_RELEASE
                                        : SELLER_COMPLETED_NOT_RELEASED}
                            </p>
                        </div>
                    </div>
                )}

                {order.status === "disputed" && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center gap-3">
                        <AlertCircle className="w-6 h-6 text-rose-600 shrink-0" />
                        <div>
                            <p className="font-semibold text-rose-900 text-sm">Dispute in Progress</p>
                            {/* Was: "Please check your email for updates." — #312.
                                resolveDisputeAction sends an in-app notification, an SMS
                                and a push to both parties, and no email at all. So this
                                named the one channel that is never used and omitted the
                                three that are. Its buyer-side twin said the same thing. */}
                            <p className="text-rose-700 text-xs mt-0.5">Our team is reviewing this dispute. You&rsquo;ll be notified here and by SMS when it is resolved.</p>
                        </div>
                    </div>
                )}

                {/* Shipment Tracking Timeline */}
                {order.trackingNumber && (
                    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-slate-900 flex items-center gap-2">
                                <Truck className="w-5 h-5 text-green-600" />
                                Shipment Tracking Details
                            </h2>
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
                                Active Tracking
                            </span>
                        </div>
                        
                        {loadingTracking ? (
                            <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                                <Loader2 className="w-4 h-4 animate-spin text-green-600" />
                                <span>Fetching latest logistics updates...</span>
                            </div>
                        ) : trackingUpdates.length > 0 ? (
                            <div className="relative pl-6 border-l-2 border-slate-200 space-y-6 ml-3 mt-4">
                                {trackingUpdates.map((update, idx) => {
                                    const isLatest = idx === trackingUpdates.length - 1;
                                    return (
                                        <div key={idx} className="relative">
                                            {/* Dot indicator */}
                                            <div className={`absolute -left-[33px] top-1 w-4.5 h-4.5 rounded-full border-2 bg-white flex items-center justify-center ${
                                                isLatest ? "border-green-600 ring-4 ring-green-50" : "border-slate-350"
                                            }`}>
                                                <div className={`w-2 h-2 rounded-full ${isLatest ? "bg-green-600 animate-pulse" : "bg-slate-400"}`} />
                                            </div>
                                            
                                            <div>
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                                    <span className={`font-semibold text-sm ${isLatest ? "text-green-700 text-base" : "text-slate-800"}`}>
                                                        {update.location}
                                                    </span>
                                                    <span className="text-xs text-slate-400 font-mono">
                                                        {formatDateTime(update.timestamp)}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-500 mt-0.5 capitalize font-semibold">{update.status.replace("_", " ")}</p>
                                                {update.note && (
                                                    <p className="text-sm text-slate-600 mt-1 bg-slate-50 p-3 rounded-lg border border-slate-100 italic">
                                                        {update.note}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-sm text-slate-500 py-2">No tracking updates available yet.</div>
                        )}
                    </div>
                )}

                {/* Order Items */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h2 className="font-bold text-slate-900">Ordered Items</h2>
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
                                            Qty: {item.quantity} × {formatCurrency(item.unitPrice)} ({item.tier})
                                        </p>
                                    </div>
                                </div>
                                <p className="font-bold text-slate-900 shrink-0">{formatCurrency(item.totalPrice)}</p>
                            </div>
                        ))}
                    </div>
                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 space-y-2">
                        <div className="flex justify-between text-sm text-slate-600">
                            <span>Subtotal</span>
                            <span>{formatCurrency(order.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-600">
                            <span>Delivery Fee</span>
                            <span>{formatCurrency(order.deliveryFee || 0)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-slate-900 text-base pt-2 border-t border-slate-200">
                            <span>Order Total</span>
                            <span className="text-green-600">{formatCurrency(order.totalAmount)}</span>
                        </div>
                    </div>
                </div>

                {/* Delivery / Buyer Info */}
                {order.deliveryAddress && (
                    <div className="bg-white rounded-xl border border-slate-200 p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <MapPin className="w-5 h-5 text-green-600" />
                            <h2 className="font-bold text-slate-900">Delivery Address</h2>
                        </div>
                        <div className="text-sm text-slate-700 space-y-1.5">
                            <p className="font-semibold text-slate-900">{order.deliveryAddress.recipientName}</p>
                            {order.deliveryAddress.recipientPhone && (
                                <p className="flex items-center gap-1.5 text-slate-500">
                                    <Phone className="w-3.5 h-3.5" />
                                    {order.deliveryAddress.recipientPhone}
                                </p>
                            )}
                            <p>{order.deliveryAddress.street}</p>
                            <p>
                                {order.deliveryAddress.city}
                                {order.deliveryAddress.lga ? `, ${order.deliveryAddress.lga}` : ""} — {order.deliveryAddress.state}
                            </p>
                        </div>
                    </div>
                )}

                {/* Timeline */}
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
            </div>
        </div>
    );
}
