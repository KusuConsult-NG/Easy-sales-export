/**
 * Step 5: Financial & Cooperative Details (Section E)
 */

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, AlertCircle, Loader2, CheckCircle } from "lucide-react";
import type { WaveApplicationData } from "../page";

interface Props {
    data: WaveApplicationData;
    updateData: (data: Partial<WaveApplicationData>) => void;
    onNext: () => void;
    onBack: () => void;
}

import { useToast } from "@/contexts/ToastContext";

export default function FinancialStep({ data, updateData, onNext, onBack }: Props) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [verifyingBvn, setVerifyingBvn] = useState(false);
    const [bvnVerified, setBvnVerified] = useState(false);
    const [bvnError, setBvnError] = useState("");

    const handleVerifyBvn = async () => {
        if (!data.bvn || data.bvn.length !== 11) {
            setBvnError("Please enter a valid 11-digit BVN");
            return;
        }

        if (!data.firstName || !data.surname) {
            setBvnError("First name and surname required in Personal Details step to verify.");
            return;
        }

        setVerifyingBvn(true);
        setBvnError("");

        try {
            const response = await fetch('/api/kyc/verify-bvn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bvn: data.bvn,
                    firstName: data.firstName,
                    lastName: data.surname
                })
            });

            const result = await response.json();

            if (result.success && result.isMatch) {
                setBvnVerified(true);
                setBvnError("");
                showToast("BVN Verified Successfully!", "success");
            } else {
                setBvnVerified(false);
                setBvnError(result.error || result.details || "Verification failed");
            }
        } catch (error) {
            setBvnError("An unexpected error occurred during verification");
        } finally {
            setVerifyingBvn(false);
        }
    };

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

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Section E: Financial & Cooperative Details
            </h2>
            <p className="text-slate-600 mb-8">
                Provide your banking and cooperative membership information
            </p>

            <div className="space-y-6">
                {/* Do you have a bank account? */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
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
                                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                    : "border-slate-300 hover:bg-slate-50"
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
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Bank Name *
                            </label>
                            <input
                                type="text"
                                value={data.bankName}
                                onChange={(e) => updateData({ bankName: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
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
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Account Number *
                            </label>
                            <input
                                type="text"
                                value={data.accountNumber}
                                onChange={(e) => updateData({ accountNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                                maxLength={10}
                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
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
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                BVN (Optional but recommended)
                            </label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        value={data.bvn}
                                        onChange={(e) => {
                                            updateData({ bvn: e.target.value.replace(/\D/g, "").slice(0, 11) });
                                            setBvnVerified(false);
                                            setBvnError("");
                                        }}
                                        disabled={bvnVerified}
                                        maxLength={11}
                                        className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 disabled:bg-slate-100 disabled:text-slate-500 ${bvnVerified ? "border-emerald-500 bg-emerald-50" : "border-slate-300"}`}
                                        placeholder="11-digit BVN (optional)"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleVerifyBvn}
                                    disabled={!data.bvn || data.bvn.length !== 11 || verifyingBvn || bvnVerified}
                                    className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap font-medium flex items-center gap-2 justify-center min-w-[120px]"
                                >
                                    {verifyingBvn ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> Verifying</>
                                    ) : bvnVerified ? (
                                        <><CheckCircle className="w-4 h-4 text-emerald-600" /> Verified</>
                                    ) : (
                                        "Verify"
                                    )}
                                </button>
                            </div>
                            {bvnError && (
                                <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                                    <AlertCircle className="w-4 h-4" />
                                    {bvnError}
                                </p>
                            )}
                            {bvnVerified && (
                                <p className="mt-2 text-sm text-emerald-600 flex items-center gap-1 font-medium">
                                    <CheckCircle className="w-4 h-4" />
                                    BVN matches profile records
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Cooperative Membership */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
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
                                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                    : "border-slate-300 hover:bg-slate-50"
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
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            If YES, Cooperative Name *
                        </label>
                        <input
                            type="text"
                            value={data.cooperativeName}
                            onChange={(e) => updateData({ cooperativeName: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
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
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
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
                                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                    : "border-slate-300 hover:bg-slate-50"
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
                    className="flex items-center gap-2 px-6 py-3 border border-slate-300 rounded-xl font-semibold hover:bg-slate-50 transition-all text-slate-900"
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
