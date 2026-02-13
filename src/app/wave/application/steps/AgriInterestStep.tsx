/**
 * Step 4: Agricultural Interest & Value Chain Selection (Section D)
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

export default function AgriInterestStep({ data, updateData, onNext, onBack }: Props) {
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (data.valueChainAreas.length === 0) {
            newErrors.valueChainAreas = "Please select at least one value chain area";
        }
        if (data.preferredCommodities.length === 0) {
            newErrors.preferredCommodities = "Please select at least one commodity";
        }
        if (data.preferredCommodities.includes("other") && !data.preferredCommodityOther.trim()) {
            newErrors.preferredCommodityOther = "Please specify the commodity";
        }
        if (data.hasAccessToFarmland && (!data.farmlandHectares || data.farmlandHectares <= 0)) {
            newErrors.farmlandHectares = "Please specify farmland size";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (validateForm()) {
            onNext();
        }
    };

    const toggleValueChain = (area: "crop_production" | "livestock" | "processing_packaging" | "aggregation_trading" | "export_market") => {
        const current = data.valueChainAreas || [];
        if (current.includes(area)) {
            updateData({ valueChainAreas: current.filter((a) => a !== area) });
        } else {
            updateData({ valueChainAreas: [...current, area] });
        }
    };

    const toggleCommodity = (commodity: "rice" | "maize" | "sesame" | "soybeans" | "ginger" | "cassava" | "vegetables" | "other") => {
        const current = data.preferredCommodities || [];
        if (current.includes(commodity)) {
            updateData({ preferredCommodities: current.filter((c) => c !== commodity) });
        } else {
            updateData({ preferredCommodities: [...current, commodity] });
        }
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                Section D: Agricultural Interest & Value Chain Selection
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8">
                Tell us about your interests in the agricultural value chain
            </p>

            <div className="space-y-6">
                {/* Value Chain Areas */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Which area would you like to participate in under WAVE? *
                        <span className="text-xs font-normal text-slate-500 ml-1">(Select all that apply)</span>
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                            { value: "crop_production" as const, label: "Crop Production", icon: "🌱" },
                            { value: "livestock" as const, label: "Livestock", icon: "🐄" },
                            { value: "processing_packaging" as const, label: "Processing & Packaging", icon: "📦" },
                            { value: "aggregation_trading" as const, label: "Aggregation & Trading", icon: "🏪" },
                            { value: "export_market" as const, label: "Export & Market Access", icon: "🌍" },
                        ].map((area) => (
                            <label
                                key={area.value}
                                className={`flex items-center gap-2 px-4 py-3 border rounded-xl cursor-pointer transition-all ${data.valueChainAreas.includes(area.value)
                                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={data.valueChainAreas.includes(area.value)}
                                    onChange={() => toggleValueChain(area.value)}
                                    className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                                />
                                <span className="text-lg">{area.icon}</span>
                                <span className="font-medium">{area.label}</span>
                            </label>
                        ))}
                    </div>
                    {errors.valueChainAreas && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.valueChainAreas}
                        </p>
                    )}
                </div>

                {/* Preferred Commodities */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Preferred Crop / Commodity *
                        <span className="text-xs font-normal text-slate-500 ml-1">(Select all that apply)</span>
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                            { value: "rice" as const, label: "Rice" },
                            { value: "maize" as const, label: "Maize" },
                            { value: "sesame" as const, label: "Sesame" },
                            { value: "soybeans" as const, label: "Soybeans" },
                            { value: "ginger" as const, label: "Ginger" },
                            { value: "cassava" as const, label: "Cassava" },
                            { value: "vegetables" as const, label: "Vegetables" },
                            { value: "other" as const, label: "Others" },
                        ].map((commodity) => (
                            <label
                                key={commodity.value}
                                className={`flex items-center gap-2 px-4 py-3 border rounded-xl cursor-pointer transition-all ${data.preferredCommodities.includes(commodity.value)
                                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={data.preferredCommodities.includes(commodity.value)}
                                    onChange={() => toggleCommodity(commodity.value)}
                                    className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                                />
                                <span className="font-medium">{commodity.label}</span>
                            </label>
                        ))}
                    </div>
                    {errors.preferredCommodities && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.preferredCommodities}
                        </p>
                    )}
                </div>

                {/* If Others specified */}
                {data.preferredCommodities.includes("other") && (
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            Please specify *
                        </label>
                        <input
                            type="text"
                            value={data.preferredCommodityOther}
                            onChange={(e) => updateData({ preferredCommodityOther: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                            placeholder="Specify other commodity"
                        />
                        {errors.preferredCommodityOther && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.preferredCommodityOther}
                            </p>
                        )}
                    </div>
                )}

                {/* Farmland Access */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Do you currently have access to farmland? *
                    </label>
                    <div className="flex gap-4">
                        {[
                            { value: true, label: "Yes" },
                            { value: false, label: "No" },
                        ].map((option) => (
                            <label
                                key={option.label}
                                className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data.hasAccessToFarmland === option.value
                                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="hasAccessToFarmland"
                                    checked={data.hasAccessToFarmland === option.value}
                                    onChange={() => updateData({ hasAccessToFarmland: option.value })}
                                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="font-medium">{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* If YES, hectares */}
                {data.hasAccessToFarmland && (
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            If YES, how many hectares? *
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={data.farmlandHectares || ""}
                            onChange={(e) => updateData({ farmlandHectares: parseFloat(e.target.value) || 0 })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                            placeholder="e.g., 2.5"
                        />
                        {errors.farmlandHectares && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.farmlandHectares}
                            </p>
                        )}
                    </div>
                )}

                {/* If NO, would you like WAVE to provide */}
                {!data.hasAccessToFarmland && (
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            If NO, would you like WAVE to provide farmland access? *
                        </label>
                        <div className="flex gap-4">
                            {[
                                { value: true, label: "Yes" },
                                { value: false, label: "No" },
                            ].map((option) => (
                                <label
                                    key={option.label}
                                    className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data.needsFarmlandAccess === option.value
                                            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                            : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="needsFarmlandAccess"
                                        checked={data.needsFarmlandAccess === option.value}
                                        onChange={() => updateData({ needsFarmlandAccess: option.value })}
                                        className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span className="font-medium">{option.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}
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
                    className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-3 rounded-xl font-bold transition-all"
                >
                    Continue
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
