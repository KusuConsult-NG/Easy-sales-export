/**
 * Step 1: Account Type Selection & Seller Category
 *
 * User chooses: Buyer, Seller, or Both.
 * If Seller/Both is selected they also choose: Wholesale or Retail.
 */

"use client";

import { ShoppingCart, Store, Users, Package, ShoppingBag } from "lucide-react";

import { kindsOf, sellerCategoryFor, type SellerCategory } from "@/lib/seller-category";

/**
 *   "both" joined this the way it has always been on the account type beside
 *   it. See lib/seller-category — the value is queried by the broadcast
 *   audiences, so the vocabulary is shared rather than restated here.
 */
export type SellerCategoryType = SellerCategory;

interface AccountTypeStepProps {
    value?: "buyer" | "seller" | "both";
    sellerCategory?: SellerCategoryType;
    onChange: (type: "buyer" | "seller" | "both") => void;
    onSellerCategoryChange?: (cat: SellerCategoryType) => void;
    onNext: () => void;
}

export default function AccountTypeStep({ value, sellerCategory, onChange, onSellerCategoryChange, onNext }: AccountTypeStepProps) {
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

    function handleSelect(type: "buyer" | "seller" | "both") {
        onChange(type);
    };

    function handleContinue() {
        if (!value) return;
        // Sellers must pick a category before continuing
        if ((value === "seller" || value === "both") && !sellerCategory) return;
        onNext();
    };

    const showCategoryPicker = value === "seller" || value === "both";

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
                            <div className={`w-16 h-16 rounded-xl bg-linear-to-br ${type.color} flex items-center justify-center mb-4`}>
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

            {/* Seller Category Picker */}
            {showCategoryPicker && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-slate-900 mb-1">Seller Category</h3>
                    <p className="text-sm text-slate-500 mb-4">Choose everything that describes your business — you can pick both</p>
                    <div className="grid grid-cols-2 gap-4">
                        {/*
                          *   TOGGLES, NOT A CHOICE OF ONE.
                          *
                          *   THE OWNER: "select both wholesale and retail should be
                          *   enabled during onboarding on marketplace."
                          *
                          *   These were exclusive — clicking one replaced the other —
                          *   so a seller who does both had to pick the one they did
                          *   less of. Each is its own tick now and the two together
                          *   store "both", which is the same shape the ACCOUNT type
                          *   above has always had.
                          */}
                        {([
                            { kind: "wholesale" as const, Icon: Package, label: "Wholesale",
                              blurb: "Bulk orders, large quantities, B2B trade",
                              on: "border-blue-500 bg-blue-50", hover: "hover:border-blue-300", tint: "text-blue-600" },
                            { kind: "retail" as const, Icon: ShoppingBag, label: "Retail",
                              blurb: "Individual buyers, smaller quantities, B2C",
                              on: "border-emerald-500 bg-emerald-50", hover: "hover:border-emerald-300", tint: "text-emerald-600" },
                        ]).map(({ kind, Icon, label, blurb, on, hover, tint }) => {
                            const chosen = kindsOf(sellerCategory);
                            const selected = chosen.includes(kind);
                            return (
                                <button
                                    key={kind}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => {
                                        const next = selected
                                            ? chosen.filter((k) => k !== kind)
                                            : [...chosen, kind];
                                        //   Null when they have just unticked the last
                                        //   one, which is what the "you must choose"
                                        //   guard below tests for.
                                        onSellerCategoryChange?.(sellerCategoryFor(next) as SellerCategoryType);
                                    }}
                                    className={`p-4 rounded-xl border-2 text-left transition-all ${selected
                                        ? on
                                        : `border-slate-200 bg-white ${hover}`
                                        }`}
                                >
                                    <Icon className={`w-8 h-8 ${tint} mb-2`} />
                                    <p className="font-bold text-slate-900">{label}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">{blurb}</p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center shrink-0 mt-0.5">
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
                    disabled={!value || ((value === "seller" || value === "both") && !sellerCategory)}
                    className="px-8 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
