"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle, Package, ArrowRight } from "lucide-react";
import Link from "next/link";

function SuccessContent() {
    const searchParams = useSearchParams();
    const reference = searchParams.get("reference");

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
            <div className="max-w-md w-full">
                <div className="bg-white rounded-2xl p-8 text-center">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-12 h-12 text-green-600" />
                    </div>

                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        Payment Successful!
                    </h1>
                    <p className="text-slate-600 mb-6">
                        Your order has been placed and payment confirmed
                    </p>

                    {reference && (
                        <div className="bg-slate-50 rounded-xl p-4 mb-6">
                            <p className="text-xs text-slate-500 mb-1">
                                Transaction Reference
                            </p>
                            <p className="font-mono text-sm font-semibold text-slate-900">
                                {reference}
                            </p>
                        </div>
                    )}

                    <div className="space-y-3">
                        <Link
                            href="/dashboard"
                            className="block w-full px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition"
                        >
                            View My Orders
                        </Link>
                        <Link
                            href="/marketplace"
                            className="block w-full px-6 py-3 border border-slate-200 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition flex items-center justify-center gap-2"
                        >
                            <Package className="w-5 h-5" />
                            Continue Shopping
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

function MarketplaceSuccessPageContent() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                    <div className="text-slate-600">Loading...</div>
                </div>
            }
        >
            <SuccessContent />
        </Suspense>
    );
}

export default function MarketplaceSuccessPagePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        }>
            <MarketplaceSuccessPageContent />
        </Suspense>
    );
}
