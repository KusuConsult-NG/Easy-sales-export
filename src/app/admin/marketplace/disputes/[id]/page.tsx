"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    ArrowLeft,
    Package,
    AlertTriangle,
    User,
    Calendar,
    FileText,
    CheckCircle,
    Loader2,
} from "lucide-react";
import {
    getDisputeByIdAction,
    updateDisputeStatusAction,
} from "@/app/actions/disputes";
import { getOrderByIdAction } from "@/app/actions/orders";
import type { Dispute, Order, DisputeResolution } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

const DISPUTE_REASON_LABELS: Record<string, string> = {
    not_received: "Item Not Received",
    wrong_item: "Wrong Item",
    damaged: "Damaged/Defective",
    fake_product: "Fake/Counterfeit",
    other: "Other Issue",
};

export default function DisputeDetailPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const { showToast } = useToast();

    const [dispute, setDispute] = useState<Dispute | null>(null);
    const [order, setOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);
    const [resolving, setResolving] = useState(false);
    const [showResolutionModal, setShowResolutionModal] = useState(false);

    const [resolution, setResolution] = useState<DisputeResolution>("refund_buyer");
    const [adminNotes, setAdminNotes] = useState("");
    const [refundAmount, setRefundAmount] = useState("0");

    useEffect(() => {
        loadData();
    }, [params.id]);

    async function loadData() {
        setLoading(true);
        try {
            // Load dispute
            const disputeResult = await getDisputeByIdAction(params.id);
            if (!disputeResult.success || !disputeResult.dispute) {
                showToast("Dispute not found", "error");
                router.push("/admin/marketplace/disputes");
                return;
            }

            setDispute(disputeResult.dispute);

            // Load order
            const orderResult = await getOrderByIdAction(disputeResult.dispute.orderId);
            if (orderResult.success && orderResult.order) {
                setOrder(orderResult.order);
                setRefundAmount(orderResult.order.totalAmount.toString());
            }
        } catch (error) {
            showToast("Failed to load dispute", "error");
            router.push("/admin/marketplace/disputes");
        } finally {
            setLoading(false);
        }
    }

    async function handleResolve() {
        if (!dispute || !adminNotes.trim()) {
            showToast("Please provide admin notes", "error");
            return;
        }

        setResolving(true);
        try {
            const result = await updateDisputeStatusAction(
                dispute.id,
                resolution,
                adminNotes,
                resolution === "partial_refund" ? parseFloat(refundAmount) : undefined
            );

            if (result.success) {
                showToast("Dispute resolved successfully", "success");
                router.push("/admin/marketplace/disputes");
            } else {
                showToast(result.error || "Failed to resolve dispute", "error");
            }
        } catch (error) {
            showToast("Failed to resolve dispute", "error");
        } finally {
            setResolving(false);
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        );
    }

    if (!dispute || !order) return null;

    const daysAgo = Math.floor(
        (Date.now() - new Date(dispute.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-5xl mx-auto px-4">
                {/* Back Button */}
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-primary mb-6 transition"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back to Disputes
                </button>

                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                            Dispute #{dispute.id.slice(0, 12).toUpperCase()}
                        </h1>
                        <span
                            className={`px-4 py-2 rounded-xl font-semibold text-sm ${dispute.status === "open"
                                ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200"
                                : dispute.status === "under_review"
                                    ? "bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200"
                                    : "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                                }`}
                        >
                            {dispute.status.replace("_", " ").toUpperCase()}
                        </span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400">
                        Opened {daysAgo} day{daysAgo !== 1 ? "s" : ""} ago •{" "}
                        {new Date(dispute.createdAt).toLocaleString()}
                    </p>
                </div>

                {/* Order Information */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <Package className="w-6 h-6 text-primary" />
                        Order Information
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Order Number</p>
                            <p className="font-semibold text-gray-900 dark:text-white">{order.orderNumber}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Order Date</p>
                            <p className="text-gray-900 dark:text-white">
                                {new Date(order.createdAt).toLocaleDateString()}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Amount</p>
                            <p className="font-bold text-primary text-lg">{formatCurrency(order.totalAmount)}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Order Status</p>
                            <p className="capitalize text-gray-900 dark:text-white">{order.status.replace("_", " ")}</p>
                        </div>
                    </div>

                    {/* Order Items */}
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Order Items</p>
                        <div className="space-y-2">
                            {order.items.map((item, idx) => (
                                <div key={idx} className="flex justify-between text-sm">
                                    <span className="text-gray-900 dark:text-white">
                                        {item.productTitle} × {item.quantity}
                                    </span>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                        {formatCurrency(item.totalPrice)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Dispute Details */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <FileText className="w-6 h-6 text-primary" />
                        Dispute Details
                    </h2>

                    <div className="mb-4">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Reason</p>
                        <span className="inline-block px-4 py-2 bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200 font-semibold rounded-lg">
                            {DISPUTE_REASON_LABELS[dispute.reason] || dispute.reason}
                        </span>
                    </div>

                    <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Description</p>
                        <p className="text-gray-900 dark:text-white p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                            {dispute.description}
                        </p>
                    </div>

                    {dispute.evidenceUrls && dispute.evidenceUrls.length > 0 && (
                        <div className="mt-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Evidence</p>
                            <div className="flex gap-2">
                                {dispute.evidenceUrls.map((url, idx) => (
                                    <a
                                        key={idx}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline text-sm"
                                    >
                                        Evidence {idx + 1}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Parties */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                        <h3 className="font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                            <User className="w-5 h-5 text-primary" />
                            Buyer
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">ID: {dispute.buyerId}</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                        <h3 className="font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                            <User className="w-5 h-5 text-primary" />
                            Seller
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">ID: {dispute.sellerId}</p>
                    </div>
                </div>

                {/* Resolution Section */}
                {dispute.status !== "resolved" ? (
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                        <button
                            onClick={() => setShowResolutionModal(true)}
                            className="w-full px-6 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition flex items-center justify-center gap-2 text-lg"
                        >
                            <CheckCircle className="w-6 h-6" />
                            Resolve Dispute
                        </button>
                    </div>
                ) : (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-6">
                        <h3 className="font-bold text-green-900 dark:text-green-100 mb-2">Dispute Resolved</h3>
                        <p className="text-sm text-green-800 dark:text-green-200 mb-2">
                            Resolution: {dispute.resolution?.replace("_", " ").toUpperCase()}
                        </p>
                        {dispute.adminNotes && (
                            <>
                                <p className="text-sm text-green-800 dark:text-green-200 mb-1">Admin Notes:</p>
                                <p className="text-green-900 dark:text-green-100 bg-green-100 dark:bg-green-900/30 p-3 rounded-lg">
                                    {dispute.adminNotes}
                                </p>
                            </>
                        )}
                    </div>
                )}

                {/* Resolution Modal */}
                {showResolutionModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full p-8">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                Resolve Dispute
                            </h2>

                            {/* Resolution Type */}
                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                    Resolution Decision
                                </label>
                                <div className="space-y-2">
                                    {[
                                        { value: "refund_buyer", label: "Refund Buyer (Full)" },
                                        { value: "release_seller", label: "Release to Seller" },
                                        { value: "partial_refund", label: "Partial Refund" },
                                    ].map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setResolution(option.value as DisputeResolution)}
                                            className={`w-full p-4 rounded-xl border-2 transition text-left ${resolution === option.value
                                                ? "border-primary bg-primary/5"
                                                : "border-gray-200 dark:border-gray-700 hover:border-primary/50"
                                                }`}
                                        >
                                            <div className="font-semibold text-gray-900 dark:text-white">
                                                {option.label}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Refund Amount (for partial refund) */}
                            {resolution === "partial_refund" && (
                                <div className="mb-6">
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Refund Amount (₦)
                                    </label>
                                    <input
                                        type="number"
                                        value={refundAmount}
                                        onChange={(e) => setRefundAmount(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                        placeholder="Enter refund amount"
                                    />
                                    <p className="text-sm text-gray-500 mt-1">
                                        Order total: {formatCurrency(order.totalAmount)}
                                    </p>
                                </div>
                            )}

                            {/* Admin Notes */}
                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    Admin Notes (Required)
                                </label>
                                <textarea
                                    value={adminNotes}
                                    onChange={(e) => setAdminNotes(e.target.value)}
                                    rows={4}
                                    placeholder="Explain the reasoning behind this resolution..."
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary resize-none"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowResolutionModal(false)}
                                    className="flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleResolve}
                                    disabled={resolving || !adminNotes.trim()}
                                    className="flex-1 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {resolving ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Resolving...
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle className="w-5 h-5" />
                                            Resolve & Close
                                        </>
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
