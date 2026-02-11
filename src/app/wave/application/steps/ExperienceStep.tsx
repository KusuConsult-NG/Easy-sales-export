/**
 * Step 2: Agricultural Experience
 * Assess farming background and business readiness
 */

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import type { WaveApplicationData } from "../page";

interface Props {
    data: WaveApplicationData;
    updateData: (data: Partial<WaveApplicationData>) => void;
    onNext: () => void;
    onBack: () => void;
}

const AGRICULTURAL_ACTIVITIES = [
    "Crop Production",
    "Livestock Farming",
    "Poultry Farming",
    "Fish Farming",
    "Agro-Processing",
    "Input Supply",
    "Farm Services",
    "Horticulture",
    "Mixed Farming",
    "Other",
];

const FARM_SIZES = [
    "Small (< 1 hectare)",
    "Medium (1-5 hectares)",
    "Large (> 5 hectares)",
    "Urban/Backyard",
];

const REVENUE_RANGES = [
    "Less than ₦50,000/month",
    "₦50,000 - ₦200,000/month",
    "₦200,000 - ₦500,000/month",
    "₦500,000 - ₦1,000,000/month",
    "Above ₦1,000,000/month",
];

export default function ExperienceStep({ data, updateData, onNext, onBack }: Props) {
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!data.agriculturalActivity) {
            newErrors.agriculturalActivity = "Please select your agricultural activity";
        }
        if (!data.yearsOfExperience || data.yearsOfExperience < 1) {
            newErrors.yearsOfExperience = "At least 1 year of experience is required";
        }
        if (!data.farmSize) {
            newErrors.farmSize = "Please select your farm size";
        }
        if (!data.monthlyRevenue) {
            newErrors.monthlyRevenue = "Please select your revenue range";
        }
        if (!data.currentChallenges.trim() || data.currentChallenges.length < 50) {
            newErrors.currentChallenges = "Please provide at least 50 characters describing your challenges";
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
                Agricultural Experience
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8">
                Tell us about your farming experience and current operations
            </p>

            <div className="space-y-6">
                {/* Agricultural Activity */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Current Agricultural Activity *
                    </label>
                    <select
                        value={data.agriculturalActivity}
                        onChange={(e) => updateData({ agriculturalActivity: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                    >
                        <option value="">Select activity</option>
                        {AGRICULTURAL_ACTIVITIES.map((activity) => (
                            <option key={activity} value={activity}>
                                {activity}
                            </option>
                        ))}
                    </select>
                    {errors.agriculturalActivity && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.agriculturalActivity}
                        </p>
                    )}
                </div>

                {/* Years of Experience & Farm Size */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            Years of Experience *
                        </label>
                        <input
                            type="number"
                            min="1"
                            value={data.yearsOfExperience || ""}
                            onChange={(e) => updateData({ yearsOfExperience: parseInt(e.target.value) || 0 })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                            placeholder="e.g., 5"
                        />
                        {errors.yearsOfExperience && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.yearsOfExperience}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            Farm Size/Scale *
                        </label>
                        <select
                            value={data.farmSize}
                            onChange={(e) => updateData({ farmSize: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                        >
                            <option value="">Select size</option>
                            {FARM_SIZES.map((size) => (
                                <option key={size} value={size}>
                                    {size}
                                </option>
                            ))}
                        </select>
                        {errors.farmSize && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.farmSize}
                            </p>
                        )}
                    </div>
                </div>

                {/* Monthly Revenue */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Monthly Revenue Range *
                    </label>
                    <select
                        value={data.monthlyRevenue}
                        onChange={(e) => updateData({ monthlyRevenue: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                    >
                        <option value="">Select revenue range</option>
                        {REVENUE_RANGES.map((range) => (
                            <option key={range} value={range}>
                                {range}
                            </option>
                        ))}
                    </select>
                    {errors.monthlyRevenue && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.monthlyRevenue}
                        </p>
                    )}
                </div>

                {/* Current Challenges */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Current Challenges * (Min 50 characters)
                    </label>
                    <textarea
                        value={data.currentChallenges}
                        onChange={(e) => updateData({ currentChallenges: e.target.value })}
                        rows={5}
                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white resize-none"
                        placeholder="Describe the main challenges you face in your agricultural business..."
                    />
                    <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-slate-500">
                            {data.currentChallenges.length} / 50+ characters
                        </span>
                        {errors.currentChallenges && (
                            <p className="text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.currentChallenges}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 gap-4">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 px-6 py-3 border border-slate-300 dark:border-slate-600 rounded-xl font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all text-slate-700 dark:text-slate-300"
                >
                    <ChevronLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={handleNext}
                    className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-700 text-white px-8 py-3 rounded-xl font-bold transition-all"
                >
                    Continue
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
