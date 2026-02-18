"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import Link from "next/link";

function PaymentCallbackContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [status, setStatus] = useState<"loading" | "success" | "failed">("loading");
    const [message, setMessage] = useState("");

    const verifyPayment = async (reference: string) => {
        try {
            const response = await fetch("/api/cooperative/verify-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reference }),
            });

            const data = await response.json();

            if (data.success) {
                setStatus("success");
                setMessage(data.message || "Payment verified successfully!");
                // Use window.location.href for reliable redirect inside Suspense
                setTimeout(() => {
                    window.location.href = "/cooperatives/onboarding";
                }, 2000);
            } else {
                setStatus("failed");
                setMessage(data.message || data.error || "Payment verification failed");
            }
        } catch (error) {
            setStatus("failed");
            setMessage("An error occurred while verifying payment");
        }
    };

    useEffect(() => {
        const reference = searchParams.get("reference");

        if (!reference) {
            setStatus("failed");
            setMessage("No payment reference found");
            return;
        }

        // Verify payment with server
        verifyPayment(reference);
    }, [searchParams]);

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-2xl p-8 shadow-xl text-center">
                {status === "loading" && (
                    <>
                        <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">
                            Verifying Payment
                        </h1>
                        <p className="text-slate-600">
                            Please wait while we confirm your payment...
                        </p>
                    </>
                )}

                {status === "success" && (
                    <>
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-10 h-10 text-green-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">
                            Payment Successful!
                        </h1>
                        <p className="text-slate-600 mb-4">
                            {message}
                        </p>
                        <p className="text-sm text-slate-500 mb-6">
                            Redirecting you to your membership form...
                        </p>
                        {/* Manual fallback button in case redirect is slow */}
                        <button
                            onClick={() => { window.location.href = "/cooperatives/onboarding"; }}
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-xl font-bold transition"
                        >
                            Continue to Membership Form →
                        </button>
                    </>
                )}

                {status === "failed" && (
                    <>
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <XCircle className="w-10 h-10 text-red-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">
                            Payment Failed
                        </h1>
                        <p className="text-slate-600 mb-6">
                            {message}
                        </p>
                        <div className="flex gap-3">
                            <Link
                                href="/cooperatives/payment"
                                className="inline-flex items-center justify-center gap-2 bg-purple-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-purple-700 transition"
                            >
                                Try Again
                            </Link>
                            <Link
                                href="/cooperatives"
                                className="flex-1 px-6 py-3 border border-slate-200 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                            >
                                Go Back
                            </Link>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function PaymentCallbackPageContent() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white rounded-2xl p-8 shadow-xl text-center">
                    <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        Loading Payment Status
                    </h1>
                    <p className="text-slate-600">
                        Please wait...
                    </p>
                </div>
            </div>
        }>
            <PaymentCallbackContent />
        </Suspense>
    );
}

export default function PaymentCallbackPagePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        }>
            <PaymentCallbackPageContent />
        </Suspense>
    );
}
