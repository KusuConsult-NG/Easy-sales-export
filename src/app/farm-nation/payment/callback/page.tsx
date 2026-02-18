"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { verifyPropertyPaymentAction } from "@/app/actions/farm-nation-payment";
import { CheckCircle, XCircle, Loader2, Home, MapPin } from "lucide-react";
import Link from "next/link";

function PaymentCallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
    const [message, setMessage] = useState("");
    const [propertyId, setPropertyId] = useState<string | null>(null);

    useEffect(() => {
        const verifyPayment = async () => {
            const reference = searchParams.get("reference");

            if (!reference) {
                setStatus("error");
                setMessage("No payment reference found");
                return;
            }

            try {
                const result = await verifyPropertyPaymentAction(reference);

                if (result.success) {
                    setStatus("success");
                    setMessage(result.message || "Property purchase successful!");
                    setPropertyId(result.propertyId || null);
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
        <div className="min-h-screen bg-linear-to-br from-green-50 via-emerald-50 to-teal-50 flex items-center justify-center p-4">
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
                        {status === "success" && "Payment Successful!"}
                        {status === "error" && "Payment Failed"}
                    </h1>

                    {/* Message */}
                    <p className="text-center text-slate-600 mb-8">
                        {message}
                    </p>

                    {/* Action Buttons */}
                    <div className="space-y-3">
                        {status === "success" && (
                            <>
                                {propertyId && (
                                    <Link
                                        href={`/farm-nation/property/${propertyId}`}
                                        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
                                    >
                                        <MapPin className="w-5 h-5" />
                                        View Property
                                    </Link>
                                )}
                                <Link
                                    href="/farm-nation/my-purchases"
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors"
                                >
                                    View My Purchases
                                </Link>
                            </>
                        )}

                        {status === "error" && (
                            <Link
                                href="/farm-nation/properties"
                                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors"
                            >
                                Browse Properties
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

export default function FarmNationPaymentCallback() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
        }>
            <PaymentCallbackContent />
        </Suspense>
    );
}
