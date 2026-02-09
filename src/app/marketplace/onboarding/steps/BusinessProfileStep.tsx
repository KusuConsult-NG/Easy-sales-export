/**
 * Step 2: Business Profile
 * 
 * Collects business information for all users
 */

"use client";

import { useState } from "react";

interface BusinessProfileData {
    businessName: string;
    businessType: "individual" | "cooperative" | "company";
    phone: string;
    location: {
        state: string;
        lga: string;
        address: string;
    };
}

interface BusinessProfileStepProps {
    data: BusinessProfileData;
    onChange: (data: Partial<BusinessProfileData>) => void;
    onNext: () => void;
    onBack: () => void;
}

const nigerianStates = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
    "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
    "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
    "Yobe", "Zamfara"
];

export default function BusinessProfileStep({ data, onChange, onNext, onBack }: BusinessProfileStepProps) {
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (!data.businessName.trim()) {
            newErrors.businessName = "Business/Farm name is required";
        }

        if (!data.phone.trim()) {
            newErrors.phone = "Phone number is required";
        } else if (!/^0\d{10}$/.test(data.phone.replace(/\s/g, ""))) {
            newErrors.phone = "Enter a valid 11-digit phone number";
        }

        if (!data.location.state) {
            newErrors.state = "State is required";
        }

        if (!data.location.address.trim()) {
            newErrors.address = "Address is required";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleContinue = () => {
        if (validate()) {
            onNext();
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                    Business Profile
                </h2>
                <p className="text-lg text-slate-600 dark:text-slate-400">
                    Tell us about your business or farm
                </p>
            </div>

            <div className="max-w-2xl mx-auto space-y-6">
                {/* Business Name */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Business/Farm Name *
                    </label>
                    <input
                        type="text"
                        value={data.businessName}
                        onChange={(e) => onChange({ businessName: e.target.value })}
                        placeholder="Enter your business or farm name"
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${errors.businessName ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                    />
                    {errors.businessName && (
                        <p className="mt-1 text-sm text-red-600">{errors.businessName}</p>
                    )}
                </div>

                {/* Business Type */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Business Type *
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { value: "individual", label: "Individual" },
                            { value: "cooperative", label: "Cooperative" },
                            { value: "company", label: "Company" }
                        ].map((type) => (
                            <button
                                key={type.value}
                                onClick={() => onChange({ businessType: type.value as any })}
                                className={`px-4 py-3 border-2 rounded-xl font-semibold transition-all ${data.businessType === type.value
                                        ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                                        : "border-slate-300 dark:border-slate-600 hover:border-green-300"
                                    }`}
                            >
                                {type.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Phone Number */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Phone Number *
                    </label>
                    <input
                        type="tel"
                        value={data.phone}
                        onChange={(e) => onChange({ phone: e.target.value })}
                        placeholder="08012345678"
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${errors.phone ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                    />
                    {errors.phone && (
                        <p className="mt-1 text-sm text-red-600">{errors.phone}</p>
                    )}
                </div>

                {/* State */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        State *
                    </label>
                    <select
                        value={data.location.state}
                        onChange={(e) => onChange({ location: { ...data.location, state: e.target.value } })}
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${errors.state ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                    >
                        <option value="">Select State</option>
                        {nigerianStates.map((state) => (
                            <option key={state} value={state}>
                                {state}
                            </option>
                        ))}
                    </select>
                    {errors.state && (
                        <p className="mt-1 text-sm text-red-600">{errors.state}</p>
                    )}
                </div>

                {/* LGA */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Local Government Area
                    </label>
                    <input
                        type="text"
                        value={data.location.lga}
                        onChange={(e) => onChange({ location: { ...data.location, lga: e.target.value } })}
                        placeholder="Enter LGA"
                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                </div>

                {/* Address */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Business Address *
                    </label>
                    <textarea
                        value={data.location.address}
                        onChange={(e) => onChange({ location: { ...data.location, address: e.target.value } })}
                        placeholder="Enter your complete business address"
                        rows={3}
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white ${errors.address ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                    />
                    {errors.address && (
                        <p className="mt-1 text-sm text-red-600">{errors.address}</p>
                    )}
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
