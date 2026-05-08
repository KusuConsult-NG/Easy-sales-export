"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle, XCircle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { verifyExportOrderPaymentAction } from "@/app/actions/export-payment";

function PaymentCallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const reference = searchParams.get("reference");

    const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
    const [message, setMessage] = useState("Verifying your payment securely...");
    const [orderId, setOrderId] = useState<string | null>(null);

    useEffect(() => {
        if (!reference) {
            setStatus("error");
            setMessage("No payment reference found. Please contact support if you were charged.");
            return;
        }

        async function verify() {
            try {
                const result = await verifyExportOrderPaymentAction(reference as string) as any;

                if (result.success) {
                    setStatus("success");
                    setOrderId(result.data?.orderId || null);
                    // Clear the local storage cart and details
                    localStorage.removeItem("export_cart"); // Assuming standard cart storage key
                    const userId = localStorage.getItem("user_id_cache"); // Simplistic approach, though usually we rely on context
                } else {
                    setStatus("error");
                    setMessage(result.error || "Failed to verify payment");
                }
            } catch (error) {
                setStatus("error");
                setMessage("An unexpected error occurred during verification.");
            }
        }

        verify();
    }, [reference]);

    if (status === "verifying") {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center">
                <Loader2 className="w-16 h-16 animate-spin text-blue-600 mb-6" />
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Verifying Payment</h2>
                <p className="text-slate-500">Please do not close or refresh this page.</p>
            </div>
        );
    }

    if (status === "error") {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center">
                <XCircle className="w-20 h-20 text-red-500 mb-6" />
                <h2 className="text-3xl font-bold text-slate-900 mb-4">Payment Verification Failed</h2>
                <p className="text-slate-600 mb-8 max-w-md">{message}</p>
                <div className="flex gap-4">
                    <Link
                        href="/export/buyer/cart"
                        className="px-6 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition"
                    >
                        Return to Cart
                    </Link>
                    <Link
                        href="/dashboard"
                        className="px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition"
                    >
                        Go to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6">
                <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
            <h2 className="text-4xl font-bold text-slate-900 mb-4">Order Confirmed!</h2>
            <p className="text-slate-600 mb-2 max-w-lg">
                Your international export order has been successfully placed and payment verified.
            </p>
            {orderId && (
                <div className="bg-slate-100 rounded-xl px-6 py-4 mb-8">
                    <p className="text-sm text-slate-500 mb-1">Order ID</p>
                    <p className="text-xl font-mono font-bold text-slate-900">{orderId}</p>
                </div>
            )}
            <div className="space-y-4">
                <p className="text-sm text-slate-500">
                    Our export operations team has been notified and will contact you shortly with the shipping documentation and logistics details.
                </p>
                <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-500/30"
                >
                    View My Dashboard
                    <ArrowRight className="w-5 h-5" />
                </Link>
            </div>
        </div>
    );
}

export default function ExportPaymentCallbackPage() {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
                <Suspense fallback={
                    <div className="flex flex-col items-center justify-center p-12">
                        <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-4" />
                        <p className="text-slate-500">Loading secure environment...</p>
                    </div>
                }>
                    <PaymentCallbackContent />
                </Suspense>
            </div>
        </div>
    );
}
