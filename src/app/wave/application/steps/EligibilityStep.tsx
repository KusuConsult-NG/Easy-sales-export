/**
 * Step 1: Eligibility Check
 * Female applicants aged 18-55, Nigerian citizenship
 */

"use client";

import { useState } from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import type { WaveApplicationData } from "../page";

interface Props {
    data: WaveApplicationData;
    updateData: (data: Partial<WaveApplicationData>) => void;
    onNext: () => void;
}

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa",
    "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo",
    "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa",
    "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara",
    "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
    "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

export default function EligibilityStep({ data, updateData, onNext }: Props) {
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateAge = (dobString: string): boolean => {
        if (!dobString) return false;
        const dob = new Date(dobString);
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
            age--;
        }
        return age >= 18 && age <= 55;
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!data.fullName.trim()) newErrors.fullName = "Full name is required";
        if (!data.email.trim() || !/\S+@\S+\.\S+/.test(data.email)) {
            newErrors.email = "Valid email is required";
        }
        if (!data.phone.trim() || !/^[0-9]{11}$/.test(data.phone.replace(/\D/g, ""))) {
            newErrors.phone = "Valid 11-digit phone number required";
        }
        if (!data.dateOfBirth) {
            newErrors.dateOfBirth = "Date of birth is required";
        } else if (!validateAge(data.dateOfBirth)) {
            newErrors.dateOfBirth = "You must be between 18 and 55 years old";
        }
        if (data.gender !== "female") {
            newErrors.gender = "WAVE program is exclusively for female farmers";
        }
        if (!data.stateOfResidence) {
            newErrors.stateOfResidence = "State of residence is required";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (validateForm()) {
            onNext();
        }
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                Eligibility Check
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8">
                Please provide your basic information to verify eligibility
            </p>

            <div className="space-y-6">
                {/* Full Name */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Full Name *
                    </label>
                    <input
                        type="text"
                        value={data.fullName}
                        onChange={(e) => updateData({ fullName: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 dark:bg-slate-700 dark:text-white"
                        placeholder="Enter your full name"
                    />
                    {errors.fullName && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.fullName}
                        </p>
                    )}
                </div>

                {/* Email & Phone */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            Email Address *
                        </label>
                        <input
                            type="email"
                            value={data.email}
                            onChange={(e) => updateData({ email: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 dark:bg-slate-700 dark:text-white"
                            placeholder="you@example.com"
                        />
                        {errors.email && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.email}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            Phone Number *
                        </label>
                        <input
                            type="tel"
                            value={data.phone}
                            onChange={(e) => updateData({ phone: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 dark:bg-slate-700 dark:text-white"
                            placeholder="08012345678"
                        />
                        {errors.phone && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.phone}
                            </p>
                        )}
                    </div>
                </div>

                {/* Date of Birth & Gender */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            Date of Birth * (Age 18-55)
                        </label>
                        <input
                            type="date"
                            value={data.dateOfBirth}
                            onChange={(e) => updateData({ dateOfBirth: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 dark:bg-slate-700 dark:text-white"
                        />
                        {errors.dateOfBirth && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.dateOfBirth}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            Gender * (Female only)
                        </label>
                        <select
                            value={data.gender}
                            onChange={(e) => updateData({ gender: e.target.value as "female" | "male" | "" })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 dark:bg-slate-700 dark:text-white"
                        >
                            <option value="">Select gender</option>
                            <option value="female">Female</option>
                            <option value="male">Male</option>
                        </select>
                        {errors.gender && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.gender}
                            </p>
                        )}
                    </div>
                </div>

                {/* State of Residence */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        State of Residence *
                    </label>
                    <select
                        value={data.stateOfResidence}
                        onChange={(e) => updateData({ stateOfResidence: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-rose-500 focus:border-rose-500 dark:bg-slate-700 dark:text-white"
                    >
                        <option value="">Select state</option>
                        {NIGERIAN_STATES.map((state) => (
                            <option key={state} value={state}>
                                {state}
                            </option>
                        ))}
                    </select>
                    {errors.stateOfResidence && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.stateOfResidence}
                        </p>
                    )}
                </div>

                {/* Female-only notice */}
                {data.gender === "female" && (
                    <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl p-4">
                        <div className="flex items-start gap-3">
                            <CheckCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                            <div>
                                <h4 className="font-semibold text-rose-900 dark:text-rose-200 mb-1">
                                    Eligibility Confirmed
                                </h4>
                                <p className="text-sm text-rose-700 dark:text-rose-300">
                                    Great! As a female Nigerian farmer, you're eligible for the WAVE program. Continue with your application.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Next Button */}
            <div className="mt-8">
                <button
                    onClick={handleNext}
                    className="w-full bg-rose-600 hover:bg-rose-700 text-white px-8 py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2"
                >
                    Continue
                    <CheckCircle className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
