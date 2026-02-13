/**
 * Step 5: Financial & Cooperative Details (Section E)
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

export default function FinancialStep({ data, updateData, onNext, onBack }: Props) {
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (data.hasBankAccount) {
            if (!data.bankName?.trim()) {
                newErrors.bankName = "Bank name is required";
            }
            if (!data.accountNumber?.trim() || data.accountNumber.length !== 10) {
                newErrors.accountNumber = "Valid 10-digit account number required";
            }
        }

        if (data.isMemberOfCooperative && !data.cooperativeName?.trim()) {
            newErrors.cooperativeName = "Cooperative name is required";
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
                Section E: Financial & Cooperative Details
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8">
                Provide your banking and cooperative membership information
            </p>

            <div className="space-y-6">
                {/* Do you have a bank account? */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Do you have a bank account? *
                    </label>
                    <div className="flex gap-4">
                        {[
                            { value: true, label: "Yes" },
                            { value: false, label: "No" },
                        ].map((option) => (
                            <label
                                key={option.label}
                                className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data.hasBankAccount === option.value
                                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="hasBankAccount"
                                    checked={data.hasBankAccount === option.value}
                                    onChange={() => updateData({ hasBankAccount: option.value })}
                                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="font-medium">{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* If YES, Bank Details */}
                {data.hasBankAccount && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-6 space-y-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Bank Name *
                            </label>
                            <input
                                type="text"
                                value={data.bankName}
                                onChange={(e) => updateData({ bankName: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                                placeholder="e.g., First Bank, GT Bank"
                            />
                            {errors.bankName && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.bankName}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Account Number *
                            </label>
                            <input
                                type="text"
                                value={data.accountNumber}
                                onChange={(e) => updateData({ accountNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                                maxLength={10}
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                                placeholder="10-digit account number"
                            />
                            {errors.accountNumber && (
                                <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors.accountNumber}
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                BVN (Optional but recommended)
                            </label>
                            <input
                                type="text"
                                value={data.bvn}
                                onChange={(e) => updateData({ bvn: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                                maxLength={11}
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                                placeholder="11-digit BVN (optional)"
                            />
                        </div>
                    </div>
                )}

                {/* Cooperative Membership */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Are you currently a member of any cooperative? *
                    </label>
                    <div className="flex gap-4">
                        {[
                            { value: true, label: "Yes" },
                            { value: false, label: "No" },
                        ].map((option) => (
                            <label
                                key={option.label}
                                className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data.isMemberOfCooperative === option.value
                                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="isMemberOfCooperative"
                                    checked={data.isMemberOfCooperative === option.value}
                                    onChange={() => updateData({ isMemberOfCooperative: option.value })}
                                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="font-medium">{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* If YES, Cooperative Name */}
                {data.isMemberOfCooperative && (
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                            If YES, Cooperative Name *
                        </label>
                        <input
                            type="text"
                            value={data.cooperativeName}
                            onChange={(e) => updateData({ cooperativeName: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 dark:bg-slate-700 dark:text-white"
                            placeholder="Name of your cooperative"
                        />
                        {errors.cooperativeName && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.cooperativeName}
                            </p>
                        )}
                    </div>
                )}

                {/* Willing to join EASY SALES cooperative */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Are you willing to join a EASY SALES-registered cooperative? *
                    </label>
                    <div className="flex gap-4">
                        {[
                            { value: true, label: "Yes" },
                            { value: false, label: "No" },
                        ].map((option) => (
                            <label
                                key={option.label}
                                className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data.willingToJoinCooperative === option.value
                                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                        : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="willingToJoinCooperative"
                                    checked={data.willingToJoinCooperative === option.value}
                                    onChange={() => updateData({ willingToJoinCooperative: option.value })}
                                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="font-medium">{option.label}</span>
                            </label>
                        ))}
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
                    className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-8 py-3 rounded-xl font-bold transition-all"
                >
                    Continue
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
