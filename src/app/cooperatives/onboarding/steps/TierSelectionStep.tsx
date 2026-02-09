/**
 * Tier Selection Step
 * 
 * Select cooperative membership tier with monthly/annual payment options
 */

"use client";

import { CheckCircle } from "lucide-react";

interface TierSelectionStepProps {
    data: {
        tier: "basic" | "premium" | "gold" | "";
        paymentCycle: "monthly" | "annual";
    };
    onChange: (data: any) => void;
    onNext: () => void;
}

export default function TierSelectionStep({ data, onChange, onNext }: TierSelectionStepProps) {
    const tiers = [
        {
            id: "basic" as const,
            name: "Basic",
            monthlyPrice: 5000,
            features: [
                "5% interest on savings",
                "Access to microloans",
                "Monthly financial literacy training",
                "Community networking",
            ],
            color: "from-blue-500 to-cyan-500"
        },
        {
            id: "premium" as const,
            name: "Premium",
            monthlyPrice: 15000,
            features: [
                "8% interest on savings",
                "Priority loan approval",
                "Business development workshops",
                "Export opportunities access",
                "Quarterly dividends",
            ],
            color: "from-purple-500 to-pink-500",
            popular: true
        },
        {
            id: "gold" as const,
            name: "Gold",
            monthlyPrice: 30000,
            features: [
                "12% interest on savings",
                "Unlimited loan access",
                "One-on-one business mentorship",
                "Investment opportunities",
                "Premium networking events",
                "Annual profit sharing",
            ],
            color: "from-yellow-500 to-orange-500"
        }
    ];

    const calculatePrice = (monthlyPrice: number) => {
        if (data.paymentCycle === "annual") {
            return monthlyPrice * 12 * 0.9; // 10% discount for annual
        }
        return monthlyPrice;
    };

    const handleContinue = () => {
        if (!data.tier) {
            alert("Please select a membership tier");
            return;
        }
        onNext();
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                    Choose Your Membership Tier
                </h2>
                <p className="text-lg text-slate-600 dark:text-slate-400">
                    Select the plan that best fits your financial goals
                </p>
            </div>

            {/* Payment Cycle Toggle */}
            <div className="flex justify-center">
                <div className="inline-flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
                    <button
                        onClick={() => onChange({ ...data, paymentCycle: "monthly" })}
                        className={`px-6 py-2 rounded-lg font-semibold transition-all ${data.paymentCycle === "monthly"
                                ? "bg-white dark:bg-slate-700 text-purple-600 shadow-md"
                                : "text-slate-600 dark:text-slate-400"
                            }`}
                    >
                        Monthly
                    </button>
                    <button
                        onClick={() => onChange({ ...data, paymentCycle: "annual" })}
                        className={`px-6 py-2 rounded-lg font-semibold transition-all relative ${data.paymentCycle === "annual"
                                ? "bg-white dark:bg-slate-700 text-purple-600 shadow-md"
                                : "text-slate-600 dark:text-slate-400"
                            }`}
                    >
                        Annual
                        <span className="absolute -top-2 -right-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
                            Save 10%
                        </span>
                    </button>
                </div>
            </div>

            {/* Tiers Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {tiers.map((tier) => {
                    const isSelected = data.tier === tier.id;
                    const price = calculatePrice(tier.monthlyPrice);

                    return (
                        <button
                            key={tier.id}
                            onClick={() => onChange({ ...data, tier: tier.id })}
                            className={`relative text-left p-6 rounded-2xl border-2 transition-all ${isSelected
                                    ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20 shadow-lg scale-105"
                                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-purple-300 hover:shadow-md"
                                }`}
                        >
                            {tier.popular && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                    <span className="px-4 py-1 bg-purple-600 text-white text-xs font-bold rounded-full">
                                        Most Popular
                                    </span>
                                </div>
                            )}

                            {isSelected && (
                                <div className="absolute -top-3 -right-3">
                                    <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
                                        <CheckCircle className="w-5 h-5 text-white" />
                                    </div>
                                </div>
                            )}

                            <div className={`w-full h-1.5 bg-gradient-to-r ${tier.color} rounded-full mb-4`}></div>

                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                {tier.name}
                            </h3>

                            <div className="mb-4">
                                <span className="text-3xl font-bold text-slate-900 dark:text-white">
                                    ₦{price.toLocaleString()}
                                </span>
                                <span className="text-slate-600 dark:text-slate-400">
                                    /{data.paymentCycle === "monthly" ? "month" : "year"}
                                </span>
                            </div>

                            {data.paymentCycle === "annual" && (
                                <div className="mb-4 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                                    <p className="text-sm text-green-700 dark:text-green-300">
                                        Save ₦{(tier.monthlyPrice * 12 * 0.1).toLocaleString()} per year
                                    </p>
                                </div>
                            )}

                            <ul className="space-y-2">
                                {tier.features.map((feature, idx) => (
                                    <li key={idx} className="flex items-start gap-2">
                                        <CheckCircle className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                                        <span className="text-sm text-slate-600 dark:text-slate-400">
                                            {feature}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </button>
                    );
                })}
            </div>

            {/* Info Banner */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                    💡 <strong>Note:</strong> Your initial payment covers your first {data.paymentCycle === "monthly" ? "month" : "year"} of membership.
                    Subsequent payments will be {data.paymentCycle === "monthly" ? "monthly" : "annually"} on the same date.
                </p>
            </div>

            {/* Navigation */}
            <div className="flex justify-end pt-6">
                <button
                    onClick={handleContinue}
                    disabled={!data.tier}
                    className="px-8 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
