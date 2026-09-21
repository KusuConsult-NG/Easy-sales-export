/**
 * Step 3: Product Interests
 * 
 * Different fields for buyers vs sellers
 */

"use client";

import { useState } from "react";
import {
    PRODUCT_STATUSES,
    productStatusLabel,
    missingForStep,
    type ProductStatus,
} from "@/lib/marketplace-application";

interface ProductInterestsData {
    // Buyer fields
    buyerInterests?: string[];
    orderVolume?: string;
    deliveryPreferences?: string[];

    // Seller fields
    sellerCategories?: string[];
    /**
     *   THE OWNER: "Product ... status should be mandatory."
     *
     *   A seller listing a harvest three months out is not the same applicant
     *   as one with stock in a warehouse today, and nothing on the application
     *   said which. See lib/marketplace-application.
     */
    productStatus?: ProductStatus;
    productionCapacity?: string;
    certifications?: string[];
}

interface ProductInterestsStepProps {
    accountType: "buyer" | "seller" | "both";
    data: ProductInterestsData;
    onChange: (data: Partial<ProductInterestsData>) => void;
    onNext: () => void;
    onBack: () => void;
}

const productCategories = [
    "Grains & Cereals", "Roots & Tubers", "Vegetables", "Fruits",
    "Nuts & Seeds", "Spices", "Oil Seeds", "Animal Products",
    "Processed Foods", "Organic Products"
];

const certificationOptions = [
    "Organic Certification", "NAFDAC Registration", "Export Quality",
    "Good Agricultural Practice (GAP)", "Halal Certification"
];

export default function ProductInterestsStep({ accountType, data, onChange, onNext, onBack }: ProductInterestsStepProps) {
    const [errors, setErrors] = useState<Record<string, string>>({});
    const isBuyer = accountType === "buyer" || accountType === "both";
    const isSeller = accountType === "seller" || accountType === "both";

    const toggleCategory = (category: string, field: "buyerInterests" | "sellerCategories") => {
        const current = data[field] || [];
        const updated = current.includes(category)
            ? current.filter(c => c !== category)
            : [...current, category];
        onChange({ [field]: updated });
    };

    const toggleCertification = (cert: string) => {
        const current = data.certifications || [];
        const updated = current.includes(cert)
            ? current.filter(c => c !== cert)
            : [...current, cert];
        onChange({ certifications: updated });
    };

    /*
     *   THE SAME RULE THE SUBMIT GUARD AND THE SERVER USE.
     *
     *   Until now this button was the ONLY place these were checked anywhere on
     *   the platform — the submit guard's schema had no field for them and the
     *   server defaulted them away. See lib/marketplace-application.
     */
    const validate = () => {
        const newErrors = missingForStep(3, { ...data, accountType });

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    function handleContinue() {
        if (validate()) {
            onNext();
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 mb-3">
                    Product Interests
                </h2>
                <p className="text-lg text-slate-600">
                    {isBuyer && isSeller
                        ? "Select categories for buying and selling"
                        : isBuyer
                            ? "What products are you interested in buying?"
                            : "What products will you sell?"}
                </p>
            </div>

            <div className="max-w-3xl mx-auto space-y-8">
                {/* Buyer Section */}
                {isBuyer && (
                    <div className="space-y-4">
                        <h3 className="text-xl font-bold text-slate-900">
                            Buying Interests
                        </h3>

                        {/* Product Categories */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-3">
                                Product Categories of Interest *
                            </label>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {productCategories.map((category) => (
                                    <button
                                        key={category}
                                        onClick={() => toggleCategory(category, "buyerInterests")}
                                        className={`px-4 py-3 border-2 rounded-xl text-sm font-medium transition-all ${data.buyerInterests?.includes(category)
                                                ? "border-blue-500 bg-blue-50 text-blue-700"
                                                : "border-slate-300 hover:border-blue-300"
                                            }`}
                                    >
                                        {category}
                                    </button>
                                ))}
                            </div>
                            {errors.buyerInterests && (
                                <p className="mt-2 text-sm text-red-600">{errors.buyerInterests}</p>
                            )}
                        </div>

                        {/* Order Volume */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-3">
                                Typical Order Volume
                            </label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {["Small (1-50kg)", "Medium (50-500kg)", "Large (500kg-5 tons)", "Bulk (5+ tons)"].map((volume) => (
                                    <button
                                        key={volume}
                                        onClick={() => onChange({ orderVolume: volume })}
                                        className={`px-4 py-3 border-2 rounded-xl text-sm font-medium transition-all ${data.orderVolume === volume
                                                ? "border-blue-500 bg-blue-50 text-blue-700"
                                                : "border-slate-300 hover:border-blue-300"
                                            }`}
                                    >
                                        {volume}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Seller Section */}
                {isSeller && (
                    <div className="space-y-4">
                        <h3 className="text-xl font-bold text-slate-900">
                            Selling Details
                        </h3>

                        {/* Product Categories */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-3">
                                Product Categories to Sell *
                            </label>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {productCategories.map((category) => (
                                    <button
                                        key={category}
                                        onClick={() => toggleCategory(category, "sellerCategories")}
                                        className={`px-4 py-3 border-2 rounded-xl text-sm font-medium transition-all ${data.sellerCategories?.includes(category)
                                                ? "border-green-500 bg-green-50 text-green-700"
                                                : "border-slate-300 hover:border-green-300"
                                            }`}
                                    >
                                        {category}
                                    </button>
                                ))}
                            </div>
                            {errors.sellerCategories && (
                                <p className="mt-2 text-sm text-red-600">{errors.sellerCategories}</p>
                            )}
                        </div>

                        {/* Product Status */}
                        <div>
                            <label
                                htmlFor="productStatus"
                                className="block text-sm font-semibold text-slate-900 mb-3"
                            >
                                Product Status *
                            </label>
                            <select
                                id="productStatus"
                                value={data.productStatus || ""}
                                onChange={(e) => onChange({ productStatus: e.target.value as ProductStatus })}
                                className={`w-full px-4 py-3 border-2 rounded-xl text-sm font-medium bg-white text-slate-900 ${errors.productStatus ? "border-red-500" : "border-slate-300"
                                    } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                            >
                                <option value="">Select product status</option>
                                {PRODUCT_STATUSES.map((value) => (
                                    <option key={value} value={value}>
                                        {productStatusLabel(value)}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-2 text-sm text-slate-600">
                                Whether buyers can order from you today, in season, or ahead of harvest.
                            </p>
                            {errors.productStatus && (
                                <p className="mt-2 text-sm text-red-600">{errors.productStatus}</p>
                            )}
                        </div>

                        {/* Production Capacity */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-3">
                                Monthly Production Capacity
                            </label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {["< 100kg", "100kg - 1 ton", "1 - 10 tons", "10+ tons"].map((capacity) => (
                                    <button
                                        key={capacity}
                                        onClick={() => onChange({ productionCapacity: capacity })}
                                        className={`px-4 py-3 border-2 rounded-xl text-sm font-medium transition-all ${data.productionCapacity === capacity
                                                ? "border-green-500 bg-green-50 text-green-700"
                                                : "border-slate-300 hover:border-green-300"
                                            }`}
                                    >
                                        {capacity}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Certifications */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-3">
                                Certifications (if any)
                            </label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {certificationOptions.map((cert) => (
                                    <button
                                        key={cert}
                                        onClick={() => toggleCertification(cert)}
                                        className={`px-4 py-3 border-2 rounded-xl text-sm font-medium text-left transition-all ${data.certifications?.includes(cert)
                                                ? "border-green-500 bg-green-50 text-green-700"
                                                : "border-slate-300 hover:border-green-300"
                                            }`}
                                    >
                                        {cert}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={handleContinue}
                    className="px-8 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
