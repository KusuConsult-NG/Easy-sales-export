"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    ArrowLeft,
    Star,
    Package,
    Loader2,
    Send,
} from "lucide-react";
import { createReviewAction } from "@/app/actions/reviews";
import { getOrderByIdAction } from "@/app/actions/orders";
import type { Order } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

function NewReviewContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const orderId = searchParams.get("orderId");

    const [order, setOrder] = useState<Order | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [selectedProductId, setSelectedProductId] = useState<string>("");
    const [rating, setRating] = useState(5);
    const [hoverRating, setHoverRating] = useState(0);
    const [comment, setComment] = useState("");

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
                // Auto-select first item if only one
                if (result.order.items.length === 1) {
                    setSelectedProductId(result.order.items[0].productId);
                }
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

        if (!selectedProductId) {
            showToast("Please select a product to review", "error");
            return;
        }

        if (comment.trim().length < 20) {
            showToast("Review must be at least 20 characters", "error");
            return;
        }

        if (!orderId) return;

        setSubmitting(true);
        try {
            const result = await createReviewAction({
                productId: selectedProductId,
                orderId,
                rating,
                comment,
            });

            if (result.success) {
                showToast("Review submitted successfully! It will appear after moderation.", "success");
                router.push("/dashboard/orders");
            } else {
                showToast(result.error || "Failed to submit review", "error");
            }
        } catch (error) {
            showToast("Failed to submit review", "error");
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

    const selectedProduct = order.items.find((item) => item.productId === selectedProductId);

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
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Leave a Review
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Share your experience with this product
                    </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
                    {/* Select Product */}
                    {order.items.length > 1 && (
                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                Select Product *
                            </label>
                            <div className="space-y-2">
                                {order.items.map((item) => (
                                    <button
                                        key={item.productId}
                                        type="button"
                                        onClick={() => setSelectedProductId(item.productId)}
                                        className={`w-full p-4 rounded-xl border-2 transition text-left ${selectedProductId === item.productId
                                            ? "border-primary bg-primary/5"
                                            : "border-gray-200 dark:border-gray-700 hover:border-primary/50"
                                            }`}
                                    >
                                        <div className="font-semibold text-gray-900 dark:text-white mb-1">
                                            {item.productTitle}
                                        </div>
                                        <div className="text-sm text-gray-600 dark:text-gray-400">
                                            Quantity: {item.quantity} • {formatCurrency(item.totalPrice)}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Product Display (if auto-selected) */}
                    {order.items.length === 1 && selectedProduct && (
                        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                            <div className="flex items-center gap-3">
                                <Package className="w-5 h-5 text-primary" />
                                <div>
                                    <h3 className="font-semibold text-gray-900 dark:text-white">
                                        {selectedProduct.productTitle}
                                    </h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                        Quantity: {selectedProduct.quantity} • {formatCurrency(selectedProduct.totalPrice)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Rating */}
                    <div className="mb-6">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                            Your Rating *
                        </label>
                        <div className="flex items-center gap-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRating(star)}
                                    onMouseEnter={() => setHoverRating(star)}
                                    onMouseLeave={() => setHoverRating(0)}
                                    className="transition-transform hover:scale-110"
                                >
                                    <Star
                                        className={`w-10 h-10 ${star <= (hoverRating || rating)
                                            ? "fill-yellow-400 text-yellow-400"
                                            : "text-gray-300 dark:text-gray-600"
                                            }`}
                                    />
                                </button>
                            ))}
                            <span className="ml-3 text-lg font-semibold text-gray-900 dark:text-white">
                                {rating} / 5
                            </span>
                        </div>
                    </div>

                    {/* Comment */}
                    <div className="mb-6">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                            Your Review * (minimum 20 characters)
                        </label>
                        <textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            rows={6}
                            maxLength={500}
                            placeholder="Tell us about your experience with this product. What did you like? What could be better?"
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary resize-none"
                        />
                        <div className="mt-2 flex justify-between text-sm">
                            <span className={comment.length < 20 ? "text-red-500" : "text-gray-500"}>
                                {comment.length}/20 characters minimum
                            </span>
                            <span className="text-gray-500">{comment.length}/500</span>
                        </div>
                    </div>

                    {/* Info */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
                        <p className="text-sm text-blue-900 dark:text-blue-200">
                            <strong>Note:</strong> Your review will be marked as a verified purchase and will appear on the
                            product page after admin approval. You can edit your review within 30 days of submission.
                        </p>
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
                            disabled={submitting || comment.length < 20 || !selectedProductId}
                            className="flex-1 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Submitting...
                                </>
                            ) : (
                                <>
                                    <Send className="w-5 h-5" />
                                    Submit Review
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function NewReviewPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
            </div>
        }>
            <NewReviewContent />
        </Suspense>
    );
}
