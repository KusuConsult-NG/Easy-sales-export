/**
 * Step 4: Terms & Agreement
 * 
 * All users must accept marketplace terms
 * Final step for buyers, midpoint for sellers
 */

"use client";

import { CheckCircle, Loader2 } from "lucide-react";
import { MARKETPLACE_CONFIG } from "@/lib/constants";

interface TermsStepProps {
    accepted: boolean;
    onChange: (accepted: boolean) => void;
    onNext: () => void;
    onBack: () => void;
    isFinalStep: boolean;
    isSubmitting?: boolean;
}

export default function TermsStep({ accepted, onChange, onNext, onBack, isFinalStep, isSubmitting }: TermsStepProps) {
    const terms = [
        {
            title: "Marketplace Terms of Service",
            points: [
                "Comply with all product listing guidelines",
                "Provide accurate product information",
                "Fulfill orders within agreed timelines",
                "Maintain quality standards"
            ]
        },
        {
            title: "Payment & Escrow Terms",
            points: [
                "All transactions protected by escrow",
                "Payments released after delivery confirmation",
                `Platform fee: ${MARKETPLACE_CONFIG.platformFee}% per transaction`,
                "Refund policy for disputed orders"
            ]
        },
        {
            title: "User Conduct",
            points: [
                "No fraudulent or misleading listings",
                "Respect intellectual property rights",
                "Professional communication with traders",
                "Account suspension for violations"
            ]
        }
    ];

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="text-center">
                <h2 className="text-3xl font-bold text-slate-900 mb-3">
                    Terms & Agreements
                </h2>
                <p className="text-lg text-slate-600">
                    Review and accept our marketplace terms
                </p>
            </div>

            <div className="max-w-3xl mx-auto space-y-6">
                {/* Terms Sections */}
                {terms.map((section, index) => (
                    <div
                        key={index}
                        className="bg-white border border-slate-200 rounded-xl p-6"
                    >
                        <h3 className="text-lg font-bold text-slate-900 mb-4">
                            {section.title}
                        </h3>
                        <ul className="space-y-2">
                            {section.points.map((point, pointIndex) => (
                                <li key={pointIndex} className="flex items-start gap-3 text-slate-900">
                                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                                    <span>{point}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}

                {/* Risk Disclosure (for sellers) */}
                {!isFinalStep && (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-6">
                        <h4 className="font-bold text-orange-900 mb-3 flex items-center gap-2">
                            <span className="text-xl">⚠️</span>
                            Seller Notice
                        </h4>
                        <ul className="text-sm text-orange-800 space-y-2">
                            <li>• Verification process takes 1-3 business days</li>
                            <li>• Provide accurate business documentation</li>
                            <li>• Product listings require admin approval</li>
                            <li>• Maintain at least 80% fulfillment rate</li>
                        </ul>
                    </div>
                )}

                {/* Acceptance Checkbox */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
                    <label className="flex items-start gap-4 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={accepted}
                            onChange={(e) => onChange(e.target.checked)}
                            className="w-6 h-6 mt-1 text-green-600 border-slate-300 rounded focus:ring-2 focus:ring-green-500 cursor-pointer"
                        />
                        <div className="flex-1">
                            <p className="font-semibold text-slate-900 mb-1">
                                I accept the terms and conditions
                            </p>
                            <p className="text-sm text-slate-600">
                                By checking this box, you agree to abide by all marketplace terms, payment policies,
                                and user conduct guidelines. You understand that violations may result in account
                                suspension or termination.
                            </p>
                        </div>
                    </label>
                </div>

                {/* Document Links */}
                <div className="text-center text-sm text-slate-600">
                    <p>
                        Read the full{" "}
                        <a href="#" className="text-green-600 hover:text-green-700 font-medium">
                            Terms of Service
                        </a>
                        {" "}and{" "}
                        <a href="#" className="text-green-600 hover:text-green-700 font-medium">
                            Privacy Policy
                        </a>
                    </p>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6">
                <button
                    onClick={onBack}
                    className="px-8 py-3 border-2 border-slate-300 text-slate-900 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={onNext}
                    disabled={!accepted || isSubmitting}
                    className="px-8 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                    {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                    {isSubmitting ? "Completing..." : isFinalStep ? "Complete Registration" : "Continue to Verification"}
                </button>
            </div>
        </div>
    );
}
