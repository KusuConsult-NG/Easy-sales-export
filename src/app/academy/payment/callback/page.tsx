"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle, XCircle, PartyPopper, ArrowRight } from "lucide-react";
import { verifyAcademyPaymentAction } from "@/app/actions/academy-payment";
import { Suspense } from "react";

function PaymentCallbackContent() {
    const searchParams = useSearchParams();
    const reference = searchParams.get("reference") || searchParams.get("trxref");
    const [status, setStatus] = useState<"loading" | "success" | "failed">("loading");

    useEffect(() => {
        const verify = async () => {
            if (!reference) {
                setStatus("failed");
                return;
            }

            try {
                const result = await verifyAcademyPaymentAction(reference);
                setStatus(result.success ? "success" : "failed");
            } catch {
                setStatus("failed");
            }
        };

        verify();
    }, [reference]);

    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
                    <p className="text-slate-600 font-medium">Verifying your payment...</p>
                </div>
            </div>
        );
    }

    if (status === "failed") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
                <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <XCircle className="w-8 h-8 text-red-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Payment Verification Failed</h1>
                    <p className="text-slate-600 mb-6">
                        We couldn&apos;t verify your payment. Please try again or contact support.
                    </p>
                    <Link
                        href="/academy/application"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition"
                    >
                        Try Again
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
            <div className="bg-white rounded-3xl shadow-2xl overflow-hidden max-w-lg w-full">
                <div className="bg-linear-to-r from-blue-600 to-indigo-600 px-8 py-10 text-center text-white">
                    <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <PartyPopper className="w-10 h-10 text-white" />
                    </div>
                    <h1 className="text-3xl font-extrabold mb-2">Congratulations! 🎉</h1>
                    <p className="text-blue-100 text-lg">Your payment was successful</p>
                </div>

                <div className="p-8">
                    <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
                        <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                        <p className="text-sm text-green-800 font-medium">Payment confirmed</p>
                    </div>

                    <h3 className="font-bold text-slate-900 mb-3">What happens next?</h3>
                    <ol className="space-y-3 mb-8">
                        <li className="flex items-start gap-3">
                            <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
                            <p className="text-sm text-slate-600">Complete the membership application form</p>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
                            <p className="text-sm text-slate-600">Our team reviews your application (24–48 hours)</p>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
                            <p className="text-sm text-slate-600">Get access to all Academy courses and resources</p>
                        </li>
                    </ol>

                    <Link
                        href="/academy/application"
                        className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-xl font-bold text-base transition-all shadow-lg shadow-blue-200"
                    >
                        Continue to Application Form
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default function AcademyPaymentCallbackPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
            </div>
        }>
            <PaymentCallbackContent />
        </Suspense>
    );
}
