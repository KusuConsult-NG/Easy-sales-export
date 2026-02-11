/**
 * Step 3: Business Proposal
 * Detailed business plan and funding requirements
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

export default function ProposalStep({ data, updateData, onNext, onBack }: Props) {
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!data.businessName.trim()) {
            newErrors.businessName = "Business name is required";
        }
        if (!data.businessDescription.trim() || data.businessDescription.length < 200) {
            newErrors.businessDescription = "Business description must be at least 200 characters";
        }
        if (data.businessDescription.length > 1000) {
            newErrors.businessDescription = "Business description must not exceed 1000 characters";
        }
        if (!data.targetMarket.trim()) {
            newErrors.targetMarket = "Target market is required";
        }
        if (!data.fundingNeeded || data.fundingNeeded < 50000 || data.fundingNeeded > 2000000) {
            newErrors.fundingNeeded = "Funding must be between ₦50,000 and ₦2,000,000";
        }
        if (!data.shortTermGoals.trim()) {
            newErrors.shortTermGoals = "Short-term goals are required";
        }
        if (!data.mediumTermGoals.trim()) {
            newErrors.mediumTermGoals = "Medium-term goals are required";
        }
        if (!data.longTermGoals.trim()) {
            newErrors.longTermGoals = "Long-term goals are required";
        }
        if (!data.expectedImpact.trim()) {
            newErrors.expectedImpact = "Expected impact is required";
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
                Business Proposal
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8">
                Share your business idea and how WAVE funding will help you grow
            </p>

            <div className="space-y-6">
                {/* Business Name */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Business Name/Idea *
                    </label>
                    <input
                        type="text"
                        value={data.businessName}
                        onChange={(e) => updateData({ businessName: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                        placeholder="e.g., Green Valley Tomato Farm"
                    />
                    {errors.businessName && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.businessName}
                        </p>
                    )}
                </div>

                {/* Business Description */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Business Description * (200-1000 characters)
                    </label>
                    <textarea
                        value={data.businessDescription}
                        onChange={(e) => updateData({ businessDescription: e.target.value })}
                        rows={6}
                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white resize-none"
                        placeholder="Describe your agricultural business idea, what you plan to do, and how it addresses market needs..."
                    />
                    <div className="flex items-center justify-between mt-1">
                        <span className={`text-xs ${data.businessDescription.length < 200
                                ? "text-slate-500"
                                : data.businessDescription.length > 1000
                                    ? "text-red-600"
                                    : "text-green-600"
                            }`}>
                            {data.businessDescription.length} / 200-1000 characters
                        </span>
                        {errors.businessDescription && (
                            <p className="text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.businessDescription}
                            </p>
                        )}
                    </div>
                </div>

                {/* Target Market & Funding */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            Target Market *
                        </label>
                        <input
                            type="text"
                            value={data.targetMarket}
                            onChange={(e) => updateData({ targetMarket: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                            placeholder="e.g., Local retailers, Restaurants"
                        />
                        {errors.targetMarket && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.targetMarket}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            Funding Needed * (₦50K - ₦2M)
                        </label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                                ₦
                            </span>
                            <input
                                type="number"
                                min="50000"
                                max="2000000"
                                step="10000"
                                value={data.fundingNeeded || ""}
                                onChange={(e) => updateData({ fundingNeeded: parseInt(e.target.value) || 0 })}
                                className="w-full pl-8 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                                placeholder="500000"
                            />
                        </div>
                        {errors.fundingNeeded && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.fundingNeeded}
                            </p>
                        )}
                    </div>
                </div>

                {/* Business Goals */}
                <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
                        Business Goals
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Short-Term Goals (0-6 months) *
                            </label>
                            <input
                                type="text"
                                value={data.shortTermGoals}
                                onChange={(e) => updateData({ shortTermGoals: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                                placeholder="e.g., Acquire equipment and start production"
                            />
                            {errors.shortTermGoals && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.shortTermGoals}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Medium-Term Goals (6-12 months) *
                            </label>
                            <input
                                type="text"
                                value={data.mediumTermGoals}
                                onChange={(e) => updateData({ mediumTermGoals: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                                placeholder="e.g., Establish market presence and distribution"
                            />
                            {errors.mediumTermGoals && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.mediumTermGoals}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Long-Term Goals (1-2 years) *
                            </label>
                            <input
                                type="text"
                                value={data.longTermGoals}
                                onChange={(e) => updateData({ longTermGoals: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                                placeholder="e.g., Scale operations and achieve profitability"
                            />
                            {errors.longTermGoals && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.longTermGoals}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Expected Impact */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Expected Impact *
                    </label>
                    <textarea
                        value={data.expectedImpact}
                        onChange={(e) => updateData({ expectedImpact: e.target.value })}
                        rows={4}
                        className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white resize-none"
                        placeholder="How will your business impact your community, create jobs, or contribute to food security?"
                    />
                    {errors.expectedImpact && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.expectedImpact}
                        </p>
                    )}
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
