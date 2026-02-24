"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { verifyOrderPaymentAction } from "@/app/actions/marketplace-payment";
import { CheckCircle, XCircle, Loader2, Home, ShoppingBag } from "lucide-react";
import Link from "next/link";

function PaymentCallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
    const [message, setMessage] = useState("");
    const [orderId, setOrderId] = useState<string | null>(null);

    useEffect(() => {
        const verifyPayment = async () => {
            const reference = searchParams.get("reference");

            if (!reference) {
                setStatus("error");
                setMessage("No payment reference found");
                return;
            }

            try {
                const result = await verifyOrderPaymentAction(reference);

                if (result.success) {
                    setStatus("success");
                    setMessage(result.message || "Order payment successful!");
                    setOrderId(result.orderId || null);

                    // Clear both user-scoped and legacy cart keys
                    if (typeof window !== "undefined") {
                        const userId = session?.user?.id;
                        if (userId) localStorage.removeItem(`marketplace_cart_${userId}`);
                        localStorage.removeItem("marketplace_cart"); // legacy fallback
                    }
                } else {
                    setStatus("error");
                    setMessage(result.error || "Payment verification failed");
                }
            } catch (error) {
                setStatus("error");
                setMessage("An error occurred while verifying your payment");
            }
        };

        verifyPayment();
    }, [searchParams]);

    return (
        <div className="min-h-screen bg-linear-to-br from-purple-50 via-pink-50 to-rose-50 flex items-center justify-center p-4">
            <div className="max-w-md w-full">
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    {/* Status Icon */}
                    <div className="flex justify-center mb-6">
                        {status === "verifying" && (
                            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center">
                                <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                            </div>
                        )}
                        {status === "success" && (
                            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                                <CheckCircle className="w-10 h-10 text-green-600" />
                            </div>
                        )}
                        {status === "error" && (
                            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
                                <XCircle className="w-10 h-10 text-red-600" />
                            </div>
                        )}
                    </div>

                    {/* Title */}
                    <h1 className="text-2xl font-bold text-center mb-3 text-slate-900">
                        {status === "verifying" && "Verifying Payment..."}
                        {status === "success" && "Order Placed!"}
                        {status === "error" && "Payment Failed"}
                    </h1>

                    {/* Message */}
                    <p className="text-center text-slate-600 mb-8">
                        {message}
                    </p>

                    {/* Order ID */}
                    {status === "success" && orderId && (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
                            <p className="text-sm text-green-800 text-center">
                                <strong>Order ID:</strong> {orderId}
                            </p>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="space-y-3">
                        {status === "success" && (
                            <>
                                <Link
                                    href="/marketplace/buyer/orders"
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold transition-colors"
                                >
                                    <ShoppingBag className="w-5 h-5" />
                                    View My Orders
                                </Link>
                                <Link
                                    href="/marketplace"
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold transition-colors"
                                >
                                    Continue Shopping
                                </Link>
                            </>
                        )}

                        {status === "error" && (
                            <Link
                                href="/marketplace"
                                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold transition-colors"
                            >
                                Return to Marketplace
                            </Link>
                        )}

                        <Link
                            href="/"
                            className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-slate-300 hover:bg-slate-50 text-slate-900 rounded-lg font-semibold transition-colors"
                        >
                            <Home className="w-5 h-5" />
                            Go Home
                        </Link>
                    </div>

                    {/* Support Note */}
                    {status === "error" && (
                        <p className="text-sm text-center text-slate-500 mt-6">
                            If you were charged but see this error, please contact support with your payment reference.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function MarketplacePaymentCallback() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-linear-to-br from-orange-50 via-amber-50 to-yellow-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-orange-600" />
            </div>
        }>
            <PaymentCallbackContent />
        </Suspense>
    );
}
