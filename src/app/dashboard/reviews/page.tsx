"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Star,
    Loader2,
    Calendar,
    Package,
    Edit,
    Trash2,
    Clock,
} from "lucide-react";
import { getUserReviewsAction, updateReviewAction } from "@/app/actions/reviews";
import type { ProductReview } from "@/lib/types/marketplace";
import { useToast } from "@/contexts/ToastContext";

function StarRating({ rating, onRate }: { rating: number; onRate?: (r: number) => void }) {
    const [hover, setHover] = useState(0);

    return (
        <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
                <button
                    key={star}
                    type="button"
                    onClick={() => onRate?.(star)}
                    onMouseEnter={() => onRate && setHover(star)}
                    onMouseLeave={() => onRate && setHover(0)}
                    disabled={!onRate}
                    className={onRate ? "cursor-pointer transition-transform hover:scale-110" : "cursor-default"}
                >
                    <Star
                        className={`w-5 h-5 ${star <= (hover || rating)
                                ? "fill-yellow-400 text-yellow-400"
                                : "text-gray-300 dark:text-gray-600"
                            }`}
                    />
                </button>
            ))}
        </div>
    );
}

export default function MyReviewsPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [reviews, setReviews] = useState<ProductReview[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editRating, setEditRating] = useState(5);
    const [editComment, setEditComment] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        loadReviews();
    }, []);

    async function loadReviews() {
        setLoading(true);
        try {
            const result = await getUserReviewsAction();
            if (result.success) {
                setReviews(result.reviews || []);
            } else {
                showToast(result.error || "Failed to load reviews", "error");
            }
        } catch (error) {
            showToast("Failed to load reviews", "error");
        } finally {
            setLoading(false);
        }
    }

    function startEdit(review: ProductReview) {
        // Check if within 30-day window
        const daysSince = Math.floor(
            (Date.now() - new Date(review.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSince > 30) {
            showToast("Reviews can only be edited within 30 days", "error");
            return;
        }

        setEditingId(review.id);
        setEditRating(review.rating);
        setEditComment(review.comment);
    }

    function cancelEdit() {
        setEditingId(null);
        setEditRating(5);
        setEditComment("");
    }

    async function saveEdit(reviewId: string) {
        if (editComment.trim().length < 20) {
            showToast("Review must be at least 20 characters", "error");
            return;
        }

        setSubmitting(true);
        try {
            const result = await updateReviewAction(reviewId, editRating, editComment);
            if (result.success) {
                showToast("Review updated successfully! It will be re-moderated.", "success");
                cancelEdit();
                loadReviews();
            } else {
                showToast(result.error || "Failed to update review", "error");
            }
        } catch (error) {
            showToast("Failed to update review", "error");
        } finally {
            setSubmitting(false);
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case "pending":
                return "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200";
            case "approved":
                return "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200";
            case "rejected":
                return "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200";
            default:
                return "bg-gray-100 dark:bg-gray-900/20 text-gray-800 dark:text-gray-200";
        }
    };

    const canEdit = (review: ProductReview) => {
        const daysSince = Math.floor(
            (Date.now() - new Date(review.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        return daysSince <= 30;
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-4xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        My Reviews
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Manage your product reviews and ratings
                    </p>
                </div>

                {/* Reviews List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    </div>
                ) : reviews.length > 0 ? (
                    <div className="space-y-6">
                        {reviews.map((review) => {
                            const isEditing = editingId === review.id;
                            const editable = canEdit(review);

                            return (
                                <div
                                    key={review.id}
                                    className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6"
                                >
                                    {/* Header */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <Package className="w-5 h-5 text-primary" />
                                                <span className="font-semibold text-gray-900 dark:text-white">
                                                    Product: {review.productId.slice(0, 16)}...
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                <Calendar className="w-4 h-4" />
                                                {new Date(review.createdAt).toLocaleDateString()}
                                                <span
                                                    className={`ml-2 px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(
                                                        review.status
                                                    )}`}
                                                >
                                                    {review.status.charAt(0).toUpperCase() + review.status.slice(1)}
                                                </span>
                                            </div>
                                        </div>

                                        {!isEditing && editable && review.status !== "rejected" && (
                                            <button
                                                onClick={() => startEdit(review)}
                                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                                                title="Edit review"
                                            >
                                                <Edit className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                                            </button>
                                        )}
                                    </div>

                                    {/* Review Content */}
                                    {isEditing ? (
                                        <div className="space-y-4">
                                            {/* Edit Rating */}
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                    Rating
                                                </label>
                                                <StarRating rating={editRating} onRate={setEditRating} />
                                            </div>

                                            {/* Edit Comment */}
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                    Review
                                                </label>
                                                <textarea
                                                    value={editComment}
                                                    onChange={(e) => setEditComment(e.target.value)}
                                                    rows={4}
                                                    maxLength={500}
                                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary resize-none"
                                                />
                                                <div className="mt-1 flex justify-between text-sm">
                                                    <span className={editComment.length < 20 ? "text-red-500" : "text-gray-500"}>
                                                        {editComment.length}/20 min
                                                    </span>
                                                    <span className="text-gray-500">{editComment.length}/500</span>
                                                </div>
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="flex gap-3 pt-2">
                                                <button
                                                    onClick={cancelEdit}
                                                    disabled={submitting}
                                                    className="flex-1 px-4 py-2 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-50"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={() => saveEdit(review.id)}
                                                    disabled={submitting || editComment.length < 20}
                                                    className="flex-1 px-4 py-2 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                                >
                                                    {submitting ? (
                                                        <>
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                            Saving...
                                                        </>
                                                    ) : (
                                                        "Save Changes"
                                                    )}
                                                </button>
                                            </div>

                                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
                                                <p className="text-sm text-blue-900 dark:text-blue-200">
                                                    <strong>Note:</strong> Updated reviews will be re-submitted for moderation.
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <StarRating rating={review.rating} />
                                            <p className="text-gray-900 dark:text-white mt-3 leading-relaxed">
                                                {review.comment}
                                            </p>

                                            {review.status === "rejected" && review.rejectionReason && (
                                                <div className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                                                    <p className="text-sm font-semibold text-red-900 dark:text-red-200 mb-1">
                                                        Rejection Reason:
                                                    </p>
                                                    <p className="text-sm text-red-800 dark:text-red-300">
                                                        {review.rejectionReason}
                                                    </p>
                                                </div>
                                            )}

                                            {!editable && review.status !== "rejected" && (
                                                <div className="mt-4 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                                    <Clock className="w-4 h-4" />
                                                    <span>Review cannot be edited after 30 days</span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl">
                        <Star className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                            No Reviews Yet
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 mb-6">
                            You haven't written any reviews yet
                        </p>
                        <button
                            onClick={() => router.push("/dashboard/orders")}
                            className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition"
                        >
                            View Orders
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
