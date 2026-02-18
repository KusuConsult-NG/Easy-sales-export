/**
 * Step 1: Account Type Selection
 * 
 * User chooses: Buyer, Seller, or Both
 */

"use client";

import { ShoppingCart, Store, Users } from "lucide-react";

interface AccountTypeStepProps {
    value?: "buyer" | "seller" | "both";
    onChange: (type: "buyer" | "seller" | "both") => void;
    onNext: () => void;
}

export default function AccountTypeStep({ value, onChange, onNext }: AccountTypeStepProps) {
    const accountTypes = [
        {
            id: "buyer" as const,
            icon: ShoppingCart,
            title: "Buyer",
            description: "Purchase agricultural products",
            benefits: [
                "Immediate access after onboarding",
                "Browse verified sellers",
                "Secure escrow payments",
                "Nationwide delivery options"
            ],
            color: "from-blue-600 to-cyan-600"
        },
        {
            id: "seller" as const,
            icon: Store,
            title: "Seller",
            description: "List and sell your products",
            benefits: [
                "Reach thousands of buyers",
                "Secured payment guarantee",
                "Marketing support",
                "Sales analytics dashboard"
            ],
            color: "from-green-600 to-emerald-600"
        },
        {
            id: "both" as const,
            icon: Users,
            title: "Both",
            description: "Buy and sell on the platform",
            benefits: [
                "All buyer features",
                "All seller features",
                "Flexible trading options",
                "Maximum marketplace access"
            ],
            color: "from-orange-600 to-amber-600"
        }
    ];

    const handleSelect = (type: "buyer" | "seller" | "both") => {
        onChange(type);
    };

    const handleContinue = () => {
        if (value) {
            onNext();
        }
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 mb-3">
                    Choose Your Account Type
                </h2>
                <p className="text-lg text-slate-600">
                    Select how you want to use the marketplace
                </p>
            </div>

            {/* Account Type Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {accountTypes.map((type) => {
                    const Icon = type.icon;
                    const isSelected = value === type.id;

                    return (
                        <button
                            key={type.id}
                            onClick={() => handleSelect(type.id)}
                            className={`relative p-6 rounded-2xl border-2 transition-all text-left ${isSelected
                                    ? "border-green-500 bg-green-50 shadow-lg scale-105"
                                    : "border-slate-200 bg-white hover:border-green-300 hover:shadow-md"
                                }`}
                        >
                            {/* Selection Indicator */}
                            {isSelected && (
                                <div className="absolute top-4 right-4 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            )}

                            {/* Icon */}
                            <div className={`w-16 h-16 rounded-xl bg-gradient-to-br ${type.color} flex items-center justify-center mb-4`}>
                                <Icon className="w-8 h-8 text-white" />
                            </div>

                            {/* Title & Description */}
                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                {type.title}
                            </h3>
                            <p className="text-sm text-slate-600 mb-4">
                                {type.description}
                            </p>

                            {/* Benefits */}
                            <ul className="space-y-2">
                                {type.benefits.map((benefit, index) => (
                                    <li key={index} className="flex items-start gap-2 text-sm text-slate-900">
                                        <span className="text-green-500 mt-0.5">✓</span>
                                        <span>{benefit}</span>
                                    </li>
                                ))}
                            </ul>
                        </button>
                    );
                })}
            </div>

            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-white text-sm">ℹ</span>
                    </div>
                    <div className="text-sm">
                        <p className="font-semibold text-blue-900 mb-1">
                            Onboarding Duration
                        </p>
                        <p className="text-blue-800">
                            <strong>Buyers:</strong> 4 quick steps, immediate access<br />
                            <strong>Sellers:</strong> 6 steps with document verification (1-3 days approval)
                        </p>
                    </div>
                </div>
            </div>

            {/* Continue Button */}
            <div className="flex justify-end">
                <button
                    onClick={handleContinue}
                    disabled={!value}
                    className="px-8 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
