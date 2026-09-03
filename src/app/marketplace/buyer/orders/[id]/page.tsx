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
import { confirmOrderReceiptAction, cancelOrderAction } from "@/app/actions/marketplace";
import { getTrackingUpdatesAction } from "@/app/actions/order-management";
import type { TrackingUpdate } from "@/lib/logistics";
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
    const [trackingUpdates, setTrackingUpdates] = useState<TrackingUpdate[]>([]);
    const [loadingTracking, setLoadingTracking] = useState(false);

    useEffect(() => {
        if (!id) return;
        getOrderByIdAction(id as string).then((res) => {
            if (res.success && res.data && "order" in res.data) {
                setOrder(res.data.order as unknown as Order);
            } else {
                setError((res as any).error || "Order not found");
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

    async function handleConfirmReceipt() {
        if (!confirm("Confirm you received this order? Escrow will be marked ready for admin release.")) return;
        setConfirming(true);
        try {
            const result = await confirmOrderReceiptAction(id as string);
            if (result.success) {
                showToast("Order confirmed! Escrow pending admin release.", "success");
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

    async function handleCancelOrder() {
        if (!confirm("Are you sure you want to cancel this order? This will release reserved inventory and cancel any pending escrow.")) return;
        setConfirming(true);
        try {
            const result = await cancelOrderAction(id as string);
            if (result.success) {
                showToast("Order cancelled successfully", "success");
                setOrder(prev => prev ? { ...prev, status: "cancelled" as OrderStatus } : prev);
            } else {
                showToast((result as any).error || "Failed to cancel order", "error");
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
    /**
     * The next item still waiting for a review.
     *
     * The link below was hardcoded to `order.items[0]`, and `reviewSubmitted`
     * was set by the FIRST review of any item — so on a multi-item order the
     * buyer reviewed item one and the control vanished. With the flag corrected
     * to mean "every item reviewed", the control stays; pointing it at items[0]
     * would now send them back to the product they have already reviewed, which
     * the action refuses. It has to walk to the next unreviewed one.
     */
    const reviewedIds: string[] = ((order as unknown as { reviewedProductIds?: string[] }).reviewedProductIds) ?? [];
    const nextUnreviewedItem = (order.items ?? []).find(
        (item) => !reviewedIds.includes(String((item as { productId?: string }).productId ?? "")),
    );
    const canReview =
        (order.status === "delivered" || order.status === "completed") &&
        !order.reviewSubmitted &&
        !!nextUnreviewedItem;
    const canDispute = ["processing", "shipped", "delivered"].includes(order.status) &&
        order.status !== "disputed" && order.status !== "completed" && order.status !== "cancelled";

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
                            {/* Was: "We'll reach out via your registered email." — #312.
                                Nothing on the dispute path sends an email; resolution
                                notifies in-app, by SMS and by push. Same false claim as
                                the seller's copy of this banner. */}
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
                    {order.status === "pending_payment" && (
                        <button
                            onClick={handleCancelOrder}
                            disabled={confirming}
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 shadow-lg shadow-red-600/20 disabled:opacity-50 transition-all"
                        >
                            {confirming
                                ? <Loader2 className="w-5 h-5 animate-spin" />
                                : <XCircle className="w-5 h-5" />}
                            Cancel Order
                        </button>
                    )}

                    {canConfirm && (
                        <button
                            onClick={handleConfirmReceipt}
                            disabled={confirming}
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-600/20 disabled:opacity-50 transition-all"
                        >
                            {confirming
                                ? <Loader2 className="w-5 h-5 animate-spin" />
                                : <CheckCircle className="w-5 h-5" />}
                            Confirm Receipt
                        </button>
                    )}

                    {canReview && (
                        <Link
                            href={`/marketplace/buyer/orders/${id}/review?productId=${(nextUnreviewedItem as { productId?: string })?.productId || ""}&sellerId=${order.sellerId}`}
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

                    {canDispute && (
                        <Link
                            href={`/dashboard/disputes/new?orderId=${id}`}
                            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 border-2 border-red-400 text-red-600 rounded-xl font-bold hover:bg-red-50 transition-all"
                        >
                            <AlertCircle className="w-5 h-5" />
                            Raise Dispute
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}
