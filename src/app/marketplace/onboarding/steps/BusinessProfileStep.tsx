/**
 * Step 2: Business Profile
 * 
 * Collects business information for all users
 */

"use client";

import { useState } from "react";
import { NIGERIAN_LOCATIONS, STATES } from "@/lib/locations";
import {
    BUSINESS_STATUSES,
    businessStatusLabel,
    missingForStep,
    type BusinessStatus,
} from "@/lib/marketplace-application";

interface BusinessProfileData {
    businessName: string;
    businessType: "individual" | "cooperative" | "company";
    /**
     *   THE OWNER: "business status should be mandatory."
     *
     *   The step beside this one collects a CAC certificate and an RC number
     *   and marks both Optional for everyone, so an admin reviewer could not
     *   tell a business that HAS no registration from one that simply did not
     *   attach it. This is that answer. See lib/marketplace-application.
     */
    businessStatus?: BusinessStatus;
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



export default function BusinessProfileStep({ data, onChange, onNext, onBack }: BusinessProfileStepProps) {
    const [errors, setErrors] = useState<Record<string, string>>({});
    const businessType = data?.businessType || "individual";

    /*
     *   THE SAME RULE THE SUBMIT GUARD AND THE SERVER USE.
     *
     *   This button used to be the ONLY place three of these were checked —
     *   and it is skippable, because a restored draft jumps straight to the
     *   step it was saved at. See lib/marketplace-application.
     *
     *   The 11-digit format check stays here, layered on top: it is stricter
     *   than the shared rule on purpose, and the shared rule is also applied to
     *   records prefilled from an existing application, which may hold a number
     *   in an older format.
     */
    const validate = () => {
        const newErrors = missingForStep(2, { ...data, businessType });

        const phone = data?.phone || "";
        if (phone.trim() && !/^0\d{10}$/.test(phone.replace(/\s/g, ""))) {
            newErrors.phone = "Enter a valid 11-digit phone number";
        }

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
            <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-slate-900 mb-3">
                    Business Profile
                </h2>
                <p className="text-lg text-slate-600">
                    Tell us about your business or farm
                </p>
            </div>

            <div className="space-y-6">
                {/* Business Name */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Business/Farm Name *
                    </label>
                    <input
                        type="text"
                        value={data?.businessName || ""}
                        onChange={(e) => onChange({ businessName: e.target.value })}
                        placeholder="Enter your business or farm name"
                        className={`w-full px-3.5 py-2.5 border rounded-lg text-sm bg-white text-slate-900 ${errors.businessName ? "border-red-500" : "border-slate-300"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                    />
                    {errors.businessName && (
                        <p className="mt-1 text-sm text-red-600">{errors.businessName}</p>
                    )}
                </div>

                {/* Business Type */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
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
                                onClick={() => onChange({ businessType: type.value as "individual" | "company" | "cooperative" })}
                                className={`px-4 py-3 border-2 rounded-lg font-semibold transition-all ${businessType === type.value
                                    ? "border-green-500 bg-green-50 text-green-700"
                                    : "border-slate-300 hover:border-green-300"
                                    }`}
                            >
                                {type.label}
                            </button>
                        ))}
                    </div>
                    {/*
                        The shared rule can refuse this field — a record
                        prefilled from an older application may carry a type
                        outside the three — and this row had nowhere to say so,
                        which made Continue refuse in silence.
                    */}
                    {errors.businessType && (
                        <p className="mt-1 text-sm text-red-600">{errors.businessType}</p>
                    )}
                </div>

                {/* Business Status */}
                <div>
                    <label
                        htmlFor="businessStatus"
                        className="block text-sm font-semibold text-slate-900 mb-2"
                    >
                        Business Status *
                    </label>
                    <select
                        id="businessStatus"
                        value={data?.businessStatus || ""}
                        onChange={(e) => onChange({ businessStatus: e.target.value as BusinessStatus })}
                        className={`w-full px-3.5 py-2.5 border rounded-lg text-sm bg-white text-slate-900 ${errors.businessStatus ? "border-red-500" : "border-slate-300"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                    >
                        <option value="">Select business status</option>
                        {BUSINESS_STATUSES.map((value) => (
                            <option key={value} value={value}>
                                {businessStatusLabel(value)}
                            </option>
                        ))}
                    </select>
                    <p className="mt-2 text-sm text-slate-600">
                        Tells our reviewers whether to expect a registration certificate on the next step.
                    </p>
                    {errors.businessStatus && (
                        <p className="mt-1 text-sm text-red-600">{errors.businessStatus}</p>
                    )}
                </div>

                {/* Phone Number */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Phone Number *
                    </label>
                    <input
                        type="tel"
                        value={data?.phone || ""}
                        onChange={(e) => onChange({ phone: e.target.value })}
                        placeholder="08012345678"
                        className={`w-full px-3.5 py-2.5 border rounded-lg text-sm bg-white text-slate-900 ${errors.phone ? "border-red-500" : "border-slate-300"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                    />
                    {errors.phone && (
                        <p className="mt-1 text-sm text-red-600">{errors.phone}</p>
                    )}
                </div>

                {/* State */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        State *
                    </label>
                    <select
                        value={data?.location?.state || ""}
                        onChange={(e) => onChange({ location: { ...(data?.location || {}), state: e.target.value, lga: "" } as any })}
                        className={`w-full px-3.5 py-2.5 border rounded-lg text-sm bg-white text-slate-900 ${errors.state ? "border-red-500" : "border-slate-300"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent`}
                    >
                        <option value="">Select State</option>
                        {STATES.map((state) => (
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
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Local Government Area *
                    </label>
                    <select
                        value={data?.location?.lga || ""}
                        onChange={(e) => onChange({ location: { ...(data?.location || {}), lga: e.target.value } as any })}
                        disabled={!data?.location?.state}
                        className={`w-full px-3.5 py-2.5 border rounded-lg text-sm bg-white text-slate-900 ${errors.lga ? "border-red-500" : "border-slate-300"
                            } focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50`}
                    >
                        <option value="">Select LGA</option>
                        {data?.location?.state && NIGERIAN_LOCATIONS[data.location.state]?.map((lga) => (
                            <option key={lga} value={lga}>{lga}</option>
                        ))}
                    </select>
                    {errors.lga && (
                        <p className="mt-1 text-sm text-red-600">{errors.lga}</p>
                    )}
                </div>

                {/* Address */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Business Address *
                    </label>
                    <textarea
                        value={data?.location?.address || ""}
                        onChange={(e) => onChange({ location: { ...(data?.location || {}), address: e.target.value } as any })}
                        placeholder="Enter your complete business address"
                        rows={3}
                        className={`w-full px-3.5 py-2.5 border rounded-lg text-sm bg-white text-slate-900 ${errors.address ? "border-red-500" : "border-slate-300"
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
                    className="px-8 py-3 border-2 border-slate-300 text-slate-900 font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={handleContinue}
                    className="px-8 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
