/**
 * Payment Step
 * 
 * Complete membership payment
 */

"use client";

import { CheckCircle, CreditCard, Loader2 } from "lucide-react";

interface PaymentStepProps {
    tierData: {
        tier: "basic" | "premium";
    };
    onComplete: () => void;
    onBack: () => void;
    isSubmitting?: boolean;
}

export default function PaymentStep({ tierData, onComplete, onBack, isSubmitting = false }: PaymentStepProps) {
    const tierPrices = {
        basic: 10000,  // One-time payment
        premium: 20000 // One-time payment
    };

    const amount = tierPrices[tierData.tier];

    const tierNames = {
        basic: "Basic",
        premium: "Premium"
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                    Complete Payment
                </h2>
                <p className="text-lg text-slate-600 dark:text-slate-400">
                    Pay your membership fee to activate your account
                </p>
            </div>

            {/* Payment Summary */}
            <div className="max-w-2xl mx-auto">
                <div className="bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-200 dark:border-purple-800 rounded-2xl p-6">
                    <h3 className="font-bold text-lg text-purple-900 dark:text-purple-200 mb-4">
                        Payment Summary
                    </h3>
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-purple-800 dark:text-purple-300">Membership Tier:</span>
                            <span className="font-semibold text-purple-900 dark:text-purple-100">
                                {tierNames[tierData.tier]}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-purple-800 dark:text-purple-300">Payment Type:</span>
                            <span className="font-semibold text-purple-900 dark:text-purple-100">
                                One-Time Registration Fee
                            </span>
                        </div>
                        <div className="pt-3 border-t-2 border-purple-300 dark:border-purple-700">
                            <div className="flex justify-between items-baseline">
                                <span className="text-lg font-bold text-purple-900 dark:text-purple-100">
                                    Total Amount:
                                </span>
                                <span className="text-3xl font-bold text-purple-600">
                                    ₦{amount.toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Payment Methods */}
            <div className="max-w-2xl mx-auto space-y-4">
                <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-4">
                    Select Payment Method
                </h3>

                {/* Paystack */}
                <button
                    onClick={onComplete}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-between p-6 border-2 border-slate-200 dark:border-slate-700 rounded-xl hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all group disabled:opacity-70 disabled:cursor-not-allowed"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center group-hover:bg-purple-600 transition-colors">
                            {isSubmitting ? (
                                <Loader2 className="w-6 h-6 text-purple-600 animate-spin" />
                            ) : (
                                <CreditCard className="w-6 h-6 text-purple-600 group-hover:text-white" />
                            )}
                        </div>
                        <div className="text-left">
                            <p className="font-semibold text-slate-900 dark:text-white">
                                {isSubmitting ? "Initializing Payment..." : "Pay with Paystack"}
                            </p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                {isSubmitting ? "Please wait while we redirect you" : "Debit/Credit Card, Bank Transfer, USSD"}
                            </p>
                        </div>
                    </div>
                </button>
            </div>

            {/* Security Note */}
            <div className="max-w-2xl mx-auto bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-green-900 dark:text-green-200 mb-1">
                            Secure Payment
                        </p>
                        <p className="text-sm text-green-800 dark:text-green-300">
                            All payments are encrypted and secure. Your financial information is never stored on our servers.
                        </p>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                >
                    Back
                </button>
            </div>
        </div>
    );
}
