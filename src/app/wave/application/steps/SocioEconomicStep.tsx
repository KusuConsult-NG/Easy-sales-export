/**
 * Step 3: Socio-Economic Profile (Section C)
 */

" use client";

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

export default function SocioEconomicStep({ data, updateData, onNext, onBack }: Props) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!data.highestEducation) {
            newErrors.highestEducation = "Please select your education level";
        }
        if (!data.currentOccupation.trim()) {
            newErrors.currentOccupation = "Current occupation is required";
        }
        if (!data.averageMonthlyIncome) {
            newErrors.averageMonthlyIncome = "Please select your income range";
        }
        if (data.involvedInAgriculture && data.agricultureTypes.length === 0) {
            newErrors.agricultureTypes = "Please select at least one agricultural activity";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (validateForm()) {
            onNext();
        } else {
            showToast("Please correct the errors in the form", "error");
            setTimeout(() => {
                const firstError = document.querySelector('.text-red-600');
                if (firstError) {
                    firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                }
            }, 100);
        }
    };

    const toggleAgricultureType = (type: "farming" | "processing" | "trading" | "export" | "logistics") => {
        const current = data.agricultureTypes || [];
        if (current.includes(type)) {
            updateData({ agricultureTypes: current.filter((t) => t !== type) });
        } else {
            updateData({ agricultureTypes: [...current, type] });
        }
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Section C: Socio-Economic Profile
            </h2>
            <p className="text-slate-600 mb-8">
                Help us understand your educational background and economic situation
            </p>

            <div className="max-w-xl mx-auto space-y-4">
                {/* Highest Level of Education */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Highest Level of Education *
                    </label>
                    <select
                        value={data.highestEducation}
                        onChange={(e) => updateData({ highestEducation: e.target.value as "none" | "primary" | "secondary" | "tertiary" | "vocational" })}
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                    >
                        <option value="">Select education level</option>
                        <option value="none">No Formal Education</option>
                        <option value="primary">Primary</option>
                        <option value="secondary">Secondary</option>
                        <option value="tertiary">Tertiary</option>
                        <option value="vocational">Vocational / Technical</option>
                    </select>
                    {errors.highestEducation && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.highestEducation}
                        </p>
                    )}
                </div>

                {/* Current Occupation */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Current Occupation *
                    </label>
                    <input
                        type="text"
                        value={data.currentOccupation}
                        onChange={(e) => updateData({ currentOccupation: e.target.value })}
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                        placeholder="e.g., Farmer, Trader, Processor"
                    />
                    {errors.currentOccupation && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.currentOccupation}
                        </p>
                    )}
                </div>

                {/* Average Monthly Income */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Average Monthly Income *
                    </label>
                    <select
                        value={data.averageMonthlyIncome}
                        onChange={(e) => updateData({ averageMonthlyIncome: e.target.value as "below_50k" | "50k_100k" | "100k_250k" | "above_250k" })}
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                    >
                        <option value="">Select income range</option>
                        <option value="below_50k">Below ₦50,000</option>
                        <option value="50k_100k">₦50,000 – ₦100,000</option>
                        <option value="100k_250k">₦100,000 – ₦250,000</option>
                        <option value="above_250k">Above ₦250,000</option>
                    </select>
                    {errors.averageMonthlyIncome && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.averageMonthlyIncome}
                        </p>
                    )}
                </div>

                {/* Currently Involved in Agriculture */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Are you currently involved in any agricultural activity? *
                    </label>
                    <div className="flex gap-4">
                        {[
                            { value: true, label: "Yes" },
                            { value: false, label: "No" },
                        ].map((option) => (
                            <label
                                key={option.label}
                                className={`flex items-center gap-2 px-6 py-3 border rounded-lg cursor-pointer transition-all ${data.involvedInAgriculture === option.value
                                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                    : "border-slate-300 hover:bg-slate-50"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="involvedInAgriculture"
                                    checked={data.involvedInAgriculture === option.value}
                                    onChange={() => updateData({ involvedInAgriculture: option.value })}
                                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="font-medium">{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* If YES, specify the type */}
                {data.involvedInAgriculture && (
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            If YES, specify the type (Select all that apply) *
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[
                                { value: "farming" as const, label: "Farming", icon: "🌾" },
                                { value: "processing" as const, label: "Processing", icon: "⚙️" },
                                { value: "trading" as const, label: "Trading", icon: "🛒" },
                                { value: "export" as const, label: "Export", icon: "✈️" },
                                { value: "logistics" as const, label: "Logistics", icon: "🚚" },
                            ].map((type) => (
                                <label
                                    key={type.value}
                                    className={`flex items-center gap-2 px-3.5 py-2.5 border rounded-lg text-sm cursor-pointer transition-all ${data.agricultureTypes.includes(type.value)
                                        ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                        : "border-slate-300 hover:bg-slate-50"
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={data.agricultureTypes.includes(type.value)}
                                        onChange={() => toggleAgricultureType(type.value)}
                                        className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                                    />
                                    <span className="text-lg">{type.icon}</span>
                                    <span className="font-medium">{type.label}</span>
                                </label>
                            ))}
                        </div>
                        {errors.agricultureTypes && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.agricultureTypes}
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 gap-4">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 px-6 py-3 border border-slate-300 rounded-lg font-semibold hover:bg-slate-50 transition-all text-slate-900"
                >
                    <ChevronLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={handleNext}
                    className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-3 rounded-lg font-bold transition-all"
                >
                    Continue
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
