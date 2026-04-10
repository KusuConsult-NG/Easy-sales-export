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

        // Bank account is always required
        if (!data.bankName?.trim()) {
            newErrors.bankName = "Bank name is required";
        }
        if (!data.accountNumber?.trim() || data.accountNumber.length !== 10) {
            newErrors.accountNumber = "Valid 10-digit account number required";
        }

        // BVN is REQUIRED on WAVE and must be API-verified
        if (!data.bvn || data.bvn.length !== 11) {
            newErrors.bvn = "BVN is required — enter your 11-digit Bank Verification Number";
        } else if (!bvnVerified) {
            newErrors.bvn = "Please click 'Verify' to validate your BVN before continuing";
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
            <p className="text-slate-600 mb-4">
                Provide your banking and cooperative membership information
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8">
                <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-700">
                        <strong>Bank account details and BVN are required</strong> for financial verification and programme disbursement. Your data is securely encrypted.
                    </p>
                </div>
            </div>

            <div className="space-y-6">
                {/* Bank Details — Always Required */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 space-y-6">
                    <h3 className="text-base font-bold text-slate-900">Bank Account Details <span className="text-red-500">*</span></h3>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Bank Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={data.bankName}
                            onChange={(e) => updateData({ bankName: e.target.value })}
                            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            placeholder="e.g., First Bank, GT Bank, Access Bank"
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
                            Account Number <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={data.accountNumber}
                            onChange={(e) => updateData({ accountNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                            maxLength={10}
                            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            placeholder="10-digit account number"
                        />
                        {errors.accountNumber && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.accountNumber}
                            </p>
                        )}
                    </div>

                    {/* BVN — REQUIRED on WAVE (collected, not API-verified) */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Bank Verification Number (BVN) <span className="text-red-500">*</span>
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
                                    disabled={bvnVerified || verifyingBvn}
                                    maxLength={11}
                                    className={`w-full px-3.5 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 ${errors.bvn ? 'border-red-400' : 'border-slate-300'}`}
                                    placeholder="11-digit BVN"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleVerifyBvn}
                                disabled={bvnVerified || verifyingBvn || data.bvn?.length !== 11}
                                className="px-6 py-3 bg-emerald-100 text-emerald-800 font-semibold rounded-lg hover:bg-emerald-200 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {verifyingBvn ? <Loader2 className="w-5 h-5 animate-spin" /> : "Verify"}
                            </button>
                        </div>
                        {errors.bvn && !bvnError && (
                            <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.bvn}
                            </p>
                        )}
                        {bvnError && (
                            <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {bvnError}
                            </p>
                        )}
                        {bvnVerified && (
                            <div className="mt-2 flex items-center justify-between">
                                <p className="text-sm text-emerald-600 flex items-center gap-1 font-medium">
                                    <CheckCircle className="w-4 h-4" />
                                    BVN verified successfully
                                </p>
                                <button
                                    type="button"
                                    onClick={() => { setBvnVerified(false); setBvnError(""); updateData({ bvn: "" }); }}
                                    className="text-xs text-slate-500 underline hover:text-slate-700 ml-2"
                                >
                                    Wrong BVN? Edit
                                </button>
                            </div>
                        )}
                        <p className="mt-1 text-xs text-slate-500">Dial *565*0# on your registered phone to retrieve your BVN.</p>
                    </div>
                </div>

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
                                className={`flex items-center gap-2 px-6 py-3 border rounded-lg cursor-pointer transition-all ${data.isMemberOfCooperative === option.value
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
                            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
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
                                className={`flex items-center gap-2 px-6 py-3 border rounded-lg cursor-pointer transition-all ${data.willingToJoinCooperative === option.value
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
