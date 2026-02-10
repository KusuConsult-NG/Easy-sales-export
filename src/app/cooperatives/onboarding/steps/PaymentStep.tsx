/**
 * Payment Step
 * 
 * Complete membership payment
 */

"use client";

import { CheckCircle, CreditCard, Building2, Smartphone } from "lucide-react";

interface PaymentStepProps {
    tierData: {
        tier: "basic" | "premium";
    };
    onComplete: () => void;
    onBack: () => void;
}

export default function PaymentStep({ tierData, onComplete, onBack }: PaymentStepProps) {
    const tierPrices = {
        basic: 10000,  // One-time payment
        premium: 20000 // One-time payment
    };

    const amount = tierPrices[tierData.tier];

    const tierNames = {
        basic: "Basic",
        premium: "Premium"
    };

    const handlePaystackPayment = () => {
        // In production, integrate with Paystack
        alert("Paystack integration coming soon!");
        // For now, simulate success
        setTimeout(() => {
            onComplete();
        }, 1000);
    };

    const handleBankTransfer = () => {
        // Show bank details modal or navigate to pending payment page
        alert("Bank transfer details will be shown");
        onComplete();
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
                    Choose Payment Method
                </h3>

                {/* Paystack */}
                <button
                    onClick={handlePaystackPayment}
                    className="w-full flex items-center justify-between p-6 border-2 border-slate-200 dark:border-slate-700 rounded-xl hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all group"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center group-hover:bg-purple-600 transition-colors">
                            <CreditCard className="w-6 h-6 text-purple-600 group-hover:text-white" />
                        </div>
                        <div className="text-left">
                            <p className="font-semibold text-slate-900 dark:text-white">
                                Card Payment (Paystack)
                            </p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Pay with debit/credit card or bank account
                            </p>
                        </div>
                    </div>
                    <span className="px-4 py-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm font-semibold rounded-lg">
                        Recommended
                    </span>
                </button>

                {/* Bank Transfer */}
                <button
                    onClick={handleBankTransfer}
                    className="w-full flex items-center justify-between p-6 border-2 border-slate-200 dark:border-slate-700 rounded-xl hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all group"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center group-hover:bg-blue-600 transition-colors">
                            <Building2 className="w-6 h-6 text-blue-600 group-hover:text-white" />
                        </div>
                        <div className="text-left">
                            <p className="font-semibold text-slate-900 dark:text-white">
                                Bank Transfer
                            </p>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Transfer to our bank account directly
                            </p>
                        </div>
                    </div>
                </button>

                {/* USSD */}
                <button
                    disabled
                    className="w-full flex items-center justify-between p-6 border-2 border-slate-200 dark:border-slate-700 rounded-xl opacity-50 cursor-not-allowed"
                >
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center">
                            <Smartphone className="w-6 h-6 text-slate-400" />
                        </div>
                        <div className="text-left">
                            <p className="font-semibold text-slate-600 dark:text-slate-400">
                                USSD Payment
                            </p>
                            <p className="text-sm text-slate-500 dark:text-slate-500">
                                Coming soon
                            </p>
                        </div>
                    </div>
                    <span className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-500 text-sm font-semibold rounded-lg">
                        Coming Soon
                    </span>
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
                    className="px-8 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                >
                    Back
                </button>
            </div>
        </div>
    );
}
