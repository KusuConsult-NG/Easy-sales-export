/**
 * Step 6: Training, Support & Commitment (Section F)
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

import { useToast } from "@/contexts/ToastContext";

export default function TrainingStep({ data, updateData, onNext, onBack }: Props) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (data.supportNeeded.length === 0) {
            newErrors.supportNeeded = "Please select at least one type of support";
        }
        if (!data.willingToUndergoTraining) {
            newErrors.willingToUndergoTraining = "You must be willing to undergo training to participate in WAVE";
        }
        if (!data.willingToComplyWithStandards) {
            newErrors.willingToComplyWithStandards = "You must be willing to comply with WAVE standards";
        }
        if (!data.willingToParticipateInME) {
            newErrors.willingToParticipateInME = "Participation in M&E is required";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (validateForm()) {
            onNext();
        } else {
            showToast("Please confirm your training and commitment", "error");
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    const toggleSupport = (support: "training" | "inputs" | "mechanization" | "finance" | "market_access") => {
        const current = data.supportNeeded || [];
        if (current.includes(support)) {
            updateData({ supportNeeded: current.filter((s) => s !== support) });
        } else {
            updateData({ supportNeeded: [...current, support] });
        }
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                Section F: Training, Support & Commitment
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8">
                Tell us what support you need and your commitment to the program
            </p>

            <div className="space-y-6">
                {/* Which support do you need */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                        Which support do you need from WAVE? *
                        <span className="text-xs font-normal text-slate-500 ml-1">(Select all that apply)</span>
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                            { value: "training" as const, label: "Training", icon: "📚" },
                            { value: "inputs" as const, label: "Inputs (Seeds, Fertilizer, Tools)", icon: "🌱" },
                            { value: "mechanization" as const, label: "Mechanization", icon: "�" },
                            { value: "finance" as const, label: "Finance / Grants", icon: "💰" },
                            { value: "market_access" as const, label: "Market Access / Off-take", icon: "🏪" },
                        ].map((support) => (
                            <label
                                key={support.value}
                                className={`flex items-center gap-2 px-4 py-3 border rounded-xl cursor-pointer transition-all ${data.supportNeeded.includes(support.value)
                                    ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                    : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={data.supportNeeded.includes(support.value)}
                                    onChange={() => toggleSupport(support.value)}
                                    className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                                />
                                <span className="text-lg">{support.icon}</span>
                                <span className="font-medium">{support.label}</span>
                            </label>
                        ))}
                    </div>
                    {errors.supportNeeded && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.supportNeeded}
                        </p>
                    )}
                </div>

                {/* Commitment Questions */}
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-6 space-y-6">
                    <h3 className="text-lg font-semibold text-emerald-900 dark:text-emerald-300 mb-4">
                        Program Commitment Requirements
                    </h3>

                    {/* Willing to undergo training */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Are you willing to undergo mandatory training? *
                        </label>
                        <div className="flex gap-4">
                            {[
                                { value: true, label: "Yes" },
                                { value: false, label: "No" },
                            ].map((option) => (
                                <label
                                    key={option.label}
                                    className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data.willingToUndergoTraining === option.value
                                        ? option.value
                                            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                            : "border-red-300 bg-red-50 text-red-700"
                                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="willingToUndergoTraining"
                                        checked={data.willingToUndergoTraining === option.value}
                                        onChange={() => updateData({ willingToUndergoTraining: option.value })}
                                        className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span className="font-medium">{option.label}</span>
                                </label>
                            ))}
                        </div>
                        {errors.willingToUndergoTraining && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.willingToUndergoTraining}
                            </p>
                        )}
                    </div>

                    {/* Comply with standards */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Are you willing to comply with WAVE production and quality standards? *
                        </label>
                        <div className="flex gap-4">
                            {[
                                { value: true, label: "Yes" },
                                { value: false, label: "No" },
                            ].map((option) => (
                                <label
                                    key={option.label}
                                    className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data.willingToComplyWithStandards === option.value
                                        ? option.value
                                            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                            : "border-red-300 bg-red-50 text-red-700"
                                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="willingToComplyWithStandards"
                                        checked={data.willingToComplyWithStandards === option.value}
                                        onChange={() => updateData({ willingToComplyWithStandards: option.value })}
                                        className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span className="font-medium">{option.label}</span>
                                </label>
                            ))}
                        </div>
                        {errors.willingToComplyWithStandards && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.willingToComplyWithStandards}
                            </p>
                        )}
                    </div>

                    {/* Participate in M&E */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Are you willing to participate in monitoring & evaluation (M&E)? *
                        </label>
                        <div className="flex gap-4">
                            {[
                                { value: true, label: "Yes" },
                                { value: false, label: "No" },
                            ].map((option) => (
                                <label
                                    key={option.label}
                                    className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data.willingToParticipateInME === option.value
                                        ? option.value
                                            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                            : "border-red-300 bg-red-50 text-red-700"
                                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="willingToParticipateInME"
                                        checked={data.willingToParticipateInME === option.value}
                                        onChange={() => updateData({ willingToParticipateInME: option.value })}
                                        className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span className="font-medium">{option.label}</span>
                                </label>
                            ))}
                        </div>
                        {errors.willingToParticipateInME && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.willingToParticipateInME}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 gap-4">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 px-6 py-3 border border-slate-300 dark:border-slate-600 rounded-xl font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all text-slate-900 dark:text-white"
                >
                    <ChevronLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={handleNext}
                    className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-3 rounded-xl font-bold transition-all"
                >
                    Continue to Review
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
