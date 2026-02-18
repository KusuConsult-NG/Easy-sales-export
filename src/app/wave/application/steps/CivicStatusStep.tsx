/**
 * Step 2: National Identity & Civic Status (Section B)
 * COMPULSORY for transparency, accountability, and eligibility validation
 */

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, AlertCircle, ShieldCheck } from "lucide-react";
import type { WaveApplicationData } from "../page";

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

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!data.nin.trim() || data.nin.length !== 11) {
            newErrors.nin = "Valid 11-digit NIN is required";
        }
        if (!data.votersCardNumber.trim()) {
            newErrors.votersCardNumber = "Voter's card number is required";
        }
        if (!data.pollingUnit.trim()) {
            newErrors.pollingUnit = "Polling unit is required";
        }
        if (!data.ward.trim()) {
            newErrors.ward = "Ward is required";
        }
        if (!data.yearOfVoterRegistration.trim()) {
            newErrors.yearOfVoterRegistration = "Year of voter registration is required";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (validateForm()) {
            onNext();
        } else {
            showToast("Please provide all required civic information", "error");
            window.scrollTo({ top: 0, behavior: "smooth" });
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
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-8">
                <div className="flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                    <p className="text-sm text-emerald-700">
                        Your NIN and PVC details are securely encrypted and used only for program verification and accountability purposes.
                    </p>
                </div>
            </div>

            <div className="space-y-6">
                {/* National Identification Number (NIN) */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        National Identification Number (NIN) 🔒 *
                    </label>
                    <input
                        type="text"
                        value={data.nin}
                        onChange={(e) => updateData({ nin: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                        maxLength={11}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                        placeholder="Enter your 11-digit NIN"
                    />
                    {errors.nin && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.nin}
                        </p>
                    )}
                </div>

                {/* Voter's Card Number (PVC) */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Voter's Card Number (PVC) *
                    </label>
                    <input
                        type="text"
                        value={data.votersCardNumber}
                        onChange={(e) => updateData({ votersCardNumber: e.target.value.toUpperCase() })}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                        placeholder="e.g., 90F5B123456789012345"
                    />
                    {errors.votersCardNumber && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.votersCardNumber}
                        </p>
                    )}
                </div>

                {/* Polling Unit & Ward */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Polling Unit *
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
                        {errors.pollingUnit && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.pollingUnit}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Ward (based on Residence) *
                        </label>
                        <select
                            value={data.ward}
                            onChange={(e) => updateData({ ward: e.target.value, pollingUnit: "" })} // Reset PU when ward changes
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            disabled={!data.lgaOfResidence}
                        >
                            <option value="">Select Ward</option>
                            {data.lgaOfResidence && getWards(data.lgaOfResidence).map((ward) => (
                                <option key={ward} value={ward}>{ward}</option>
                            )) || []}
                        </select>
                        {errors.ward && (
                            <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-4 h-4" />
                                {errors.ward}
                            </p>
                        )}
                    </div>
                </div>

                {/* Year of Voter Registration */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Year of Voter Registration *
                    </label>
                    <input
                        type="text"
                        value={data.yearOfVoterRegistration}
                        onChange={(e) => updateData({ yearOfVoterRegistration: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                        maxLength={4}
                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                        placeholder="e.g., 2023"
                    />
                    {errors.yearOfVoterRegistration && (
                        <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {errors.yearOfVoterRegistration}
                        </p>
                    )}
                </div>

                {/* Voted in Last Election */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Did you vote in the last general election? *
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
