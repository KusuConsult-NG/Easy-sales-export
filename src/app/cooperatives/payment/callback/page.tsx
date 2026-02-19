"use client";

import { useEffect, useState, Suspense, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, XCircle, Loader2, PartyPopper, FileText, Clock, ArrowRight } from "lucide-react";
import Link from "next/link";

function PaymentCallbackContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [status, setStatus] = useState<"loading" | "success" | "failed">("loading");
    const [message, setMessage] = useState("");
    const [countdown, setCountdown] = useState(5);

    const verifyPayment = useCallback(async (reference: string) => {
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
            } else {
                setStatus("failed");
                setMessage(data.message || data.error || "Payment verification failed");
            }
        } catch {
            setStatus("failed");
            setMessage("An error occurred while verifying payment");
        }
    }, []);

    useEffect(() => {
        const reference = searchParams.get("reference");
        if (!reference) {
            setStatus("failed");
            setMessage("No payment reference found");
            return;
        }
        verifyPayment(reference);
    }, [searchParams, verifyPayment]);

    // Auto-redirect after success
    useEffect(() => {
        if (status !== "success") return;
        const timer = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    router.push("/cooperatives/onboarding");
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [status, router]);

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 50%, #ddd6fe 100%)" }}>
            <div className="max-w-lg w-full">

                {/* Loading */}
                {status === "loading" && (
                    <div className="bg-white rounded-3xl p-10 shadow-2xl text-center">
                        <Loader2 className="w-16 h-16 text-purple-600 mx-auto mb-5 animate-spin" />
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">Verifying Payment</h1>
                        <p className="text-slate-500">Please wait while we confirm your payment...</p>
                    </div>
                )}

                {/* Success */}
                {status === "success" && (
                    <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
                        {/* Top banner */}
                        <div className="bg-gradient-to-r from-purple-600 to-violet-600 px-8 py-10 text-center text-white">
                            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <PartyPopper className="w-10 h-10 text-white" />
                            </div>
                            <h1 className="text-3xl font-extrabold mb-2">Congratulations! 🎉</h1>
                            <p className="text-purple-100 text-lg">Your payment was successful</p>
                        </div>

                        {/* Body */}
                        <div className="px-8 py-8">
                            {/* Payment confirmed badge */}
                            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-6">
                                <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                                <p className="text-sm text-green-800 font-medium">{message}</p>
                            </div>

                            {/* What happens next */}
                            <h2 className="text-base font-bold text-slate-900 mb-4">What happens next?</h2>
                            <div className="space-y-3 mb-8">
                                <div className="flex items-start gap-3">
                                    <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mt-0.5">
                                        <FileText className="w-4 h-4 text-purple-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-slate-800">Complete your membership form</p>
                                        <p className="text-xs text-slate-500">Fill in your personal details, next of kin, and upload required documents.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                                        <Clock className="w-4 h-4 text-amber-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-slate-800">Application review (24–48 hrs)</p>
                                        <p className="text-xs text-slate-500">Our team will review your documents and verify your identity.</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-slate-800">Get approved & access your dashboard</p>
                                        <p className="text-xs text-slate-500">You'll receive an email notification once approved.</p>
                                    </div>
                                </div>
                            </div>

                            <Link
                                href="/cooperatives/onboarding"
                                className="w-full inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-4 rounded-xl font-bold text-base transition-all shadow-lg shadow-purple-200"
                            >
                                Continue to Membership Form
                                <ArrowRight className="w-5 h-5" />
                            </Link>
                            <p className="text-center text-sm text-slate-500 mt-3">
                                Redirecting automatically in {countdown} second{countdown !== 1 ? "s" : ""}...
                            </p>
                        </div>
                    </div>
                )}

                {/* Failed */}
                {status === "failed" && (
                    <div className="bg-white rounded-3xl p-10 shadow-2xl text-center">
                        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
                            <XCircle className="w-10 h-10 text-red-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900 mb-2">Payment Failed</h1>
                        <p className="text-slate-500 mb-8">{message}</p>
                        <div className="flex gap-3">
                            <Link
                                href="/cooperatives/payment"
                                className="flex-1 inline-flex items-center justify-center bg-purple-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-purple-700 transition"
                            >
                                Try Again
                            </Link>
                            <Link
                                href="/cooperatives"
                                className="flex-1 px-6 py-3 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition"
                            >
                                Go Back
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function PaymentCallbackPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-purple-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-purple-600 animate-spin" />
            </div>
        }>
            <PaymentCallbackContent />
        </Suspense>
    );
}
