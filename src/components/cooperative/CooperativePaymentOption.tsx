"use client";

import { useState, useEffect } from "react";
import { Check, Wallet, Loader2, CreditCard } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { checkCooperativeCreditEligibility } from "@/lib/cooperative-utils";

interface CooperativePaymentOptionProps {
    amount: number;
    onSelect: (method: "cooperative" | "card") => void;
    selected?: "cooperative" | "card";
}

export default function CooperativePaymentOption({
    amount,
    onSelect,
    selected,
}: CooperativePaymentOptionProps) {
    const [checking, setChecking] = useState(true);
    const [eligible, setEligible] = useState(false);
    const [availableCredit, setAvailableCredit] = useState(0);

    useEffect(() => {
        checkEligibility();
    }, [amount]);

    async function checkEligibility() {
        setChecking(true);
        try {
            const result = await checkCooperativeCreditEligibility(amount);
            if (result.success) {
                setEligible(result.eligible || false);
                setAvailableCredit(result.availableCredit || 0);
            }
        } catch (error) {
            console.error("Failed to check eligibility:", error);
        } finally {
            setChecking(false);
        }
    }

    if (checking) {
        return (
            <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                <Loader2 className="w-6 h-6 animate-spin text-green-600 mx-auto" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Cooperative Credit Option */}
            {eligible && (
                <button
                    type="button"
                    onClick={() => onSelect("cooperative")}
                    className={`w-full p-6 rounded-xl border-2 transition-all text-left ${selected === "cooperative"
                        ? "border-green-600 bg-green-50 dark:bg-green-900/20"
                        : "border-slate-200 dark:border-slate-700 hover:border-green-400"
                        }`}
                >
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <Wallet className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                                    Cooperative Credit
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Pay with your cooperative savings
                                </p>
                                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                    Available: {formatCurrency(availableCredit)}
                                </p>
                            </div>
                        </div>
                        {selected === "cooperative" && (
                            <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center">
                                <Check className="w-4 h-4 text-white" />
                            </div>
                        )}
                    </div>
                </button>
            )}

            {/* Low Credit Alert */}
            {!eligible && availableCredit > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                        💡 Your available credit ({formatCurrency(availableCredit)}) is insufficient for this purchase.
                        Contribute more to your savings to increase your credit limit.
                    </p>
                </div>
            )}

            {/* Not a Member Alert */}
            {!eligible && availableCredit === 0 && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                        💡 Join the cooperative to unlock credit for marketplace purchases!
                    </p>
                    <a
                        href="/cooperatives/register"
                        className="text-blue-600 dark:text-blue-400 font-semibold hover:underline text-sm"
                    >
                        Learn More →
                    </a>
                </div>
            )}

            {/* Card Payment Option */}
            <button
                type="button"
                onClick={() => onSelect("card")}
                className={`w-full p-6 rounded-xl border-2 transition-all text-left ${selected === "card"
                    ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                    : "border-slate-200 dark:border-slate-700 hover:border-blue-400"
                    }`}
            >
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                            <CreditCard className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                                Card Payment
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Pay with debit or credit card
                            </p>
                        </div>
                    </div>
                    {selected === "card" && (
                        <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
                            <Check className="w-4 h-4 text-white" />
                        </div>
                    )}
                </div>
            </button>
        </div>
    );
}
