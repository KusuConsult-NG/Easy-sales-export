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
import { useAdminData } from "@/hooks/useAdminData";
import { formatLocalDate } from "@/lib/date-utils";
import { humaniseCapitalised, shortId } from "@/lib/humanise";
import AdminReadFailed from "@/components/admin/AdminReadFailed";
import { statText } from "@/lib/admin-stat-display";

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

// Helper to convert FieldValue | Timestamp | Date to Date
function toDate(value: any): Date {
    if (value instanceof Date) return value;
    if (value && typeof value.toDate === 'function') return value.toDate();
    return new Date();
}

export default function AdminReviewsPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    const {
        data: reviews,
        loading,
        error: fetchError,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: loadReviews,
        meta
    } = useAdminData<ProductReview>({
        fetchAction: async (opts) => {
            const result = await getAdminReviewsAction({
                statusFilter: statusFilter,
                limit: opts.limit || 20,
                lastDocId: opts.lastDocId,
                sortOrder: sortOrder
            });
            /*
             *   #822 THE WHOLE SCREEN READ THE PAYLOAD AT THE WRONG LEVEL.
             *
             *   The owner: the cards are not returning the correct totals.
             *   On this screen they were not merely wrong, they were 0/0/0
             *   ALWAYS — and the table beneath them was empty always, for the
             *   same reason.
             *
             *   getAdminReviewsAction returns an ActionResponse:
             *
             *       { error: null, success: true,
             *         data: { reviews, stats, lastDocId, hasMore } }
             *
             *   and this read `result.reviews`, `result.stats` and
             *   `result.lastDocId` at the TOP level, where none of them exist.
             *   Every one resolved to undefined, so `data` fell to `[]`, `stats`
             *   to undefined, and the fallback below counted three statuses over
             *   an empty array.
             *
             *   The action was computing the right numbers the whole time —
             *   three exact `.count()` queries — and nothing read them.
             *
             *   WHY IT LOOKED PLAUSIBLE: the sibling getAdminDisputesAction
             *   returns its rows BOTH nested and at the top level, so the same
             *   idiom copied from the disputes screen works there and silently
             *   does nothing here.
             */
            const payload = (result as any).data ?? {};
            return {
                success: result.success,
                data: payload.reviews || [],
                meta: { lastDocId: payload.lastDocId, hasMore: payload.hasMore, stats: payload.stats },
                error: (result as any).error
            };
        },
        limit: 20,
        dependencies: [statusFilter, sortOrder]
    });

    const [processingId, setProcessingId] = useState<string | null>(null);

    const [filteredReviews, setFilteredReviews] = useState<ProductReview[]>([]);

    useEffect(() => {
        filterReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery, reviews]);

    function filterReviews() {
        let filtered = [...reviews];

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

    /*
     *   #822 THE FALLBACK COUNTED THE PAGE AND CALLED IT THE TOTAL.
     *
     *   When `stats` was absent this counted three statuses across `reviews` —
     *   at most one page of twenty — and rendered the result under "Pending
     *   Reviews", "Approved", "Rejected". A page is not a total, and the
     *   difference is invisible to the admin reading it.
     *
     *   AND IT IS ABSENT MORE OFTEN THAN IT LOOKS: the action computes the
     *   counts only on the first page (`if (!options.lastDocId)`), so paging
     *   forward dropped them and the cards silently became page counts.
     *
     *   LATCHED, so the exact figures survive paging, and shown as "—" when
     *   they have genuinely never arrived. An em dash says "not counted"; a
     *   number says "this is how many there are", and only one of those was
     *   ever true here.
     */
    const [latchedStats, setLatchedStats] = useState<{ pending: number; approved: number; rejected: number } | null>(null);
    useEffect(() => {
        if (meta?.stats) setLatchedStats(meta.stats);
    }, [meta?.stats]);

    const stats = latchedStats;

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        Review Moderation
                    </h1>
                    <p className="text-gray-600">
                        Approve or reject customer reviews
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-yellow-800">
                                Pending Reviews
                            </h3>
                            <Clock className="w-5 h-5 text-yellow-600" />
                        </div>
                        <p className="text-3xl font-bold text-yellow-900">
                            {statText(stats?.pending)}
                        </p>
                    </div>

                    <div className="bg-green-50 border border-green-200 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-green-800">
                                Approved
                            </h3>
                            <CheckCircle className="w-5 h-5 text-green-600" />
                        </div>
                        <p className="text-3xl font-bold text-green-900">
                            {statText(stats?.approved)}
                        </p>
                    </div>

                    <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-red-800">
                                Rejected
                            </h3>
                            <XCircle className="w-5 h-5 text-red-600" />
                        </div>
                        <p className="text-3xl font-bold text-red-900">
                            {statText(stats?.rejected)}
                        </p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Search */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Search
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by product, user ID, or comment..."
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        </div>

                        {/* Status Filter */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Status Filter
                            </label>
                            <div className="relative">
                                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value as "all" | "pending" | "approved" | "rejected")}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary appearance-none"
                                >
                                    <option value="all">All Statuses</option>
                                    <option value="pending">Pending</option>
                                    <option value="approved">Approved</option>
                                    <option value="rejected">Rejected</option>
                                </select>
                            </div>
                        </div>

                        {/* Sort */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                Sort Order
                            </label>
                            <select
                                value={sortOrder}
                                onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                                className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary appearance-none"
                            >
                                <option value="desc">Newest First</option>
                                <option value="asc">Oldest First</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Reviews List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    </div>
                ) : fetchError ? (
                    <AdminReadFailed error={fetchError} subject="reviews" onRetry={loadReviews} />
                ) : filteredReviews.length > 0 ? (
                    <div className="space-y-4">
                        {filteredReviews.map((review) => (
                            <div
                                key={review.id}
                                className="bg-white rounded-2xl shadow-lg p-6"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <StarDisplay rating={review.rating} />
                                            <span
                                                className={`px-3 py-1 rounded-full text-sm font-semibold ${review.status === "pending"
                                                    ? "bg-yellow-100 text-yellow-800"
                                                    : review.status === "approved"
                                                        ? "bg-green-100 text-green-800"
                                                        : "bg-red-100 text-red-800"
                                                    }`}
                                            >
                                                {humaniseCapitalised(review.status)}
                                            </span>
                                            {review.verified && (
                                                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
                                                    Verified
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-600 mb-3">
                                            Product: {shortId(review.productId, 40)} • User: {shortId(review.userId, 12)} •{" "}
                                            {formatLocalDate(review.createdAt)}
                                        </p>
                                        <p className="text-gray-900 mb-4">{review.comment}</p>
                                    </div>
                                </div>

                                {review.status === "pending" && (
                                    <div className="flex gap-3 pt-4 border-t border-gray-200">
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
                                    <div className="pt-4 border-t border-gray-200">
                                        <p className="text-sm text-gray-600">
                                            {review.status === "approved" ? "Approved" : "Rejected"}{review.moderatedAt && ` on ${formatLocalDate(review.moderatedAt)}`}
                                        </p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-12 bg-white rounded-2xl">
                        <Eye className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg">
                            {searchQuery || statusFilter !== "all"
                                ? "No reviews match your filters"
                                : "No reviews found"}
                        </p>
                    </div>
                )}
                
                {/* Pagination Controls */}
                {filteredReviews.length > 0 && (
                    <div className="flex items-center justify-between mt-8 p-4 bg-white rounded-2xl shadow-lg border border-gray-100">
                        <span className="text-sm font-medium text-gray-500">Page {pageIndex + 1}</span>
                        <div className="flex gap-2">
                            <button
                                onClick={onPrevPage}
                                disabled={pageIndex === 0 || loading}
                                className="px-4 py-2 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
                            >
                                Previous
                            </button>
                            <button
                                onClick={onNextPage}
                                disabled={!hasMore || loading}
                                className="px-4 py-2 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition flex items-center gap-2"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin text-gray-500" /> : "Next Page"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
