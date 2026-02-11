"use client";

import { useState } from "react";
import { CheckCircle, ArrowRight, ArrowLeft, FileText, Shield } from "lucide-react";

interface TermsStepProps {
    onNext: (data: any) => void;
    onBack: () => void;
    initialData?: any;
}

export default function TermsStep({ onNext, onBack, initialData }: TermsStepProps) {
    const [formData, setFormData] = useState({
        termsAccepted: initialData?.termsAccepted || false,
        privacyAccepted: initialData?.privacyAccepted || false,
        feeDisclosureAccepted: initialData?.feeDisclosureAccepted || false,
    });

    const [error, setError] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.termsAccepted || !formData.privacyAccepted || !formData.feeDisclosureAccepted) {
            setError("Please accept all required terms to continue");
            return;
        }

        onNext({ terms: formData });
    };

    const handleCheckboxChange = (field: keyof typeof formData) => {
        setFormData((prev) => ({ ...prev, [field]: !prev[field] }));
        setError("");
    };

    const allAccepted = formData.termsAccepted && formData.privacyAccepted && formData.feeDisclosureAccepted;

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Terms & Agreement
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Please review and accept the following terms to complete your onboarding
                </p>
            </div>

            {/* Terms & Conditions */}
            <div className="space-y-4">
                <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-xl border-2 border-slate-200 dark:border-slate-700">
                    <div className="flex items-start gap-3 mb-4">
                        <FileText className="w-6 h-6 text-teal-600 shrink-0 mt-1" />
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                Farm Nation Terms of Service
                            </h3>
                            <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300 max-h-64 overflow-y-auto">
                                <p className="font-semibold">Key Points:</p>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>All property listings must be accurate and genuine</li>
                                    <li>Sellers are responsible for property verification documentation</li>
                                    <li>Buyers and sellers must conduct due diligence before transactions</li>
                                    <li>Farm Nation acts as a platform intermediary, not a real estate agent</li>
                                    <li>All transactions are subject to Nigerian property laws</li>
                                    <li>Escrow services are recommended for all purchases</li>
                                    <li>Disputes should be resolved through official legal channels</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={formData.termsAccepted}
                            onChange={() => handleCheckboxChange("termsAccepted")}
                            className="mt-1 w-5 h-5 text-teal-600 rounded border-slate-300 focus:ring-2 focus:ring-teal-500"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-teal-600 transition-colors">
                            I have read and agree to the{" "}
                            <a href="/terms" target="_blank" className="text-teal-600 hover:underline font-medium">
                                Terms of Service
                            </a>{" "}
                            <span className="text-red-500">*</span>
                        </span>
                    </label>
                </div>

                {/* Privacy Policy */}
                <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-xl border-2 border-slate-200 dark:border-slate-700">
                    <div className="flex items-start gap-3 mb-4">
                        <Shield className="w-6 h-6 text-teal-600 shrink-0 mt-1" />
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                Privacy Policy
                            </h3>
                            <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                                <p>We collect and process your personal data to:</p>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>Match you with relevant property listings</li>
                                    <li>Facilitate communication between buyers and sellers</li>
                                    <li>Verify identity and prevent fraud</li>
                                    <li>Improve our platform services</li>
                                    <li>Send important notifications and updates</li>
                                </ul>
                                <p className="mt-2">
                                    Your data is protected and will not be shared without your consent, except as required by law.
                                </p>
                            </div>
                        </div>
                    </div>
                    <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={formData.privacyAccepted}
                            onChange={() => handleCheckboxChange("privacyAccepted")}
                            className="mt-1 w-5 h-5 text-teal-600 rounded border-slate-300 focus:ring-2 focus:ring-teal-500"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-teal-600 transition-colors">
                            I acknowledge the{" "}
                            <a href="/privacy" target="_blank" className="text-teal-600 hover:underline font-medium">
                                Privacy Policy
                            </a>{" "}
                            <span className="text-red-500">*</span>
                        </span>
                    </label>
                </div>

                {/* Fee Disclosure */}
                <div className="p-6 bg-teal-50 dark:bg-teal-900/10 rounded-xl border-2 border-teal-200 dark:border-teal-800">
                    <div className="flex items-start gap-3 mb-4">
                        <CheckCircle className="w-6 h-6 text-teal-600 shrink-0 mt-1" />
                        <div>
                            <h3 className="text-lg font-bold text-teal-900 dark:text-teal-100 mb-2">
                                Platform Fees
                            </h3>
                            <div className="space-y-2 text-sm text-teal-800 dark:text-teal-200">
                                <p className="font-semibold">Transparent Pricing:</p>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li><strong>Buyers:</strong> Free to browse and inquire. No commission fees.</li>
                                    <li><strong>Sellers:</strong> 2.5% commission on successful transactions</li>
                                    <li><strong>Premium Listings:</strong> Optional paid promotion starting at ₦5,000/month</li>
                                    <li><strong>Escrow Service:</strong> 1% of transaction value (recommended)</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <label className="flex items-start gap-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={formData.feeDisclosureAccepted}
                            onChange={() => handleCheckboxChange("feeDisclosureAccepted")}
                            className="mt-1 w-5 h-5 text-teal-600 rounded border-slate-300 focus:ring-2 focus:ring-teal-500"
                        />
                        <span className="text-sm text-teal-800 dark:text-teal-200 group-hover:text-teal-600 transition-colors">
                            I understand and accept the platform fee structure{" "}
                            <span className="text-red-500">*</span>
                        </span>
                    </label>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
            )}

            <div className="flex justify-between pt-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="px-6 py-3 border-2 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                </button>
                <button
                    type="submit"
                    disabled={!allAccepted}
                    className="px-8 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    Complete Onboarding
                    <CheckCircle className="w-4 h-4" />
                </button>
            </div>
        </form>
    );
}
