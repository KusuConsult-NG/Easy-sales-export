/**
 * Order Review Page — /marketplace/buyer/orders/[id]/review
 * 
 * Allows buyers to submit a product + seller review after delivery
 */

"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Star, CheckCircle, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { submitProductReviewAction, submitSellerReviewAction } from "@/app/actions/marketplace";
import { useToast } from "@/contexts/ToastContext";

function StarRating({ rating, onChange }: { rating: number; onChange: (r: number) => void }) {
    const [hover, setHover] = useState(0);
    return (
        <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
                <button
                    key={star}
                    type="button"
                    onClick={() => onChange(star)}
                    onMouseEnter={() => setHover(star)}
                    onMouseLeave={() => setHover(0)}
                    className="focus:outline-none transition-transform hover:scale-110"
                >
                    <Star
                        className={`w-8 h-8 transition-colors ${(hover || rating) >= star
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-slate-300"
                            }`}
                    />
                </button>
            ))}
        </div>
    );
}

const RATING_LABELS = ["", "Poor", "Fair", "Good", "Very Good", "Excellent"];

export default function OrderReviewPage() {
    const params = useParams();
    const router = useRouter();
    const { showToast } = useToast();
    const orderId = params.id as string;

    /* Product review state */
    const [productRating, setProductRating] = useState(0);
    const [productComment, setProductComment] = useState("");

    /* Seller review state */
    const [sellerRating, setSellerRating] = useState(0);
    const [sellerComment, setSellerComment] = useState("");

    const [step, setStep] = useState<"product" | "seller" | "done">("product");
    const [loading, setLoading] = useState(false);
    const [productId, setProductId] = useState(""); // would be passed via searchParams in real app
    const [sellerId, setSellerId] = useState(""); // would be passed via searchParams in real app

    // In practice these would come from searchParams or order data
    // For now we accept them via query params (URL: ?productId=xxx&sellerId=xxx)
    useState(() => {
        if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            setProductId(url.searchParams.get("productId") || "");
            setSellerId(url.searchParams.get("sellerId") || "");
        }
    });

    async function handleProductReview() {
        if (!productRating) return showToast("Please select a rating", "error");
        setLoading(true);
        const res = await submitProductReviewAction({
            productId,
            orderId,
            rating: productRating,
            comment: productComment.trim() || undefined,
        });
        setLoading(false);
        if (res.success) {
            showToast("Product review submitted!", "success");
            setStep("seller");
        } else {
            showToast(res.error || "Failed to submit review", "error");
        }
    };

    async function handleSellerReview() {
        if (!sellerRating) return showToast("Please rate the seller", "error");
        setLoading(true);
        const res = await submitSellerReviewAction({
            sellerId,
            orderId,
            rating: sellerRating,
            comment: sellerComment.trim() || undefined,
        });
        setLoading(false);
        if (res.success) {
            setStep("done");
        } else {
            showToast(res.error || "Failed to submit seller review", "error");
        }
    };

    if (step === "done") {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
                <div className="bg-white rounded-2xl shadow-lg p-10 text-center max-w-md w-full">
                    <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-10 h-10 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Reviews Submitted!</h2>
                    <p className="text-slate-500 mb-8">Thank you. Your reviews help other buyers make informed decisions. They'll be visible after moderation.</p>
                    <Link
                        href="/marketplace/buyer/orders"
                        className="block w-full py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition text-center"
                    >
                        Back to My Orders
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-2xl mx-auto px-6 py-5">
                    <Link href={`/marketplace/buyer/orders`} className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-sm mb-3 transition">
                        <ArrowLeft className="w-4 h-4" /> Back to Orders
                    </Link>
                    <h1 className="text-2xl font-bold text-slate-900">Rate Your Experience</h1>
                    <p className="text-slate-500 text-sm mt-1">Order #{orderId}</p>
                </div>
            </div>

            <div className="max-w-2xl mx-auto px-6 py-8">
                {/* Progress */}
                <div className="flex items-center gap-3 mb-8">
                    {["Product", "Seller"].map((label, i) => (
                        <div key={label} className="flex items-center gap-3 flex-1">
                            <div className={`flex items-center gap-2 ${(i === 0 && step === "product") || (i === 1 && step === "seller") ? "text-green-700" : i === 0 && step === "seller" ? "text-green-400" : "text-slate-400"}`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition ${(i === 0 && step === "product") || (i === 1 && step === "seller") ? "bg-green-600 text-white" : i === 0 && step === "seller" ? "bg-green-200 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                                    {i === 0 && step === "seller" ? <CheckCircle className="w-4 h-4" /> : i + 1}
                                </div>
                                <span className="font-semibold text-sm">{label} Review</span>
                            </div>
                            {i === 0 && <div className="flex-1 h-px bg-slate-200" />}
                        </div>
                    ))}
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
                    {step === "product" ? (
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 mb-1">Product Review</h2>
                            <p className="text-slate-500 text-sm mb-6">How was the product quality?</p>

                            <div className="mb-6">
                                <StarRating rating={productRating} onChange={setProductRating} />
                                {productRating > 0 && (
                                    <p className="mt-2 text-sm font-semibold text-yellow-600">{RATING_LABELS[productRating]}</p>
                                )}
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Comment <span className="text-slate-400 font-normal">(optional)</span>
                                </label>
                                <textarea
                                    value={productComment}
                                    onChange={(e) => setProductComment(e.target.value)}
                                    placeholder="Share details about the product quality, packaging, accuracy..."
                                    rows={4}
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                                />
                            </div>

                            <button
                                onClick={handleProductReview}
                                disabled={loading || !productRating}
                                className="w-full py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Star className="w-5 h-5" />}
                                Submit Product Review
                            </button>
                        </div>
                    ) : (
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 mb-1">Seller Review</h2>
                            <p className="text-slate-500 text-sm mb-6">How was your overall experience with this seller?</p>

                            <div className="mb-6">
                                <StarRating rating={sellerRating} onChange={setSellerRating} />
                                {sellerRating > 0 && (
                                    <p className="mt-2 text-sm font-semibold text-yellow-600">{RATING_LABELS[sellerRating]}</p>
                                )}
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Comment <span className="text-slate-400 font-normal">(optional)</span>
                                </label>
                                <textarea
                                    value={sellerComment}
                                    onChange={(e) => setSellerComment(e.target.value)}
                                    placeholder="Share about seller responsiveness, shipping speed, communication..."
                                    rows={4}
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                                />
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setStep("done")}
                                    className="flex-1 py-3 border border-slate-300 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 transition"
                                >
                                    Skip
                                </button>
                                <button
                                    onClick={handleSellerReview}
                                    disabled={loading || !sellerRating}
                                    className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                                    Submit & Finish
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
