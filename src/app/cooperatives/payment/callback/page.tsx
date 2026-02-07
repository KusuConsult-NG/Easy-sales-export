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
                setMessage("Payment successful! Your membership application is now pending approval.");

                // Redirect to cooperatives page after 3 seconds
                setTimeout(() => router.push("/cooperatives"), 3000);
            } else {
                setStatus("failed");
                setMessage(data.message || "Payment verification failed");
            }
        } catch (error) {
            setStatus("failed");
            setMessage("Failed to verify payment. Please contact support.");
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-xl text-center">
                {status === "loading" && (
                    <>
                        <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            Verifying Payment
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400">
                            Please wait while we confirm your payment...
                        </p>
                    </>
                )}

                {status === "success" && (
                    <>
                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            Payment Successful!
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            {message}
                        </p>
                        <Link
                            href="/cooperatives"
                            className="inline-block px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                        >
                            Go to Cooperatives
                        </Link>
                    </>
                )}

                {status === "failed" && (
                    <>
                        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <XCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            Payment Failed
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            {message}
                        </p>
                        <div className="flex gap-3">
                            <Link
                                href="/cooperatives/register"
                                className="flex-1 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                            >
                                Try Again
                            </Link>
                            <Link
                                href="/cooperatives"
                                className="flex-1 px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
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
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-xl text-center">
                    <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Loading Payment Status
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
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
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        }>
            <PaymentCallbackPageContent />
        </Suspense>
    );
}
