"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { initiateCooperativePaymentAction, getMembershipAction } from "@/app/actions/cooperative";
import { Loader2, CreditCard, CheckCircle, ShieldCheck, AlertCircle } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { COOPERATIVE_CONFIG, CURRENCY_CONFIG } from "@/lib/constants";

export default function CooperativePaymentPage() {
    const { data: session, status: sessionStatus } = useSession();
    const { showToast } = useToast();
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [checking, setChecking] = useState(true);

    const isDedicatedCoop = typeof window !== "undefined" && (
        window.location.hostname.replace(/^www\./, "").toLowerCase() === "easysalescooperative.com" ||
        window.location.hostname.replace(/^www\./, "").toLowerCase().endsWith(".easysalescooperative.com")
    );
    const prefix = isDedicatedCoop ? "" : "/cooperatives";

    // Check if user already paid or has membership
    useEffect(() => {
        if (sessionStatus === "loading") return;
        if (sessionStatus === "unauthenticated") {
            router.replace(`/auth/login?callbackUrl=${prefix || "/"}/payment`);
            return;
        }

        const checkExisting = async () => {
            try {
                const response = await getMembershipAction();
                if (response.success && response.data && response.data.membership) {
                    const status = response.data.membership.membershipStatus;
                    const paymentStatus = response.data.membership.paymentStatus;
                    
                    if (status === "approved" || status === "active") {
                        showToast("You are already a cooperative member!", "info");
                        router.replace(`${prefix}/dashboard`);
                        return;
                    }

                    // ✔️ Check paymentStatus BEFORE membershipStatus=pending.
                    // After Paystack payment, the user has paymentStatus="completed" and
                    // membershipStatus="pending" (needs to fill onboarding form).
                    // Without this order, the pending check fires first and sends them
                    // to the admin-review waiting page — not the onboarding form.
                    if (paymentStatus === "completed") {
                        showToast("Payment already completed. Please proceed to onboarding.", "info");
                        router.replace(`${prefix}/onboarding`);
                        return;
                    }
                    
                    if (status === "pending") {
                        showToast("Your application is being reviewed.", "info");
                        router.replace(`${prefix}/onboarding/pending`);
                        return;
                    }
                }
            } catch {
                // No existing membership, allow payment
            }
            setChecking(false);
        };
        checkExisting();
    }, [sessionStatus, router, showToast, prefix]);

    async function handlePayment() {
        setIsSubmitting(true);
        try {
            const result = await initiateCooperativePaymentAction("Member");

            if (result.success && result.data?.redirectTo) {
                // Already paid — redirect to onboarding form
                showToast("Payment already completed. Redirecting to onboarding...", "info");
                let targetUrl = result.data.redirectTo;
                if (isDedicatedCoop && targetUrl.startsWith("/cooperatives")) {
                    targetUrl = targetUrl.substring("/cooperatives".length);
                    if (!targetUrl.startsWith("/")) targetUrl = "/" + targetUrl;
                }
                router.replace(targetUrl);
                return;
            }
            if (result.success && result.data?.paymentUrl) {
                window.location.href = result.data.paymentUrl;
            } else {
                showToast(result.error || "Failed to initiate payment", "error");
                setIsSubmitting(false);
            }
        } catch {
            showToast("An unexpected error occurred", "error");
            setIsSubmitting(false);
        }
    };

    if (checking || sessionStatus === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
            <div className="max-w-4xl w-full grid md:grid-cols-2 gap-8 items-center">

                {/* Left Column: Value Prop */}
                <div className="space-y-6">
                    <h1 className="text-4xl font-bold text-slate-900 leading-tight">
                        Join the <span className="text-purple-600">EasySales Cooperative</span>
                    </h1>
                    <p className="text-lg text-slate-600">
                        Unlock exclusive financial tools, low-interest loans, and high-yield savings designed for exporters.
                    </p>

                    <div className="space-y-4 pt-4">
                        {[
                            "Access to low-interest business loans",
                            "High-yield fixed savings plans",
                            "Network with top agricultural exporters",
                            "Exclusive export market insights"
                        ].map((item, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                                <span className="text-slate-700 font-medium">{item}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Column: Payment Card */}
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                    <div className="p-8 space-y-8">

                        {/* One-time fee display */}
                        <div className="text-center">
                            <p className="text-sm font-semibold text-purple-600 uppercase tracking-widest mb-2">One-Time Membership Fee</p>
                            <div className="text-6xl font-extrabold text-slate-900 mb-1">{CURRENCY_CONFIG.symbol}{COOPERATIVE_CONFIG.registrationFee.toLocaleString()}</div>
                            <p className="text-slate-500 text-sm">Pay once. Access forever.</p>
                        </div>

                        <div className="space-y-4">
                            <button
                                onClick={handlePayment}
                                disabled={isSubmitting}
                                className="w-full flex items-center justify-center gap-2 py-4 px-6 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-purple-200"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <CreditCard className="w-5 h-5" />
                                        Pay {CURRENCY_CONFIG.symbol}{COOPERATIVE_CONFIG.registrationFee.toLocaleString()} Now
                                    </>
                                )}
                            </button>

                            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                                <ShieldCheck className="w-4 h-4" />
                                <span>Secured by Paystack</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
