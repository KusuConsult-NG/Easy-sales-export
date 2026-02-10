/**
 * Tier Selection Step
 * 
 * Select cooperative membership tier with monthly/annual payment options
 */

"use client";

import { CheckCircle } from "lucide-react";

interface TierSelectionStepProps {
    data: {
        tier: "basic" | "premium" | "";
    };
    onChange: (data: any) => void;
    onNext: () => void;
}

export default function TierSelectionStep({ data, onChange, onNext }: TierSelectionStepProps) {
    const tiers = [
        {
            id: "basic" as const,
            name: "Basic",
            price: 10000, // One-time payment
            features: [
                "Access to cooperative loans",
                "2x contribution loan limit",
                "Monthly interest rate: 2.5%",
                "6-month maximum repayment period",
                "Group savings benefits",
            ],
            color: "from-blue-500 to-cyan-500"
        },
        {
            id: "premium" as const,
            name: "Premium",
            price: 20000, // One-time payment
            features: [
                "Access to cooperative loans",
                "3x contribution loan limit",
                "Monthly interest rate: 2%",
                "12-month maximum repayment period",
                "Priority loan processing",
                "Export aggregation priority slots",
                "Group savings benefits",
            ],
            color: "from-purple-500 to-pink-500",
            popular: true
        }
    ];

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

            {/* Info Banner */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 max-w-2xl mx-auto">
                <p className="text-sm text-blue-800 dark:text-blue-300 text-center">
                    💡 <strong>One-Time Registration Fee</strong> - Select your membership tier below. This is a one-time payment that grants lifetime cooperative membership.
                </p>
            </div>

            {/* Tiers Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {tiers.map((tier) => {
                    const isSelected = data.tier === tier.id;

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
                                    ₦{tier.price.toLocaleString()}
                                </span>
                                <span className="text-slate-600 dark:text-slate-400 text-sm ml-2">
                                    one-time
                                </span>
                            </div>

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
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
                <p className="text-sm text-green-800 dark:text-green-300">
                    ✅ <strong>Lifetime Membership:</strong> This is a one-time registration fee. Once approved, you'll have permanent access to all cooperative benefits including savings and loans.
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
