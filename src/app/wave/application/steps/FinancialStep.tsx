/**
 * Step 5: Financial & Cooperative Details (Section E)
 */

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, AlertCircle, Loader2, CheckCircle } from "lucide-react";
//   #560 The form's shape lives with the form — see ReviewStep. `page` is now
//   the server half and exports only the page component.
import type { WaveApplicationData } from "../WaveApplicationClient";
//   #774 The submit schema's own rule, imported rather than restated here.
import { requiredNationalIdField } from "@/lib/kyc-validators";

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
    //   #522. Whether an automated check actually ran. Always false today.
    const [bvnChecked, setBvnChecked] = useState(false);

    async function handleVerifyBvn() {
        if (!data.bvn) {
            setBvnError("Please enter a BVN");
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
                setBvnChecked(result.checked === true);
                setBvnError("");
                /**
                 *   #522 THIS SAID "Verified Successfully" FOR AN UNCHECKED ID.
                 *
                 *   #485 established that no automated check exists on this
                 *   platform, changed the route to answer `checked: false` and
                 *   `method: 'self_declared'`, and wrote that "the screens render
                 *   those rather than a green tick". This screen read only
                 *   `isMatch` and showed a success toast — so a member typing
                 *   anything at all was told their BVN was verified.
                 *
                 *   The step still advances: the owner cannot afford onboarding
                 *   to stop, which is why #485 kept isMatch true. What changes is
                 *   that the member is told what actually happened.
                 */
                showToast(
                    result.checked
                        ? "BVN Verified Successfully!"
                        : "BVN recorded. Our team will confirm it during review.",
                    "success",
                );
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
        if (!data.accountNumber?.trim() || (data.accountNumber || "").length !== 10) {
            newErrors.accountNumber = "Valid 10-digit account number required";
        }

        /**
         *   #774 THE BVN IS REQUIRED NOW, and it is checked by the schema's own
         *   rule rather than a second copy of it.
         *
         *   The owner: "NIN, BVN and voter's cards are mandatory but shouldn't
         *   be checked by QoreID." The submit schema was changed to match, so
         *   this screen has to move with it — a step that lets a blank BVN
         *   through hands the applicant a refusal at the end of seven steps
         *   naming no field, which is #773 exactly.
         *
         *   requiredNationalIdField is nationalIdField plus "not blank". It
         *   contacts nobody: the "Verify" button beside this field answers
         *   `checked: false` (#485, #522), and pressing it is NOT required —
         *   the number is confirmed by a human during review, and gating the
         *   step on a self-declared tick would stop applicants for nothing.
         */
        const bvnResult = requiredNationalIdField('BVN').safeParse(data.bvn ?? "");
        if (!bvnResult.success) {
            newErrors.bvn = bvnResult.error.issues[0]?.message ?? "Please check your BVN.";
        }

        if (data.isMemberOfCooperative && !data.cooperativeName?.trim()) {
            newErrors.cooperativeName = "Cooperative name is required";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
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
                        <strong>Bank account details are required</strong> for financial verification and programme disbursement. BVN is optional but recommended. Your data is securely encrypted.
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
                            /*
                             *   #818 The stored flag is kept true to the values.
                             *
                             *   `hasBankAccount` was initialised false and set
                             *   by nothing, so every submitted application said
                             *   the applicant had no bank account while
                             *   carrying her bank name and ten digits. Nothing
                             *   BRANCHES on it today — the review no longer
                             *   does — but a record that contradicts itself is
                             *   how the next reader gets it wrong.
                             */
                            onChange={(e) => {
                                const accountNumber = e.target.value.replace(/\D/g, "").slice(0, 10);
                                updateData({ accountNumber, hasBankAccount: accountNumber.length === 10 });
                            }}
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

                    {/*
                      *   #774 BVN — required, collected, never sent to an
                      *   outside provider. The comment above this label already
                      *   said "REQUIRED on WAVE" while the label beside it said
                      *   "(Optional)" and validateForm enforced neither.
                      */}
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
                                        updateData({ bvn: e.target.value });
                                        setBvnVerified(false);
                                        setBvnError("");
                                    }}
                                    disabled={bvnVerified || verifyingBvn}
                                    maxLength={11}
                                    className={`w-full px-3.5 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 ${errors.bvn ? 'border-red-400' : 'border-slate-300'}`}
                                    placeholder="Enter BVN"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleVerifyBvn}
                                disabled={bvnVerified || verifyingBvn || !data.bvn}
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
                                {/*
                                  *   #522. The same claim as the toast, and the
                                  *   same correction: nothing checked this BVN.
                                  */}
                                <p className={`text-sm flex items-center gap-1 font-medium ${bvnChecked ? "text-emerald-600" : "text-slate-600"}`}>
                                    <CheckCircle className="w-4 h-4" />
                                    {bvnChecked
                                        ? "BVN verified successfully"
                                        : "BVN recorded — our team will confirm it during review"}
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
