/**
 * Personal Information Step
 * 
 * Collect member's personal details
 */

"use client";

import { useState } from "react";

interface PersonalInfoStepProps {
    data: {
        fullName: string;
        phone: string;
        email: string;
        dateOfBirth: string;
        gender: string;
        address: {
            state: string;
            lga: string;
            street: string;
        };
        occupation: string;
    };
    onChange: (data: any) => void;
    onNext: () => void;
    onBack: () => void;
}

import { useToast } from "@/contexts/ToastContext";

export default function PersonalInfoStep({ data, onChange, onNext, onBack }: PersonalInfoStepProps) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});

    const nigeriaStates = [
        "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
        "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
        "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
        "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
        "Yobe", "Zamfara"
    ];

    const validate = () => {
        const newErrors: Record<string, string> = {};

        if (!data.fullName.trim()) {
            newErrors.fullName = "Full name is required";
        }

        if (!data.phone.trim()) {
            newErrors.phone = "Phone number is required";
        } else if (!/^0\d{10}$/.test(data.phone.replace(/\s/g, ""))) {
            newErrors.phone = "Enter a valid 11-digit phone number";
        }

        if (!data.email.trim()) {
            newErrors.email = "Email is required";
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
            newErrors.email = "Enter a valid email address";
        }

        if (!data.dateOfBirth) {
            newErrors.dateOfBirth = "Date of birth is required";
        } else {
            const age = Math.floor((new Date().getTime() - new Date(data.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
            if (age < 18) {
                newErrors.dateOfBirth = "You must be at least 18 years old";
            }
        }

        if (!data.gender) {
            newErrors.gender = "Please select your gender";
        }

        if (!data.occupation?.trim()) {
            newErrors.occupation = "Occupation is required";
        }

        if (!data.address.state) {
            newErrors.state = "State is required";
        }

        if (!data.address.street.trim()) {
            newErrors.street = "Street address is required";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleContinue = () => {
        if (validate()) {
            onNext();
        } else {
            showToast("Please provide all required personal information", "error");
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
                    Personal Information
                </h2>
                <p className="text-lg text-slate-600 dark:text-slate-400">
                    Tell us about yourself
                </p>
            </div>

            {/* Form */}
            <div className="max-w-2xl mx-auto space-y-6">
                {/* Full Name */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={data.fullName}
                        onChange={(e) => onChange({ ...data, fullName: e.target.value })}
                        placeholder="John Doe"
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.fullName ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            }`}
                    />
                    {errors.fullName && (
                        <p className="text-sm text-red-600 mt-1">{errors.fullName}</p>
                    )}
                </div>

                {/* Phone and Email */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
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

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Email Address <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="email"
                            value={data.email}
                            onChange={(e) => onChange({ ...data, email: e.target.value })}
                            placeholder="john@example.com"
                            className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.email ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                                }`}
                        />
                        {errors.email && (
                            <p className="text-sm text-red-600 mt-1">{errors.email}</p>
                        )}
                    </div>
                </div>

                {/* Date of Birth and Gender */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Date of Birth <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="date"
                            value={data.dateOfBirth}
                            onChange={(e) => onChange({ ...data, dateOfBirth: e.target.value })}
                            max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
                            className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.dateOfBirth ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                                }`}
                        />
                        {errors.dateOfBirth && (
                            <p className="text-sm text-red-600 mt-1">{errors.dateOfBirth}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Gender <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={data.gender}
                            onChange={(e) => onChange({ ...data, gender: e.target.value })}
                            className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.gender ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                                }`}
                        >
                            <option value="">Select gender</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Other</option>
                        </select>
                        {errors.gender && (
                            <p className="text-sm text-red-600 mt-1">{errors.gender}</p>
                        )}
                    </div>
                </div>

                {/* Occupation */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        Occupation <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={data.occupation}
                        onChange={(e) => onChange({ ...data, occupation: e.target.value })}
                        placeholder="e.g. Farmer, Trader, Civil Servant"
                        className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.occupation ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                            }`}
                    />
                    {errors.occupation && (
                        <p className="text-sm text-red-600 mt-1">{errors.occupation}</p>
                    )}
                </div>

                {/* Address */}
                <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                    <h3 className="font-semibold text-slate-900 dark:text-white">Address</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                State <span className="text-red-500">*</span>
                            </label>
                            <select
                                value={data.address.state}
                                onChange={(e) => onChange({ ...data, address: { ...data.address, state: e.target.value, lga: "" } })}
                                className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.state ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                                    }`}
                            >
                                <option value="">Select state</option>
                                {nigeriaStates.map((state) => (
                                    <option key={state} value={state}>{state}</option>
                                ))}
                            </select>
                            {errors.state && (
                                <p className="text-sm text-red-600 mt-1">{errors.state}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                LGA
                            </label>
                            <input
                                type="text"
                                value={data.address.lga}
                                onChange={(e) => onChange({ ...data, address: { ...data.address, lga: e.target.value } })}
                                placeholder="Local Government Area"
                                disabled={!data.address.state}
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Street Address <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            value={data.address.street}
                            onChange={(e) => onChange({ ...data, address: { ...data.address, street: e.target.value } })}
                            placeholder="House number and street name"
                            rows={3}
                            className={`w-full px-4 py-3 border rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.street ? "border-red-500" : "border-slate-300 dark:border-slate-600"
                                }`}
                        />
                        {errors.street && (
                            <p className="text-sm text-red-600 mt-1">{errors.street}</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
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
