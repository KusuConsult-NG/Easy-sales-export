/**
 * Step 2: National Identity & Civic Status (Section B)
 * COMPULSORY for transparency, accountability, and eligibility validation
 */

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
//   #560 The form's shape lives with the form — see ReviewStep. `page` is now
//   the server half and exports only the page component.
import type { WaveApplicationData } from "../WaveApplicationClient";
import { IdInput } from "@/components/ui/IdInput";

interface Props {
    data: WaveApplicationData;
    updateData: (data: Partial<WaveApplicationData>) => void;
    onNext: () => void;
    onBack: () => void;
}

import { useToast } from "@/contexts/ToastContext";
import { getWards, getPollingUnits } from "@/lib/locations";
import { nationalIdField } from "@/lib/kyc-validators";

export default function CivicStatusStep({ data, updateData, onNext, onBack }: Props) {
    const { showToast } = useToast();
    const [errors, setErrors] = useState<Record<string, string>>({});

    /**
     *   #626 THIS RETURNED `true` UNCONDITIONALLY.
     *
     *        `setErrors({}); return true;` — a check that cannot fail. Every
     *        line below it was therefore unreachable: handleNext's `else`
     *        branch, its "Please correct the errors in the form" toast, and its
     *        scroll-to-the-first-error, none of which could ever run. The NIN
     *        input above is already wired with `error={errors.nin}`, so the
     *        field was built to show a message that nothing could produce.
     *
     *        THE SERVER DOES CHECK IT — #501 put `nationalIdField('NIN')` on
     *        the submit schema, so a bad NIN was never stored. What it cost was
     *        an applicant's time: type it wrong on step 2, fill in five more
     *        steps, and be refused at the end of a seven-step form.
     *
     *        #357 FOUND THIS EXACT SHAPE IN KYCForm — "this component imported
     *        isObviouslyFakeId and never called it" — and fixed it there. This
     *        is the same finding one door along, which is the pattern this audit
     *        keeps finding.
     *
     *   THE SAME RULE THE SERVER USES, not a second copy of it. Two
     *   hand-maintained copies of one contract is the other pattern this audit
     *   keeps finding, and the copy that drifts would be this one — the client
     *   would start accepting what the server refuses, which is how you get a
     *   form that submits and fails.
     *
     *   ONLY `nin` IS CHECKED, because it is the only field in Section B the
     *   schema constrains; the voter's card, ward, polling unit and year are all
     *   optional there. Validating them here would refuse applicants the server
     *   would have accepted, which is a worse defect than the one being fixed.
     *   And an EMPTY nin still passes, because the server's rule is optional.
     */
    const validateForm = (): boolean => {
        const next: Record<string, string> = {};

        const ninResult = nationalIdField('NIN').safeParse(data?.nin ?? "");
        if (!ninResult.success) {
            next.nin = ninResult.error.issues[0]?.message ?? "Please check your NIN.";
        }

        setErrors(next);
        return Object.keys(next).length === 0;
    };

    function handleNext() {
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
    }

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
                        <strong>NIN is optional</strong> but recommended for identity and eligibility verification. Voter&apos;s Card details are supported but not enforced. All data is securely encrypted.
                    </p>
                </div>
            </div>

            <div className="space-y-6">
                {/* NIN — Optional */}
                <div>
                    <IdInput
                        label="National Identification Number (NIN) 🔒"
                        value={data?.nin || ""}
                        onChange={(v) => {
                            updateData({ nin: v });
                        }}
                        maxLength={11}
                        placeholder="Enter your NIN"
                        error={errors.nin}
                        hint="Dial *346# on your registered phone to retrieve your NIN."
                        optional
                        accentColor="emerald"
                    />
                </div>

                {/* Voter's Card Number (PVC) */}
                <div>
{/*
                          *   #628 — see KYCForm. The cap was 19 and the example
                          *   beside it is twenty characters, so the field could not
                          *   accept its own placeholder. kyc-validators decided
                          *   against a ceiling on purpose; this input kept one.
                          */}
                    <IdInput
                        label="Voter's Card Number (PVC)"
                        value={data?.votersCardNumber || ""}
                        onChange={(v) => updateData({ votersCardNumber: v })}
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
                            value={data?.ward || ""}
                            onChange={(e) => updateData({ ward: e.target.value, pollingUnit: "" })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            disabled={!data?.lgaOfResidence}
                        >
                            <option value="">Select Ward</option>
                            {(data?.lgaOfResidence && getWards(data.lgaOfResidence).map((ward) => (
                                <option key={ward} value={ward}>{ward}</option>
                            ))) || []}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-2">
                            Polling Unit{" "}
                            <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                        </label>
                        <select
                            value={data?.pollingUnit || ""}
                            onChange={(e) => updateData({ pollingUnit: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                            disabled={!data?.ward}
                        >
                            <option value="">Select Polling Unit</option>
                            {(data?.ward && getPollingUnits(data.ward).map((pu) => (
                                <option key={pu} value={pu}>{pu}</option>
                            ))) || []}
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
                        value={data?.yearOfVoterRegistration || ""}
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
                                className={`flex items-center gap-2 px-6 py-3 border rounded-xl cursor-pointer transition-all ${data?.votedInLastElection === option.value
                                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                    : "border-slate-300 hover:bg-slate-50"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="votedInLastElection"
                                    checked={data?.votedInLastElection === option.value}
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
