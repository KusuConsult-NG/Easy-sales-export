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
                            : "text-gray-300"
                            }`}
                    />
                </button>
            ))}
        </div>
    );
}

// Helper to convert FieldValue | Timestamp | Date to Date
function toDate(value: any): Date {
    if (value instanceof Date) return value;
    if (value && typeof value.toDate === 'function') return value.toDate();
    return new Date();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            (Date.now() - toDate(review.createdAt).getTime()) / (1000 * 60 * 60 * 24)
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
                return "bg-yellow-100 text-yellow-800";
            case "approved":
                return "bg-green-100 text-green-800";
            case "rejected":
                return "bg-red-100 text-red-800";
            default:
                return "bg-gray-100 text-gray-800";
        }
    };

    const canEdit = (review: ProductReview) => {
        const daysSince = Math.floor(
            (Date.now() - toDate(review.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        return daysSince <= 30;
    };

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-4xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        My Reviews
                    </h1>
                    <p className="text-gray-600">
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
                                    className="bg-white rounded-2xl shadow-lg p-6"
                                >
                                    {/* Header */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <Package className="w-5 h-5 text-primary" />
                                                <span className="font-semibold text-gray-900">
                                                    Product: {review.productId.slice(0, 16)}...
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                <Calendar className="w-4 h-4" />
                                                {toDate(review.createdAt).toLocaleDateString()}
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
                                                className="p-2 hover:bg-gray-100 rounded-lg transition"
                                                title="Edit review"
                                            >
                                                <Edit className="w-5 h-5 text-gray-600" />
                                            </button>
                                        )}
                                    </div>

                                    {/* Review Content */}
                                    {isEditing ? (
                                        <div className="space-y-4">
                                            {/* Edit Rating */}
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                    Rating
                                                </label>
                                                <StarRating rating={editRating} onRate={setEditRating} />
                                            </div>

                                            {/* Edit Comment */}
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                                    Review
                                                </label>
                                                <textarea
                                                    value={editComment}
                                                    onChange={(e) => setEditComment(e.target.value)}
                                                    rows={4}
                                                    maxLength={500}
                                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary resize-none"
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
                                                    className="flex-1 px-4 py-2 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition disabled:opacity-50"
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

                                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                                                <p className="text-sm text-blue-900">
                                                    <strong>Note:</strong> Updated reviews will be re-submitted for moderation.
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <StarRating rating={review.rating} />
                                            <p className="text-gray-900 mt-3 leading-relaxed">
                                                {review.comment}
                                            </p>

                                            {review.status === "rejected" && review.rejectionReason && (
                                                <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4">
                                                    <p className="text-sm font-semibold text-red-900 mb-1">
                                                        Rejection Reason:
                                                    </p>
                                                    <p className="text-sm text-red-800">
                                                        {review.rejectionReason}
                                                    </p>
                                                </div>
                                            )}

                                            {!editable && review.status !== "rejected" && (
                                                <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
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
                    <div className="text-center py-12 bg-white rounded-2xl">
                        <Star className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">
                            No Reviews Yet
                        </h3>
                        <p className="text-gray-500 mb-6">
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
