"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    AlertTriangle,
    Package,
    ArrowLeft,
    Loader2,
    Upload,
    X,
} from "lucide-react";
import { createDisputeAction } from "@/app/actions/disputes";
import { getOrderByIdAction } from "@/app/actions/orders";
import type { Order, DisputeReason } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

const DISPUTE_REASONS: { value: DisputeReason; label: string; description: string }[] = [
    {
        value: "not_received",
        label: "Item Not Received",
        description: "Order not delivered within expected timeframe",
    },
    {
        value: "wrong_item",
        label: "Wrong Item",
        description: "Received different product than ordered",
    },
    {
        value: "damaged",
        label: "Damaged/Defective",
        description: "Product arrived damaged or not working",
    },
    {
        value: "fake_product",
        label: "Fake/Counterfeit",
        description: "Product appears to be counterfeit or not as described",
    },
    {
        value: "other",
        label: "Other Issue",
        description: "Any other problem with the order",
    },
];

function NewDisputePageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const orderId = searchParams.get("orderId");

    const [order, setOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [selectedReason, setSelectedReason] = useState<DisputeReason>("not_received");
    const [description, setDescription] = useState("");
    const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);

    useEffect(() => {
        if (orderId) {
            loadOrder();
        } else {
            showToast("No order specified", "error");
            router.push("/dashboard/orders");
        }
    }, [orderId]);

    async function loadOrder() {
        if (!orderId) return;

        try {
            const result = await getOrderByIdAction(orderId);
            if (result.success && result.order) {
                setOrder(result.order);
            } else {
                showToast("Order not found", "error");
                router.push("/dashboard/orders");
            }
        } catch (error) {
            showToast("Failed to load order", "error");
            router.push("/dashboard/orders");
        } finally {
            setLoading(false);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (description.length < 50) {
            showToast("Description must be at least 50 characters", "error");
            return;
        }

        if (!orderId) return;

        setSubmitting(true);
        try {
            const result = await createDisputeAction({
                orderId,
                reason: selectedReason,
                description,
                evidenceUrls,
            });

            if (result.success) {
                showToast("Dispute submitted successfully. Our team will review it shortly.", "success");
                router.push("/dashboard/orders");
            } else {
                showToast(result.error || "Failed to submit dispute", "error");
            }
        } catch (error) {
            showToast("Failed to submit dispute", "error");
        } finally {
            setSubmitting(false);
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

    const selectedReasonData = DISPUTE_REASONS.find(r => r.value === selectedReason);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-3xl mx-auto px-4">
                {/* Back Button */}
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-primary mb-6 transition"
                >
                    <ArrowLeft className="w-5 h-5" />
                    Back to Orders
                </button>

                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                            Report Issue
                        </h1>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400">
                        Submit a dispute for order {order.orderNumber}
                    </p>
                </div>

                {/* Order Summary */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <Package className="w-5 h-5 text-primary" />
                        Order Summary
                    </h2>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Order Number:</span>
                            <span className="font-semibold text-gray-900 dark:text-white">{order.orderNumber}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Order Date:</span>
                            <span className="text-gray-900 dark:text-white">
                                {new Date(order.createdAt).toLocaleDateString()}
                            </span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Total Amount:</span>
                            <span className="font-bold text-primary">{formatCurrency(order.totalAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Status:</span>
                            <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-xs font-semibold rounded capitalize">
                                {order.status.replace("_", " ")}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Dispute Form */}
                <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                    {/* Reason Selection */}
                    <div className="mb-6">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                            What's the issue? *
                        </label>
                        <div className="space-y-2">
                            {DISPUTE_REASONS.map((reason) => (
                                <button
                                    key={reason.value}
                                    type="button"
                                    onClick={() => setSelectedReason(reason.value)}
                                    className={`w-full p-4 rounded-xl border-2 transition text-left ${selectedReason === reason.value
                                            ? "border-primary bg-primary/5"
                                            : "border-gray-200 dark:border-gray-700 hover:border-primary/50"
                                        }`}
                                >
                                    <div className="font-semibold text-gray-900 dark:text-white mb-1">
                                        {reason.label}
                                    </div>
                                    <div className="text-sm text-gray-600 dark:text-gray-400">
                                        {reason.description}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Description */}
                    <div className="mb-6">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                            Describe the issue in detail * (minimum 50 characters)
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={6}
                            placeholder="Please provide a detailed description of the issue, including what you expected vs what you received, any relevant dates, etc."
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary resize-none"
                        />
                        <p className="mt-2 text-sm text-gray-500">
                            {description.length}/50 characters minimum
                        </p>
                    </div>

                    {/* Evidence Upload Placeholder */}
                    <div className="mb-6">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                            Evidence (optional)
                        </label>
                        <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center">
                            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                            <p className="text-gray-500 text-sm mb-2">
                                Upload photos or documents to support your claim
                            </p>
                            <p className="text-xs text-gray-400">
                                Feature coming soon - For now, please include evidence descriptions in your text
                            </p>
                        </div>
                    </div>

                    {/* Warning */}
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 mb-6">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-1">
                                    Important Information
                                </h3>
                                <ul className="text-sm text-yellow-800 dark:text-yellow-300 space-y-1">
                                    <li>• Once submitted, this dispute will be reviewed by our admin team</li>
                                    <li>• Your order payment will be held in escrow until resolution</li>
                                    <li>• False disputes may result in account suspension</li>
                                    <li>• Please be honest and provide accurate information</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => router.back()}
                            className="flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || description.length < 50}
                            className="flex-1 px-6 py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Submitting...
                                </>
                            ) : (
                                <>
                                    <AlertTriangle className="w-5 h-5" />
                                    Submit Dispute
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function NewDisputePagePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        }>
            <NewDisputePageContent />
        </Suspense>
    );
}
