"use client";

import { useState, useEffect } from "react";
import { Star, Check, User } from "lucide-react";
import { getProductReviewsAction } from "@/app/actions/reviews";
import type { ProductReview } from "@/lib/types/marketplace";

interface ProductReviewsSectionProps {
    productId: string;
}

function StarDisplay({ rating }: { rating: number }) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;

    return (
        <div className="flex gap-0.5">
            {[...Array(5)].map((_, i) => (
                <Star
                    key={i}
                    className={`w-4 h-4 ${i < fullStars
                            ? "fill-yellow-400 text-yellow-400"
                            : i === fullStars && hasHalfStar
                                ? "fill-yellow-200 text-yellow-400"
                                : "text-gray-300"
                        }`}
                />
            ))}
        </div>
    );
}

export default function ProductReviewsSection({ productId }: ProductReviewsSectionProps) {
    const [reviews, setReviews] = useState<ProductReview[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterRating, setFilterRating] = useState<number | null>(null);

    useEffect(() => {
        loadReviews();
    }, [productId, filterRating]);

    async function loadReviews() {
        setLoading(true);
        try {
            const result = await getProductReviewsAction(
                productId,
                filterRating ? { rating: filterRating } : undefined
            );
            if (result.success) {
                setReviews(result.reviews || []);
            }
        } catch (error) {
            console.error("Failed to load reviews:", error);
        } finally {
            setLoading(false);
        }
    }

    // Calculate rating summary
    const averageRating =
        reviews.length > 0
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
            : 0;

    const distribution = {
        5: reviews.filter((r) => r.rating === 5).length,
        4: reviews.filter((r) => r.rating === 4).length,
        3: reviews.filter((r) => r.rating === 3).length,
        2: reviews.filter((r) => r.rating === 2).length,
        1: reviews.filter((r) => r.rating === 1).length,
    };

    const maxCount = Math.max(...Object.values(distribution));

    if (loading) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
                <div className="text-center text-gray-500">Loading reviews...</div>
            </div>
        );
    }

    if (reviews.length === 0) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                    Customer Reviews
                </h2>
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No reviews yet. Be the first to review this product!
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
            {/* Header */}
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                Customer Reviews
            </h2>

            {/* Rating Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 pb-8 border-b border-gray-200 dark:border-gray-700">
                {/* Average Rating */}
                <div className="flex flex-col items-center justify-center">
                    <div className="text-5xl font-bold text-gray-900 dark:text-white mb-2">
                        {averageRating.toFixed(1)}
                    </div>
                    <StarDisplay rating={averageRating} />
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                        {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
                    </div>
                </div>

                {/* Rating Distribution */}
                <div className="space-y-2">
                    {[5, 4, 3, 2, 1].map((rating) => (
                        <button
                            key={rating}
                            onClick={() => setFilterRating(filterRating === rating ? null : rating)}
                            className={`w-full flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700 p-2 rounded-lg transition ${filterRating === rating ? "bg-gray-100 dark:bg-gray-700" : ""
                                }`}
                        >
                            <div className="flex items-center gap-1 w-16">
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {rating}
                                </span>
                                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                            </div>
                            <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-yellow-400 transition-all"
                                    style={{
                                        width: maxCount > 0 ? `${(distribution[rating as keyof typeof distribution] / maxCount) * 100}%` : "0%",
                                    }}
                                />
                            </div>
                            <div className="w-12 text-sm text-gray-600 dark:text-gray-400 text-right">
                                {distribution[rating as keyof typeof distribution]}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Filter Active */}
            {filterRating && (
                <div className="mb-4 flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                        Showing {filterRating}-star reviews
                    </span>
                    <button
                        onClick={() => setFilterRating(null)}
                        className="text-sm text-primary hover:underline"
                    >
                        Clear filter
                    </button>
                </div>
            )}

            {/* Reviews List */}
            <div className="space-y-6">
                {reviews.map((review) => (
                    <div
                        key={review.id}
                        className="pb-6 border-b border-gray-200 dark:border-gray-700 last:border-0"
                    >
                        {/* Review Header */}
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                        <User className="w-4 h-4 text-primary" />
                                    </div>
                                    <span className="font-semibold text-gray-900 dark:text-white">
                                        {review.userId.slice(0, 8)}
                                    </span>
                                    {review.verified && (
                                        <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200 text-xs font-semibold rounded-full">
                                            <Check className="w-3 h-3" />
                                            Verified Purchase
                                        </span>
                                    )}
                                </div>
                                <StarDisplay rating={review.rating} />
                            </div>
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                {new Date(review.createdAt).toLocaleDateString()}
                            </span>
                        </div>

                        {/* Review Content */}
                        <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                            {review.comment}
                        </p>

                        {/* Review Images */}
                        {review.images && review.images.length > 0 && (
                            <div className="flex gap-2 mt-3">
                                {review.images.map((url, idx) => (
                                    <div
                                        key={idx}
                                        className="w-20 h-20 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700"
                                    >
                                        <img
                                            src={url}
                                            alt={`Review image ${idx + 1}`}
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
