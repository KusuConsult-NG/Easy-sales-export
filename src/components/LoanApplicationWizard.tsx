"use client";

import { useState } from "react";
import { ArrowRight, ArrowLeft, Check, Calculator, FileText, Upload } from "lucide-react";
import { calculateLoanCost, COOPERATIVE_TIERS, type CooperativeTier } from "@/lib/cooperative-tiers";
import { logger } from "@/lib/logger";

interface LoanApplicationWizardProps {
    userId: string;
    userEmail: string;
    fullName: string;
    contributionAmount: number;
    tier: CooperativeTier;
    onComplete: () => void;
    onCancel: () => void;
}

export default function LoanApplicationWizard({
    userId,
    userEmail,
    fullName,
    contributionAmount,
    tier,
    onComplete,
    onCancel,
}: LoanApplicationWizardProps) {
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState({
        amount: 0,
        purpose: "",
        durationMonths: 3,
    });

    const tierInfo = COOPERATIVE_TIERS[tier];
    const maxLoan = contributionAmount * tierInfo.maxLoanMultiplier;
    const loanCost = formData.amount > 0
        ? calculateLoanCost(formData.amount, tierInfo.maxLoanMultiplier === 3 ? 2 : 2.5, formData.durationMonths)
        : null;

    const handleNext = () => {
        if (step < 4) setStep(step + 1);
    };

    const handlePrevious = () => {
        if (step > 1) setStep(step - 1);
    };

    const handleSubmit = async () => {
        // Submit loan application
        logger.info("Submitting loan application", { userId, ...formData });
        onComplete();
    };

    return (
        <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden">
            {/* Progress Bar */}
            <div className="h-2 bg-slate-200 dark:bg-slate-700">
                <div
                    className="h-full bg-linear-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${(step / 4) * 100}%` }}
                />
            </div>

            {/* Header */}
            <div className="px-8 py-6 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Step {step} of 4</p>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                            {step === 1 && "Loan Amount"}
                            {step === 2 && "Loan Purpose"}
                            {step === 3 && "Review & Calculate"}
                            {step === 4 && "Supporting Documents"}
                        </h2>
                    </div>
                    <div className={`px-4 py-2 rounded-lg ${tierInfo.color === "blue" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"} font-semibold`}>
                        {tier} Tier
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="px-8 py-8">
                {/* Step 1: Loan Amount */}
                {step === 1 && (
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                How much would you like to borrow?
                            </label>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">₦</span>
                                <input
                                    type="number"
                                    value={formData.amount || ""}
                                    onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
                                    className="w-full pl-10 pr-4 py-4 text-2xl font-bold border-2 border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-white"
                                    placeholder="0"
                                    max={maxLoan}
                                />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                                Maximum: ₦{maxLoan.toLocaleString()} ({tierInfo.maxLoanMultiplier}x your contribution)
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Repayment Duration
                            </label>
                            <select
                                value={formData.durationMonths}
                                onChange={(e) => setFormData({ ...formData, durationMonths: Number(e.target.value) })}
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-white"
                            >
                                <option value={3}>3 months</option>
                                <option value={6}>6 months</option>
                                {tier === "Premium" && <option value={9}>9 months</option>}
                                {tier === "Premium" && <option value={12}>12 months</option>}
                            </select>
                        </div>
                    </div>
                )}

                {/* Step 2: Purpose */}
                {step === 2 && (
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                What will you use the loan for?
                            </label>
                            <textarea
                                rows={6}
                                value={formData.purpose}
                                onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-700 dark:text-white"
                                placeholder="Describe how you plan to use this loan (e.g., purchasing farm equipment, inventory, export goods preparation)"
                            />
                        </div>

                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6">
                            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-3">Acceptable Loan Purposes</h3>
                            <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
                                <li>• Business expansion or inventory purchase</li>
                                <li>• Export goods preparation and packaging</li>
                                <li>• Farm equipment or agricultural inputs</li>
                                <li>• Working capital for approved transactions</li>
                                <li>• Professional training or certification fees</li>
                            </ul>
                        </div>
                    </div>
                )}

                {/* Step 3: Review */}
                {step === 3 && loanCost && (
                    <div className="space-y-6">
                        <div className="bg-linear-to-br from-blue-600 to-indigo-600 text-white rounded-lg p-6">
                            <div className="flex items-center space-x-3 mb-4">
                                <Calculator className="w-6 h-6" />
                                <h3 className="text-xl font-semibold">Loan Summary</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-blue-100 text-sm">Principal Amount</p>
                                    <p className="text-2xl font-bold">₦{formData.amount.toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-blue-100 text-sm">Duration</p>
                                    <p className="text-2xl font-bold">{formData.durationMonths} months</p>
                                </div>
                                <div>
                                    <p className="text-blue-100 text-sm">Monthly Interest</p>
                                    <p className="text-2xl font-bold">{tier === "Premium" ? "2%" : "2.5%"}</p>
                                </div>
                                <div>
                                    <p className="text-blue-100 text-sm">Total Interest</p>
                                    <p className="text-2xl font-bold">₦{loanCost.totalInterest.toLocaleString()}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">
                                    Monthly Payment
                                </h3>
                                <p className="text-3xl font-bold text-emerald-600">
                                    ₦{Math.round(loanCost.monthlyPayment).toLocaleString()}
                                </p>
                            </div>
                            <p className="text-sm text-emerald-700 dark:text-emerald-300">
                                Total Repayment: ₦{Math.round(loanCost.totalRepayment).toLocaleString()}
                            </p>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-6">
                            <h3 className="font-semibold text-slate-900 dark:text-white mb-3">Loan Purpose</h3>
                            <p className="text-slate-600 dark:text-slate-300">{formData.purpose}</p>
                        </div>
                    </div>
                )}

                {/* Step 4: Documents */}
                {step === 4 && (
                    <div className="space-y-6">
                        <div className="text-center">
                            <Upload className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                                Supporting Documents (Optional)
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400">
                                Upload any documents that support your loan application
                            </p>
                        </div>

                        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8">
                            <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                            <p className="text-center text-slate-600 dark:text-slate-400 mb-2">
                                Drag and drop files here or click to browse
                            </p>
                            <p className="text-center text-sm text-slate-500">
                                PDF, JPG, PNG (Max 10MB per file)
                            </p>
                        </div>

                        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-6">
                            <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-3">
                                Recommended Documents
                            </h3>
                            <ul className="space-y-2 text-sm text-amber-800 dark:text-amber-200">
                                <li>• Business plan or project proposal</li>
                                <li>• Proforma invoices or quotes</li>
                                <li>• Export documentation (for export-related loans)</li>
                                <li>• Bank statements (last 3 months)</li>
                            </ul>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="bg-slate-50 dark:bg-slate-900/50 px-8 py-6 flex items-center justify-between border-t border-slate-200 dark:border-slate-700">
                <button
                    onClick={step === 1 ? onCancel : handlePrevious}
                    className="flex items-center space-x-2 px-6 py-3 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg font-semibold transition"
                >
                    <ArrowLeft className="w-5 h-5" />
                    <span>{step === 1 ? "Cancel" : "Previous"}</span>
                </button>

                <button
                    onClick={step === 4 ? handleSubmit : handleNext}
                    disabled={step === 1 && (formData.amount === 0 || formData.amount > maxLoan)}
                    className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <span>{step === 4 ? "Submit Application" : "Next"}</span>
                    {step === 4 ? <Check className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}
                </button>
            </div>
        </div>
    );
}
