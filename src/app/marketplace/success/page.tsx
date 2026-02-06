"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle, Package, ArrowRight } from "lucide-react";
import Link from "next/link";

function SuccessContent() {
    const searchParams = useSearchParams();
    const reference = searchParams.get("reference");

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4">
            <div className="max-w-md w-full">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 text-center">
                    <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
                    </div>

                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Payment Successful!
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400 mb-6">
                        Your order has been placed and payment confirmed
                    </p>

                    {reference && (
                        <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 mb-6">
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                Transaction Reference
                            </p>
                            <p className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
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
                            className="block w-full px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition flex items-center justify-center gap-2"
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

export default function MarketplaceSuccessPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                    <div className="text-slate-600 dark:text-slate-400">Loading...</div>
                </div>
            }
        >
            <SuccessContent />
        </Suspense>
    );
}
