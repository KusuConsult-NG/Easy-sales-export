"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { verifyInvestmentPaymentAction } from "@/app/actions/export-payment";
import { CheckCircle, XCircle, Loader2, Home, TrendingUp } from "lucide-react";
import Link from "next/link";

function PaymentCallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
    const [message, setMessage] = useState("");
    const [investmentDetails, setInvestmentDetails] = useState<any>(null);

    useEffect(() => {
        const verifyPayment = async () => {
            const reference = searchParams.get("reference");

            if (!reference) {
                setStatus("error");
                setMessage("No payment reference found");
                return;
            }

            try {
                const result = await verifyInvestmentPaymentAction(reference);

                if (result.success) {
                    setStatus("success");
                    setMessage(result.message || "Investment successful!");
                    setInvestmentDetails(result.investmentId || null);
                } else {
                    setStatus("error");
                    setMessage(result.error || "Payment verification failed");
                }
            } catch (error) {
                setStatus("error");
                setMessage("An error occurred while verifying your investment");
            }
        };

        verifyPayment();
    }, [searchParams]);

    return (
        <div className="min-h-screen bg-linear-to-br from-blue-50 via-indigo-50 to-violet-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-8">
                    {/* Status Icon */}
                    <div className="flex justify-center mb-6">
                        {status === "verifying" && (
                            <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                                <Loader2 className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin" />
                            </div>
                        )}
                        {status === "success" && (
                            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                                <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
                            </div>
                        )}
                        {status === "error" && (
                            <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                                <XCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
                            </div>
                        )}
                    </div>

                    {/* Title */}
                    <h1 className="text-2xl font-bold text-center mb-3 text-slate-900 dark:text-white">
                        {status === "verifying" && "Processing Investment..."}
                        {status === "success" && "Investment Confirmed!"}
                        {status === "error" && "Investment Failed"}
                    </h1>

                    {/* Message */}
                    <p className="text-center text-slate-600 dark:text-slate-400 mb-8">
                        {message}
                    </p>

                    {/* Action Buttons */}
                    <div className="space-y-3">
                        {status === "success" && (
                            <>
                                <Link
                                    href="/export/(app)/portfolio"
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                                >
                                    <TrendingUp className="w-5 h-5" />
                                    View Portfolio
                                </Link>
                                <Link
                                    href="/export/(app)/dashboard"
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors"
                                >
                                    Go to Dashboard
                                </Link>
                            </>
                        )}

                        {status === "error" && (
                            <Link
                                href="/export/windows"
                                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                            >
                                Browse Export Windows
                            </Link>
                        )}

                        <Link
                            href="/"
                            className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-900 dark:text-white rounded-lg font-semibold transition-colors"
                        >
                            <Home className="w-5 h-5" />
                            Go Home
                        </Link>
                    </div>

                    {/* Support Note */}
                    {status === "error" && (
                        <p className="text-sm text-center text-slate-500 dark:text-slate-400 mt-6">
                            If you were charged but see this error, please contact support with your payment reference.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function ExportPaymentCallback() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        }>
            <PaymentCallbackContent />
        </Suspense>
    );
}
