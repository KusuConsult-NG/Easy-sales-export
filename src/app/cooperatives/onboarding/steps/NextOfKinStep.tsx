/**
 * Next of Kin Step
 * 
 * Collect emergency contact details
 */

"use client";

import { useState } from "react";

interface NextOfKinStepProps {
    data: {
        fullName: string;
        relationship: string;
        phone: string;
        address: string;
    };
    onChange: (data: any) => void;
    onNext: () => void;
    onBack: () => void;
}

export default function NextOfKinStep({ data, onChange, onNext, onBack }: NextOfKinStepProps) {
    const [errors, setErrors] = useState<Record<string, string>>({});

    const relationships = [
        "Spouse",
        "Parent",
        "Sibling",
        "Child",
        "Relative",
        "Friend",
        "Other"
    ];

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (!data.fullName.trim()) {
            newErrors.fullName = "Next of kin name is required";
        }

        if (!data.relationship) {
            newErrors.relationship = "Please select relationship";
        }

        if (!data.phone.trim()) {
            newErrors.phone = "Phone number is required";
        } else if (!/^0\d{10}$/.test(data.phone.replace(/\s/g, ""))) {
            newErrors.phone = "Enter a valid 11-digit phone number";
        }

        if (!data.address.trim()) {
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
        <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                    Next of Kin Information
                </h2>
                <p className="text-lg text-slate-600 dark:text-slate-400">
                    Provide emergency contact details
                </p>
            </div>

            {/* Info Banner */}
            <div className="max-w-2xl mx-auto bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                    ℹ️ Your next of kin will be contacted in case of emergencies and will be the beneficiary
                    of your savings in the event of unforeseen circumstances.
                </p>
            </div>

            {/* Form */}
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Full Name */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={data.fullName}
                        onChange={(e) => onChange({ ...data, fullName: e.target.value })}
                        placeholder="Jane Doe"
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.fullName ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            }`}
                    />
                    {errors.fullName && (
                        <p className="text-sm text-red-600 mt-1">{errors.fullName}</p>
                    )}
                </div>

                {/* Relationship */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Relationship <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={data.relationship}
                        onChange={(e) => onChange({ ...data, relationship: e.target.value })}
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.relationship ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            }`}
                    >
                        <option value="">Select relationship</option>
                        {relationships.map((rel) => (
                            <option key={rel} value={rel.toLowerCase()}>{rel}</option>
                        ))}
                    </select>
                    {errors.relationship && (
                        <p className="text-sm text-red-600 mt-1">{errors.relationship}</p>
                    )}
                </div>

                {/* Phone Number */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Phone Number <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="tel"
                        value={data.phone}
                        onChange={(e) => onChange({ ...data, phone: e.target.value })}
                        placeholder="08012345678"
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.phone ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            }`}
                    />
                    {errors.phone && (
                        <p className="text-sm text-red-600 mt-1">{errors.phone}</p>
                    )}
                </div>

                {/* Address */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Address <span className="text-red-500">*</span>
                    </label>
                    <textarea
                        value={data.address}
                        onChange={(e) => onChange({ ...data, address: e.target.value })}
                        placeholder="Full address including state"
                        rows={3}
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.address ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            }`}
                    />
                    {errors.address && (
                        <p className="text-sm text-red-600 mt-1">{errors.address}</p>
                    )}
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
                <button
                    onClick={handleContinue}
                    className="px-8 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
