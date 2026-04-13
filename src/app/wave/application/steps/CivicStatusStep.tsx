/**
 * Step 2: National Identity & Civic Status (Section B)
 * COMPULSORY for transparency, accountability, and eligibility validation
 */

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, AlertCircle, ShieldCheck, Loader2 } from "lucide-react";
import type { WaveApplicationData } from "../page";
import { IdInput } from "@/components/ui/IdInput";

interface Props {
    data: WaveApplicationData;
    updateData: (data: Partial<WaveApplicationData>) => void;
    onNext: () => void;
    onBack: () => void;
}

import { useToast } from "@/contexts/ToastContext";
import { getWards, getPollingUnits } from "@/lib/locations";

export default function CivicStatusStep({ data, updateData, onNext, onBack }: Props) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [verifyingNin, setVerifyingNin] = useState(false);
    const [ninVerified, setNinVerified] = useState(false);
    const [ninError, setNinError] = useState("");

    const handleVerifyNin = async () => {
        if (!data.nin || data.nin.length !== 11) {
            setNinError("Please enter a valid 11-digit NIN");
            return;
        }

        if (!data.firstName || !data.surname) {
            setNinError("First name and surname required in Personal Details step to verify.");
            return;
        }

        setVerifyingNin(true);
        setNinError("");

        try {
            const { verifyNINAction } = await import('@/app/actions/kyc');
            const result = await verifyNINAction({ nin: data.nin, firstName: data.firstName, lastName: data.surname });

            if (result.success && 'isMatch' in result && result.isMatch) {
                setNinVerified(true);
                setNinError("");
                showToast("NIN Verified Successfully!", "success");
            } else {
                setNinVerified(false);
                setNinError('error' in result ? (result.error as string) : ('details' in result ? String(result.details) : "Verification failed"));
            }
        } catch (error) {
            setNinError("An unexpected error occurred during verification");
        } finally {
            setVerifyingNin(false);
        }
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        // NIN — required and must be API-verified
        if (!data.nin || data.nin.trim().length !== 11) {
            newErrors.nin = "NIN is required — enter your 11-digit National Identification Number";
        } else if (!ninVerified) {
            newErrors.nin = "Please click 'Verify' to validate your NIN before continuing";
        }

        // Voter's Card Number — no longer enforced

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
                Section B: National Identity & Civic Status 🗳️
            </h2>
            <p className="text-slate-600 mb-2">
                This section is compulsory for transparency, accountability, and eligibility validation.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
                <div className="flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-700">
                        <strong>NIN is required</strong> for identity and eligibility verification. Voter&apos;s Card details are supported but not enforced. All data is securely encrypted.
                    </p>
                </div>
            </div>

            <div className="space-y-6">
                {/* NIN — REQUIRED and API-Verified */}
                <div>
                    <IdInput
                        label="National Identification Number (NIN) 🔒"
                        value={data.nin}
                        onChange={(v) => {
                            updateData({ nin: v });
                            setNinVerified(false);
                            setNinError("");
                        }}
                        digitsOnly
                        showCount
                        maxLength={11}
                        placeholder="Enter your 11-digit NIN"
                        disabled={ninVerified || verifyingNin}
                        error={errors.nin || ninError}
                        hint="Dial *346# on your registered phone to retrieve your NIN."
                        required
                        accentColor="emerald"
                        suffix={
                            <button
                                type="button"
                                onClick={handleVerifyNin}
                                disabled={ninVerified || verifyingNin || data.nin?.length !== 11}
                                className="px-5 py-2.5 text-sm bg-emerald-100 text-emerald-800 font-semibold rounded-lg hover:bg-emerald-200 transition-colors disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                            >
                                {verifyingNin ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
                            </button>
                        }
                    />
                    {ninVerified && (
                        <div className="mt-2 flex items-center justify-between">
                            <p className="text-sm text-emerald-600 flex items-center gap-1 font-medium">
                                <ShieldCheck className="w-4 h-4" />
                                NIN verified successfully
                            </p>
                            <button
                                type="button"
                                onClick={() => { setNinVerified(false); setNinError(""); updateData({ nin: "" }); }}
                                className="text-xs text-slate-500 underline hover:text-slate-700 ml-2"
                            >
                                Wrong NIN? Edit
                            </button>
                        </div>
                    )}
                </div>

                {/* Voter's Card Number (PVC) */}
                <div>
                    <IdInput
                        label="Voter's Card Number (PVC)"
                        value={data.votersCardNumber}
                        onChange={(v) => updateData({ votersCardNumber: v })}
                        maxLength={19}
                        showCount
                        placeholder="e.g. 90F5B123456789012345"
                        hint="Enter the Voter Identification Number (VIN) as printed on your Permanent Voter Card."
                        accentColor="emerald"
                    />
                </div>

                {/* Ward & Polling Unit — Optional */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Ward (based on Residence){" "}
                            <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                        </label>
                        <select
                            value={data.ward}
                            onChange={(e) => updateData({ ward: e.target.value, pollingUnit: "" })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            disabled={!data.lgaOfResidence}
                        >
                            <option value="">Select Ward</option>
                            {data.lgaOfResidence && getWards(data.lgaOfResidence).map((ward) => (
                                <option key={ward} value={ward}>{ward}</option>
                            )) || []}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Polling Unit{" "}
                            <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                        </label>
                        <select
                            value={data.pollingUnit}
                            onChange={(e) => updateData({ pollingUnit: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            disabled={!data.ward}
                        >
                            <option value="">Select Polling Unit</option>
                            {data.ward && getPollingUnits(data.ward).map((pu) => (
                                <option key={pu} value={pu}>{pu}</option>
                            )) || []}
                        </select>
                    </div>
                </div>

                {/* Year of Voter Registration — Optional */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Year of Voter Registration{" "}
                        <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                    </label>
                    <input
                        type="text"
                        value={data.yearOfVoterRegistration}
                        onChange={(e) => updateData({ yearOfVoterRegistration: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                        maxLength={4}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                        placeholder="e.g., 2023"
                    />
                </div>

                {/* Voted in Last Election */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Did you vote in the last general election?{" "}
                        <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                    </label>
                    <div className="flex gap-4">
                        {[
                            { value: true, label: "Yes" },
                            { value: false, label: "No" },
                        ].map((option) => (
                            <label
                                key={option.label}
                                className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data.votedInLastElection === option.value
                                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                    : "border-slate-300 hover:bg-slate-50"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="votedInLastElection"
                                    checked={data.votedInLastElection === option.value}
                                    onChange={() => updateData({ votedInLastElection: option.value })}
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
