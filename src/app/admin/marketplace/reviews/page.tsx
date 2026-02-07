"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Star,
    Search,
    Filter,
    CheckCircle,
    XCircle,
    Clock,
    Loader2,
    Eye,
} from "lucide-react";
import { getAdminReviewsAction, moderateReviewAction } from "@/app/actions/reviews";
import type { ProductReview } from "@/lib/types/marketplace";
import { useToast } from "@/contexts/ToastContext";

function StarDisplay({ rating }: { rating: number }) {
    return (
        <div className="flex gap-0.5">
            {[...Array(5)].map((_, i) => (
                <Star
                    key={i}
                    className={`w-4 h-4 ${i < rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
                        }`}
                />
            ))}
        </div>
    );
}

export default function AdminReviewsPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [reviews, setReviews] = useState<ProductReview[]>([]);
    const [filteredReviews, setFilteredReviews] = useState<ProductReview[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

    useEffect(() => {
        loadReviews();
    }, []);

    useEffect(() => {
        filterReviews();
    }, [searchQuery, statusFilter, reviews]);

    async function loadReviews() {
        setLoading(true);
        try {
            const result = await getAdminReviewsAction();
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

    function filterReviews() {
        let filtered = [...reviews];

        if (statusFilter !== "all") {
            filtered = filtered.filter((r) => r.status === statusFilter);
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(
                (r) =>
                    r.productId.toLowerCase().includes(query) ||
                    r.comment.toLowerCase().includes(query) ||
                    r.userId.toLowerCase().includes(query)
            );
        }

        setFilteredReviews(filtered);
    }

    async function handleModerate(reviewId: string, status: "approved" | "rejected") {
        setProcessingId(reviewId);
        try {
            const result = await moderateReviewAction(reviewId, status);
            if (result.success) {
                showToast(`Review ${status}`, "success");
                loadReviews();
            } else {
                showToast(result.error || `Failed to ${status} review`, "error");
            }
        } catch (error) {
            showToast(`Failed to ${status} review`, "error");
        } finally {
            setProcessingId(null);
        }
    }

    const stats = {
        pending: reviews.filter((r) => r.status === "pending").length,
        approved: reviews.filter((r) => r.status === "approved").length,
        rejected: reviews.filter((r) => r.status === "rejected").length,
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Review Moderation
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Approve or reject customer reviews
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
                                Pending Reviews
                            </h3>
                            <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
                        </div>
                        <p className="text-3xl font-bold text-yellow-900 dark:text-yellow-100">
                            {stats.pending}
                        </p>
                    </div>

                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-green-800 dark:text-green-200">
                                Approved
                            </h3>
                            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-500" />
                        </div>
                        <p className="text-3xl font-bold text-green-900 dark:text-green-100">
                            {stats.approved}
                        </p>
                    </div>

                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">
                                Rejected
                            </h3>
                            <XCircle className="w-5 h-5 text-red-600 dark:text-red-500" />
                        </div>
                        <p className="text-3xl font-bold text-red-900 dark:text-red-100">
                            {stats.rejected}
                        </p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Search
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by product, user ID, or comment..."
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        </div>

                        {/* Status Filter */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Status Filter
                            </label>
                            <div className="relative">
                                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value as any)}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary appearance-none"
                                >
                                    <option value="all">All Statuses</option>
                                    <option value="pending">Pending</option>
                                    <option value="approved">Approved</option>
                                    <option value="rejected">Rejected</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Reviews List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    </div>
                ) : filteredReviews.length > 0 ? (
                    <div className="space-y-4">
                        {filteredReviews.map((review) => (
                            <div
                                key={review.id}
                                className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <StarDisplay rating={review.rating} />
                                            <span
                                                className={`px-3 py-1 rounded-full text-sm font-semibold ${review.status === "pending"
                                                        ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200"
                                                        : review.status === "approved"
                                                            ? "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                                                            : "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200"
                                                    }`}
                                            >
                                                {review.status.charAt(0).toUpperCase() + review.status.slice(1)}
                                            </span>
                                            {review.verified && (
                                                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-xs font-semibold rounded-full">
                                                    Verified
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                                            Product: {review.productId} • User: {review.userId.slice(0, 12)} •{" "}
                                            {new Date(review.createdAt).toLocaleDateString()}
                                        </p>
                                        <p className="text-gray-900 dark:text-white mb-4">{review.comment}</p>
                                    </div>
                                </div>

                                {review.status === "pending" && (
                                    <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <button
                                            onClick={() => handleModerate(review.id, "approved")}
                                            disabled={processingId === review.id}
                                            className="flex-1 px-4 py-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            {processingId === review.id ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <CheckCircle className="w-4 h-4" />
                                            )}
                                            Approve
                                        </button>
                                        <button
                                            onClick={() => handleModerate(review.id, "rejected")}
                                            disabled={processingId === review.id}
                                            className="flex-1 px-4 py-2 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            {processingId === review.id ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <XCircle className="w-4 h-4" />
                                            )}
                                            Reject
                                        </button>
                                    </div>
                                )}

                                {review.status !== "pending" && (
                                    <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            {review.status === "approved" ? "Approved" : "Rejected"}{review.moderatedAt && ` on ${new Date(review.moderatedAt).toLocaleDateString()}`}
                                        </p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl">
                        <Eye className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 dark:text-gray-400 text-lg">
                            {searchQuery || statusFilter !== "all"
                                ? "No reviews match your filters"
                                : "No reviews found"}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
