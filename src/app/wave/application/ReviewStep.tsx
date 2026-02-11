/**
 * Step 5: Review & Submit
 * Final review of all application data before submission
 */

"use client";

import { useState } from "react";
import { ChevronLeft, CheckCircle, Edit, Loader2, FileText } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import type { WaveApplicationData } from "./page";

interface Props {
    data: WaveApplicationData;
    onBack: () => void;
    onSubmit: () => Promise<void>;
    submitting: boolean;
    onEdit: (step: number) => void;
}

export default function ReviewStep({ data, onBack, onSubmit, submitting, onEdit }: Props) {
    const [termsAccepted, setTermsAccepted] = useState(false);
    const { showToast } = useToast();

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat("en-NG", {
            style: "currency",
            currency: "NGN",
        }).format(amount);
    };

    const handleSubmit = async () => {
        if (!termsAccepted) {
            showToast("Please accept the terms and conditions to continue", "error");
            return;
        }
        await onSubmit();
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                Review & Submit
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-8">
                Please review your application before submitting
            </p>

            <div className="space-y-6">
                {/* Eligibility Section */}
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900 dark:text-white">
                            Personal Information
                        </h3>
                        <button
                            onClick={() => onEdit(0)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-700 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Full Name</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.fullName}</p>
                        </div>
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Email</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.email}</p>
                        </div>
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Phone</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.phone}</p>
                        </div>
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">State</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.stateOfResidence}</p>
                        </div>
                    </div>
                </div>

                {/* Experience Section */}
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900 dark:text-white">
                            Agricultural Experience
                        </h3>
                        <button
                            onClick={() => onEdit(1)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-700 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Activity</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.agriculturalActivity}</p>
                        </div>
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Experience</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.yearsOfExperience} years</p>
                        </div>
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Farm Size</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.farmSize}</p>
                        </div>
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Monthly Revenue</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.monthlyRevenue}</p>
                        </div>
                    </div>
                </div>

                {/* Proposal Section */}
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900 dark:text-white">
                            Business Proposal
                        </h3>
                        <button
                            onClick={() => onEdit(2)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-700 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="space-y-3 text-sm">
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Business Name</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.businessName}</p>
                        </div>
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Funding Needed</p>
                            <p className="font-medium dark:text-white text-xl text-emerald-700">
                                {formatCurrency(data.fundingNeeded)}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600 dark:text-slate-400">Target Market</p>
                            <p className="font-medium text-slate-900 dark:text-white">{data.targetMarket}</p>
                        </div>
                    </div>
                </div>

                {/* Documents Section */}
                <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900 dark:text-white">
                            Uploaded Documents
                        </h3>
                        <button
                            onClick={() => onEdit(3)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-700 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="space-y-2">
                        {Object.entries(data.documents).map(([key, file]) =>
                            file ? (
                                <div key={key} className="flex items-center gap-2 text-sm">
                                    <CheckCircle className="w-4 h-4 text-green-600" />
                                    <FileText className="w-4 h-4 text-slate-600" />
                                    <span className="text-slate-900 dark:text-white">{file.name}</span>
                                </div>
                            ) : null
                        )}
                    </div>
                </div>

                {/* Terms & Conditions */}
                <div className="border border-slate-300 dark:border-slate-600 rounded-xl p-6">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={termsAccepted}
                            onChange={(e) => setTermsAccepted(e.target.checked)}
                            className="mt-1 w-5 h-5 text-emerald-700 border-slate-300 rounded focus:ring-emerald-600"
                        />
                        <div className="text-sm">
                            <p className="font-semibold text-slate-900 dark:text-white mb-1">
                                Terms and Conditions
                            </p>
                            <p className="text-slate-600 dark:text-slate-400">
                                I confirm that all information provided is accurate and complete.
                                I understand that providing false information may result in
                                disqualification from the WAVE program. I agree to the terms and
                                conditions of the application process.
                            </p>
                        </div>
                    </label>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 gap-4">
                <button
                    onClick={onBack}
                    disabled={submitting}
                    className="flex items-center gap-2 px-6 py-3 border border-slate-300 dark:border-slate-600 rounded-xl font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-all text-slate-700 dark:text-slate-300 disabled:opacity-50"
                >
                    <ChevronLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={!termsAccepted || submitting}
                    className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-700 text-white px-10 py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {submitting ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Submitting...
                        </>
                    ) : (
                        <>
                            Submit Application
                            <CheckCircle className="w-5 h-5" />
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
