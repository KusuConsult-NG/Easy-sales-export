/**
 * Marketplace Orders Page
 * 
 * View all buyer orders with filtering and tracking
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { Package, Clock, CheckCircle, XCircle, Search, Eye, AlertCircle, Loader2, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import { getBuyerOrdersAction, confirmOrderReceiptAction, cancelOrderAction } from "@/app/actions/marketplace";
import { useToast } from "@/contexts/ToastContext";
import { formatCurrency } from "@/lib/utils";
import { formatLocalDate } from "@/lib/date-utils";
import { useDebounce } from "@/hooks/useDebounce";
import { logger } from "@/lib/logger";

export default function OrdersPage() {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [processingId, setProcessingId] = useState<string | null>(null);
    const { showToast } = useToast();

    // Pagination State
    const [lastId, setLastId] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);

    const debouncedSearch = useDebounce(searchQuery, 500);

    const fetchOrders = useCallback(async (isReset: boolean = false) => {
        try {
            if (isReset) {
                setLoading(true);
            } else {
                setLoadingMore(true);
            }

            const currentLastId = isReset ? undefined : lastId;
            const result = await getBuyerOrdersAction({
                limit: 20,
                lastId: currentLastId,
                status: filterStatus
            });

            if (result.success && result.data?.orders) {
                setOrders(prev => isReset ? result.data!.orders : [...prev, ...result.data!.orders]);
                setLastId(result.data?.lastId);
                setHasMore(!!result.data?.hasMore);
            } else if (result.error) {
                logger.error("Failed to load orders:", { error: result.error });
            }
        } catch (error) {
            logger.error("Failed to load orders:", { error });
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [filterStatus, lastId]);

    // Effect for Filter changes (Reset)
    useEffect(() => {
        fetchOrders(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterStatus]);

    function handleLoadMore() {
        if (!loadingMore && hasMore) {
            fetchOrders(false);
        }
    };

    async function handleConfirmReceipt(orderId: string) {
        if (!confirm("Are you sure you have received this order? This will release funds to the seller.")) return;

        setProcessingId(orderId);
        try {
            const result = await confirmOrderReceiptAction(orderId);
            if (result.success) {
                showToast("Order confirmed! Escrow pending admin release.", "success");
                // Update local status instead of full reload to save bandwidth
                setOrders(prev => prev.map(o => o.orderId === orderId ? { ...o, status: 'delivered' } : o));
            } else {
                showToast(result.error || "Failed to confirm", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setProcessingId(null);
        }
    };

    async function handleCancelOrder(orderId: string) {
        if (!confirm("Are you sure you want to cancel this order? This will release reserved inventory and cancel any pending escrow.")) return;

        setProcessingId(orderId);
        try {
            const result = await cancelOrderAction(orderId);
            if (result.success) {
                showToast("Order cancelled successfully", "success");
                setOrders(prev => prev.map(o => o.orderId === orderId ? { ...o, status: 'cancelled' } : o));
            } else {
                showToast(result.error || "Failed to cancel order", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setProcessingId(null);
        }
    };

    const getStatusConfig = (status: string) => {
        const configs = {
            pending_payment: {
                bg: "bg-yellow-100",
                text: "text-yellow-700",
                label: "Pending Payment",
                icon: Clock
            },
            processing: {
                bg: "bg-blue-100",
                text: "text-blue-700",
                label: "Processing",
                icon: Clock
            },
            in_transit: {
                bg: "bg-orange-100",
                text: "text-orange-700",
                label: "In Transit",
                icon: Truck
            },
            delivered: {
                bg: "bg-green-100",
                text: "text-green-700",
                label: "Delivered",
                icon: CheckCircle
            },
            cancelled: {
                bg: "bg-red-100",
                text: "text-red-700",
                label: "Cancelled",
                icon: XCircle
            }
        };
        return configs[status as keyof typeof configs] || configs.processing;
    };

    // Client-side filtering for search query on *loaded* orders
    const visibleOrders = orders.filter(order => {
        if (!searchQuery) return true;
        const lowerQuery = searchQuery.toLowerCase();
        return order.orderId.toLowerCase().includes(lowerQuery);
    });

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-8 py-6">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        My Orders
                    </h1>
                    <p className="text-slate-600">
                        Track and manage all your marketplace orders. All payments are held in <span className="font-bold text-primary">Escrow</span> until you confirm receipt.
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-8">
                {/* Filters Bar */}
                <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by Order ID..."
                                className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                        </div>

                        {/* Status Filter */}
                        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
                            {["all", "pending_payment", "processing", "in_transit", "delivered", "cancelled"].map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={`px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition-colors ${filterStatus === status
                                        ? "bg-green-600 text-white"
                                        : "bg-slate-100 text-slate-900 hover:bg-slate-200"
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
                    {loading && orders.length === 0 ? (
                        <div className="min-h-[200px] flex items-center justify-center">
                            <Loader2 className="w-12 h-12 animate-spin text-primary" />
                        </div>
                    ) : visibleOrders.length === 0 ? (
                        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                            <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                No orders found
                            </h3>
                            <Link
                                href="/marketplace"
                                className="inline-block px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700"
                            >
                                Browse Marketplace
                            </Link>
                        </div>
                    ) : (
                        visibleOrders.map((order) => {
                            const statusConfig = getStatusConfig(order.status);
                            const StatusIcon = statusConfig.icon;
                            // Use first item for display title if multiple
                            const displayTitle = order.items && order.items.length > 0
                                ? `${order.items[0].productTitle}` + (order.items.length > 1 ? ` + ${order.items.length - 1} more` : "")
                                : "Order";

                            return (
                                <div
                                    key={order.orderId}
                                    className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow"
                                >
                                    {/* Header */}
                                    <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-3 rounded-xl ${statusConfig.bg}`}>
                                                <StatusIcon className={`w-6 h-6 ${statusConfig.text}`} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-lg text-slate-900">
                                                    {displayTitle}
                                                </h3>
                                                <p className="text-sm text-slate-600">
                                                    Order {order.orderId} • {formatLocalDate(order.createdAt)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {order.paymentStatus === "escrow_held" && (
                                                <div className="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-bold rounded-full flex items-center gap-1">
                                                    <ShieldCheck className="w-3 h-3" />
                                                    Escrow Secured
                                                </div>
                                            )}
                                            <span className={`px-4 py-2 rounded-full text-sm font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
                                                {statusConfig.label}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Details Grid */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                        <div>
                                            <span className="text-sm text-slate-500">Total Amount</span>
                                            <p className="font-semibold text-slate-900">{formatCurrency(order.totalAmount)}</p>
                                        </div>
                                        <div>
                                            <span className="text-sm text-slate-500">Items</span>
                                            <p className="font-semibold text-slate-900">{order.items?.length || 0}</p>
                                        </div>
                                        <div>
                                            <span className="text-sm text-slate-500">Payment Status</span>
                                            <p className="font-semibold text-slate-900 capitalize">{order.paymentStatus.replace("_", " ")}</p>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                                        <Link
                                            href={`/marketplace/buyer/orders/${order.orderId}`}
                                            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-semibold text-sm"
                                        >
                                            <Eye className="w-4 h-4" />
                                            View Details
                                        </Link>

                                        {order.status === "pending_payment" && (
                                            <button
                                                onClick={() => handleCancelOrder(order.orderId)}
                                                disabled={processingId === order.orderId}
                                                className="px-4 py-2 border border-red-500 text-red-500 hover:bg-red-50 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center gap-1.5 transition"
                                            >
                                                {processingId === order.orderId ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <XCircle className="w-4 h-4" />
                                                )}
                                                Cancel Order
                                            </button>
                                        )}

                                        {(order.status === "processing" || order.status === "in_transit" || order.status === "shipped") && order.paymentStatus === "escrow_held" && (
                                            <button
                                                onClick={() => handleConfirmReceipt(order.orderId)}
                                                disabled={processingId === order.orderId}
                                                className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 shadow-lg shadow-green-600/20 disabled:opacity-50 flex items-center gap-2"
                                            >
                                                {processingId === order.orderId ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <CheckCircle className="w-4 h-4" />
                                                )}
                                                Confirm Receipt
                                            </button>
                                        )}

                                        {order.status === "delivered" && (
                                            <div className="text-teal-600 text-sm font-semibold flex items-center gap-2">
                                                <CheckCircle className="w-4 h-4" />
                                                Product Received / Pending Admin Payout
                                            </div>
                                        )}

                                        {order.status === "completed" && (
                                            <div className="text-green-600 text-sm font-semibold flex items-center gap-2">
                                                <CheckCircle className="w-4 h-4" />
                                                Funds Released
                                            </div>
                                        )}

                                        {(order.status === "delivered" || order.status === "completed") && (
                                            <Link
                                                href={`/marketplace/buyer/orders/${order.orderId}/review?productId=${order.items?.[0]?.productId || ""}&sellerId=${order.items?.[0]?.sellerId || ""}`}
                                                className="flex items-center gap-1.5 px-4 py-2 border border-yellow-400 text-yellow-700 rounded-lg text-sm font-semibold hover:bg-yellow-50 transition"
                                            >
                                                ⭐ Leave a Review
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Load More */}
                {hasMore && (
                    <div className="mt-8 flex justify-center">
                        <button
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="px-6 py-3 bg-white border border-slate-300 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 transition flex items-center gap-2 disabled:opacity-50"
                        >
                            {loadingMore ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Loading...
                                </>
                            ) : (
                                "Load More Orders"
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
