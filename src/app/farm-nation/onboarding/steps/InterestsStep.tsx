"use client";

import { useState } from "react";
import { CheckCircle, ArrowRight, ArrowLeft } from "lucide-react";

interface InterestsStepProps {
    onNext: (data: any) => void;
    onBack: () => void;
    initialData?: any;
    role: "buyer" | "seller" | "both";
    onChange?: (data: any) => void;
}

const PROPERTY_TYPES = [
    "Cropland",
    "Pasture/Rangeland",
    "Fish Pond",
    "Poultry Farm",
    "Mixed Farm",
    "Orchard",
    "Greenhouse",
    "Livestock Farm",
];

const BUDGET_RANGES = [
    "Under ₦5M",
    "₦5M - ₦10M",
    "₦10M - ₦25M",
    "₦25M - ₦50M",
    "₦50M - ₦100M",
    "Over ₦100M",
];

const ACREAGE_RANGES = [
    "Under 5 acres",
    "5 - 10 acres",
    "10 - 50 acres",
    "50 - 100 acres",
    "Over 100 acres",
];

export default function InterestsStep({ onNext, onBack, initialData, role }: InterestsStepProps) {
    const isBuyer = role === "buyer" || role === "both";
    const isSeller = role === "seller" || role === "both";

    const [formData, setFormData] = useState({
        // Buyer fields
        propertyTypes: initialData?.propertyTypes || [],
        budgetRange: initialData?.budgetRange || "",
        preferredSize: initialData?.preferredSize || "",
        // Seller fields
        listingTypes: initialData?.listingTypes || [],
        totalAcreage: initialData?.totalAcreage || "",
        readyToList: initialData?.readyToList || false,
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const togglePropertyType = (type: string) => {
        setFormData((prev) => ({
            ...prev,
            propertyTypes: prev.propertyTypes.includes(type)
                ? prev.propertyTypes.filter((t: string) => t !== type)
                : [...prev.propertyTypes, type],
        }));
        if (errors.propertyTypes) {
            setErrors((prev) => ({ ...prev, propertyTypes: "" }));
        }
    };

    const toggleListingType = (type: string) => {
        setFormData((prev) => ({
            ...prev,
            listingTypes: prev.listingTypes.includes(type)
                ? prev.listingTypes.filter((t: string) => t !== type)
                : [...prev.listingTypes, type],
        }));
        if (errors.listingTypes) {
            setErrors((prev) => ({ ...prev, listingTypes: "" }));
        }
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (isBuyer) {
            if (formData.propertyTypes.length === 0) {
                newErrors.propertyTypes = "Select at least one property type";
            }
            if (!formData.budgetRange) {
                newErrors.budgetRange = "Select your budget range";
            }
        }

        if (isSeller) {
            if (formData.listingTypes.length === 0) {
                newErrors.listingTypes = "Select at least one property type to list";
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (validate()) {
            onNext({ interests: formData });
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
                    Your Property Preferences
                </h2>
                <p className="text-slate-600">
                    Tell us what you're looking for so we can help you better
                </p>
            </div>

            {/* Buyer Interests */}
            {isBuyer && (
                <div className="space-y-6 p-6 bg-slate-50 rounded-xl">
                    <h3 className="text-lg font-bold text-slate-900">
                        Buyer Preferences
                    </h3>

                    {/* Property Types */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-3">
                            What type of properties are you interested in? <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {PROPERTY_TYPES.map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => togglePropertyType(type)}
                                    className={`p-3 rounded-lg border-2 transition-all text-sm font-medium ${formData.propertyTypes.includes(type)
                                            ? "border-teal-600 bg-teal-50 text-teal-900"
                                            : "border-slate-200 text-slate-900 hover:border-teal-300"
                                        }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                        {errors.propertyTypes && (
                            <p className="mt-2 text-sm text-red-500">{errors.propertyTypes}</p>
                        )}
                    </div>

                    {/* Budget Range */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Budget Range <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={formData.budgetRange}
                            onChange={(e) => setFormData((prev) => ({ ...prev, budgetRange: e.target.value }))}
                            className={`w-full px-4 py-3 bg-white border ${errors.budgetRange ? "border-red-500" : "border-slate-200"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500`}
                        >
                            <option value="">Select budget range</option>
                            {BUDGET_RANGES.map((range) => (
                                <option key={range} value={range}>
                                    {range}
                                </option>
                            ))}
                        </select>
                        {errors.budgetRange && (
                            <p className="mt-1 text-sm text-red-500">{errors.budgetRange}</p>
                        )}
                    </div>

                    {/* Preferred Size */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Preferred Property Size <span className="text-slate-400">(Optional)</span>
                        </label>
                        <select
                            value={formData.preferredSize}
                            onChange={(e) => setFormData((prev) => ({ ...prev, preferredSize: e.target.value }))}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                        >
                            <option value="">Select size range</option>
                            {ACREAGE_RANGES.map((range) => (
                                <option key={range} value={range}>
                                    {range}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {/* Seller Interests */}
            {isSeller && (
                <div className="space-y-6 p-6 bg-slate-50 rounded-xl">
                    <h3 className="text-lg font-bold text-slate-900">
                        Seller Information
                    </h3>

                    {/* Listing Types */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-3">
                            What type of properties do you want to list? <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {PROPERTY_TYPES.map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => toggleListingType(type)}
                                    className={`p-3 rounded-lg border-2 transition-all text-sm font-medium ${formData.listingTypes.includes(type)
                                            ? "border-teal-600 bg-teal-50 text-teal-900"
                                            : "border-slate-200 text-slate-900 hover:border-teal-300"
                                        }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                        {errors.listingTypes && (
                            <p className="mt-2 text-sm text-red-500">{errors.listingTypes}</p>
                        )}
                    </div>

                    {/* Total Acreage */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Total Acreage Available <span className="text-slate-400">(Optional)</span>
                        </label>
                        <select
                            value={formData.totalAcreage}
                            onChange={(e) => setFormData((prev) => ({ ...prev, totalAcreage: e.target.value }))}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                        >
                            <option value="">Select total acreage</option>
                            {ACREAGE_RANGES.map((range) => (
                                <option key={range} value={range}>
                                    {range}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Ready to List */}
                    <div>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.readyToList}
                                onChange={(e) =>
                                    setFormData((prev) => ({ ...prev, readyToList: e.target.checked }))
                                }
                                className="w-5 h-5 text-teal-600 rounded border-slate-300 focus:ring-2 focus:ring-teal-500"
                            />
                            <span className="text-sm text-slate-900">
                                I have properties ready to list now
                            </span>
                        </label>
                    </div>
                </div>
            )}

            <div className="flex justify-between pt-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="px-6 py-3 border-2 border-slate-300 text-slate-900 rounded-lg font-bold hover:bg-slate-50 transition-colors flex items-center gap-2"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>
                <button
                    type="submit"
                    className="px-8 py-3 bg-teal-600 text-white rounded-lg font-bold hover:bg-teal-700 transition-colors flex items-center gap-2"
                >
                    Continue
                    <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </form>
    );
}
