"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { initiateCooperativePaymentAction } from "@/app/actions/cooperative";
import { Loader2, CreditCard, CheckCircle, ShieldCheck } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

export default function CooperativePaymentPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedTier, setSelectedTier] = useState<"basic" | "premium">("basic");

    const handlePayment = async () => {
        setIsSubmitting(true);
        try {
            const result = await initiateCooperativePaymentAction(selectedTier);

            if (result.success && result.paymentUrl) {
                window.location.href = result.paymentUrl;
            } else {
                showToast(result.error || "Failed to initiate payment", "error");
                setIsSubmitting(false);
            }
        } catch (error) {
            showToast("An unexpected error occurred", "error");
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="max-w-4xl w-full grid md:grid-cols-2 gap-8 items-center">

                {/* Left Column: Value Prop */}
                <div className="space-y-6">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white leading-tight">
                        Join the <span className="text-purple-600">EasySales Cooperative</span>
                    </h1>
                    <p className="text-lg text-slate-600 dark:text-slate-400">
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
                                <span className="text-slate-700 dark:text-slate-300 font-medium">{item}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Column: Payment Card */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="p-8 space-y-8">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Select Membership Tier</h2>
                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => setSelectedTier("basic")}
                                    className={`p-4 rounded-xl border-2 text-left transition-all ${selectedTier === "basic"
                                            ? "border-purple-600 bg-purple-50 dark:bg-purple-900/20"
                                            : "border-slate-200 dark:border-slate-700 hover:border-purple-300"
                                        }`}
                                >
                                    <div className="font-bold text-slate-900 dark:text-white">Basic</div>
                                    <div className="text-sm text-slate-500 mb-2">Non-Voting Rights</div>
                                    <div className="text-lg font-bold text-purple-600">₦10,000</div>
                                </button>

                                <button
                                    onClick={() => setSelectedTier("premium")}
                                    className={`p-4 rounded-xl border-2 text-left transition-all ${selectedTier === "premium"
                                            ? "border-purple-600 bg-purple-50 dark:bg-purple-900/20"
                                            : "border-slate-200 dark:border-slate-700 hover:border-purple-300"
                                        }`}
                                >
                                    <div className="font-bold text-slate-900 dark:text-white">Premium</div>
                                    <div className="text-sm text-slate-500 mb-2">Voting Rights</div>
                                    <div className="text-lg font-bold text-purple-600">₦20,000</div>
                                </button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <button
                                onClick={handlePayment}
                                disabled={isSubmitting}
                                className="w-full flex items-center justify-center gap-2 py-4 px-6 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-purple-200 dark:shadow-none"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <CreditCard className="w-5 h-5" />
                                        Pay ₦{(selectedTier === "basic" ? 10000 : 20000).toLocaleString()} Now
                                    </>
                                )}
                            </button>

                            <div className="flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
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
