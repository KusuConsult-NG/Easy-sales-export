/**
 * Terms Acceptance Step
 * 
 * Final step - review and accept terms and agreements
 */

"use client";

import { useState } from "react";
import { Shield, FileText, AlertCircle } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

interface TermsAcceptanceStepProps {
    onNext: (data: any) => void;
    onBack: () => void;
    initialData?: any;
}

export function TermsAcceptanceStep({
    onNext,
    onBack,
    initialData,
}: TermsAcceptanceStepProps) {
    const [acceptedInvestment, setAcceptedInvestment] = useState(
        initialData?.acceptedInvestment || false
    );
    const [acceptedRisk, setAcceptedRisk] = useState(
        initialData?.acceptedRisk || false
    );
    const [acceptedEscrow, setAcceptedEscrow] = useState(
        initialData?.acceptedEscrow || false
    );
    const [acceptedPrivacy, setAcceptedPrivacy] = useState(
        initialData?.acceptedPrivacy || false
    );
    const { showToast } = useToast();

    const allAccepted =
        acceptedInvestment && acceptedRisk && acceptedEscrow && acceptedPrivacy;

    const handleSubmit = () => {
        if (!allAccepted) {
            showToast("Please accept all terms and conditions to continue", "error");
            return;
        }

        onNext({
            terms: {
                acceptedInvestment,
                acceptedRisk,
                acceptedEscrow,
                acceptedPrivacy,
                acceptedAt: new Date().toISOString(),
            },
        });
    };

    return (
        <div className="bg-white rounded-lg p-6 md:p-8">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    Terms & Agreement
                </h2>
                <p className="text-slate-600">
                    Please review and accept our terms to complete your onboarding
                </p>
            </div>

            <div className="space-y-6">
                {/* Risk Disclosure */}
                <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-semibold text-amber-900 mb-2">
                                Investment Risk Disclosure
                            </h4>
                            <p className="text-sm text-amber-800">
                                Agricultural export investments carry inherent risks including market
                                fluctuations, currency exchange rates, and commodity pricing. Past
                                performance does not guarantee future results. Please invest responsibly
                                and only commit funds you can afford to lose.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Terms Checkboxes */}
                <div className="space-y-4">
                    {/* Investment Agreement */}
                    <label className="flex items-start gap-3 p-4 border-2 border-slate-200 rounded-lg cursor-pointer hover:border-orange-300 transition-colors">
                        <input
                            type="checkbox"
                            checked={acceptedInvestment}
                            onChange={(e) => setAcceptedInvestment(e.target.checked)}
                            className="w-5 h-5 mt-0.5 text-orange-500 rounded focus:ring-2 focus:ring-orange-500"
                        />
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <FileText className="w-4 h-4 text-slate-600" />
                                <span className="font-semibold text-slate-900">
                                    Investment Agreement
                                </span>
                            </div>
                            <p className="text-sm text-slate-600">
                                I have read and agree to the{" "}
                                <a href="#" className="text-orange-600 hover:underline">
                                    Investment Terms and Conditions
                                </a>
                            </p>
                        </div>
                    </label>

                    {/* Risk Disclosure */}
                    <label className="flex items-start gap-3 p-4 border-2 border-slate-200 rounded-lg cursor-pointer hover:border-orange-300 transition-colors">
                        <input
                            type="checkbox"
                            checked={acceptedRisk}
                            onChange={(e) => setAcceptedRisk(e.target.checked)}
                            className="w-5 h-5 mt-0.5 text-orange-500 rounded focus:ring-2 focus:ring-orange-500"
                        />
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <AlertCircle className="w-4 h-4 text-slate-600" />
                                <span className="font-semibold text-slate-900">
                                    Risk Disclosure
                                </span>
                            </div>
                            <p className="text-sm text-slate-600">
                                I understand the risks associated with agricultural export investments and
                                accept full responsibility for my investment decisions
                            </p>
                        </div>
                    </label>

                    {/* Escrow Terms */}
                    <label className="flex items-start gap-3 p-4 border-2 border-slate-200 rounded-lg cursor-pointer hover:border-orange-300 transition-colors">
                        <input
                            type="checkbox"
                            checked={acceptedEscrow}
                            onChange={(e) => setAcceptedEscrow(e.target.checked)}
                            className="w-5 h-5 mt-0.5 text-orange-500 rounded focus:ring-2 focus:ring-orange-500"
                        />
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <Shield className="w-4 h-4 text-slate-600" />
                                <span className="font-semibold text-slate-900">
                                    Escrow Agreement
                                </span>
                            </div>
                            <p className="text-sm text-slate-600">
                                I agree to the{" "}
                                <a href="#" className="text-orange-600 hover:underline">
                                    Escrow Service Terms
                                </a>{" "}
                                for fund protection
                            </p>
                        </div>
                    </label>

                    {/* Privacy Policy */}
                    <label className="flex items-start gap-3 p-4 border-2 border-slate-200 rounded-lg cursor-pointer hover:border-orange-300 transition-colors">
                        <input
                            type="checkbox"
                            checked={acceptedPrivacy}
                            onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                            className="w-5 h-5 mt-0.5 text-orange-500 rounded focus:ring-2 focus:ring-orange-500"
                        />
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <FileText className="w-4 h-4 text-slate-600" />
                                <span className="font-semibold text-slate-900">
                                    Privacy Policy
                                </span>
                            </div>
                            <p className="text-sm text-slate-600">
                                I have read and agree to the{" "}
                                <a href="#" className="text-orange-600 hover:underline">
                                    Privacy Policy
                                </a>{" "}
                                and data processing terms
                            </p>
                        </div>
                    </label>
                </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between pt-6">
                    <button
                        onClick={onBack}
                        className="px-6 py-3 border-2 border-slate-300 text-slate-900 rounded-lg hover:bg-slate-100 transition-colors font-semibold"
                    >
                        Back
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!allAccepted}
                        className="px-8 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                    >
                        Complete Onboarding
                    </button>
                </div>
            </div>
        </div>
    );
}
