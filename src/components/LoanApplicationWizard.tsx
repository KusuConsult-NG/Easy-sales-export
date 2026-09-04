"use client";

/**
 *   #370 THIS IS THE ONLY CALLER OF submitLoanApplicationAction, AND NOTHING
 *        IMPORTS IT — SO THE COOPERATIVE LOAN PRODUCT CANNOT BE APPLIED FOR.
 *
 *        #287 already recorded that this file has no importer, in passing,
 *        while explaining that the UNREFERENCED copy of the wizard handled a
 *        refusal better than the wired one. What that note did not follow
 *        through is the consequence.
 *
 *        submitLoanApplicationAction (app/actions/cooperative/_loans_applications.ts)
 *        is where the cooperative loan rules live: it recomputes the member's
 *        tier from their RECORDED savings and refuses a mismatch, caps the
 *        amount at savings × the tier multiplier, checks the duration against
 *        the tier maximum, applies the tier interest rate, and builds a full
 *        amortisation schedule in kobo. Every one of those rules is applied by
 *        nothing, because this component is its only caller.
 *
 *        /loans/apply — which LoanWizard's own header calls "the only loan
 *        application page in the product" — submits through
 *        submitLoanApplication in actions/loan-actions.ts instead. That is the
 *        BUSINESS loan: a monthly rate and a term, no tier, no savings
 *        multiplier. The other of the two products #70 recorded sharing
 *        LOAN_APPLICATIONS.
 *
 *        EVERYTHING DOWNSTREAM IS LIVE. /cooperatives/my-loans reads the
 *        applications and their schedules and offers RepayFromSavingsModal;
 *        /admin/cooperatives/loans approves them and records repayments through
 *        RecordRepaymentModal; /admin/cooperatives/loan-products was wired into
 *        the admin sidebar by #362. Members can repay and admins can approve
 *        cooperative loans that nothing in the product can create.
 *
 *        KEPT, NOT DELETED, AND NOT WIRED UP. #362's rule was to connect a
 *        built screen where its placement is not a product question. Here it
 *        is: the cooperative application would live either at /loans/apply —
 *        which today means business loans — or at
 *        /cooperative/loans/apply/[id], which #362 recorded as one of the ten
 *        orphaned screens. Choosing between them, and whether the two products
 *        share one entrance, is the owner's call.
 *
 *        OWNER DECISION: give the cooperative loan an application path, or
 *        retire the product's application half and say so on the member
 *        screens that currently imply it exists.
 */

import { useState } from "react";
import { ArrowRight, ArrowLeft, Check, Calculator, FileText, Upload } from "lucide-react";
import { calculateLoanCost, COOPERATIVE_TIERS, getTierInterestRate, type CooperativeTier } from "@/lib/cooperative-tiers";
import { logger } from "@/lib/logger";
import { submitLoanApplicationAction } from "@/app/actions/cooperative";

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
        guarantorName: "",
        guarantorPhone: "",
        guarantorEmail: "",
        guarantorRelationship: "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [wizardErrors, setWizardErrors] = useState<Record<string, string>>({});

    const tierInfo = COOPERATIVE_TIERS[tier];
    const maxLoan = contributionAmount * tierInfo.maxLoanMultiplier;
    const loanCost = formData.amount > 0
        ? calculateLoanCost(formData.amount, getTierInterestRate(tier), formData.durationMonths)
        : null;

    function handleNext() {
        if (step === 3) {
            const errs: Record<string, string> = {};
            if (!formData.guarantorName.trim()) {
                errs.guarantorName = "Guarantor full name is required";
            }
            if (!formData.guarantorPhone.trim()) {
                errs.guarantorPhone = "Guarantor phone number is required";
            }
            if (Object.keys(errs).length > 0) {
                setWizardErrors(errs);
                return;
            }
            setWizardErrors({});
        }
        if (step < 5) setStep(step + 1);
    };

    function handlePrevious() {
        if (step > 1) setStep(step - 1);
    };

    async function handleSubmit() {
        setSubmitting(true);
        setError(null);
        try {
            logger.info("Submitting loan application", { userId, ...formData });
            const res = await submitLoanApplicationAction({
                userId,
                userEmail,
                fullName,
                amount: formData.amount,
                purpose: formData.purpose,
                durationMonths: formData.durationMonths,
                contributionAmount,
                tier: "Member",
                guarantorName: formData.guarantorName,
                guarantorPhone: formData.guarantorPhone,
                guarantorEmail: formData.guarantorEmail || undefined,
                guarantorRelationship: formData.guarantorRelationship || undefined,
            });
            if (res.success) {
                onComplete();
            } else {
                setError(res.error || "Failed to submit application");
            }
        } catch (err: any) {
            setError(err?.message || "An unexpected error occurred");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">
            {/* Progress Bar */}
            <div className="h-2 bg-slate-200">
                <div
                    className="h-full bg-linear-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${(step / 5) * 100}%` }}
                />
            </div>

            {/* Header */}
            <div className="px-8 py-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-slate-500">Step {step} of 5</p>
                        <h2 className="text-2xl font-bold text-slate-900">
                            {step === 1 && "Loan Amount"}
                            {step === 2 && "Loan Purpose"}
                            {step === 3 && "Guarantor Details"}
                            {step === 4 && "Review & Calculate"}
                            {step === 5 && "Supporting Documents"}
                        </h2>
                    </div>
                    <div className={`px-4 py-2 rounded-lg ${tierInfo.color === "blue" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"} font-semibold`}>
                        {tier} Tier
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="px-8 py-8">
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">
                        {error}
                    </div>
                )}

                {/* Step 1: Loan Amount */}
                {step === 1 && (
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-900 mb-2">
                                How much would you like to borrow?
                            </label>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">₦</span>
                                <input
                                    type="number"
                                    value={formData.amount || ""}
                                    onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
                                    className="w-full pl-10 pr-4 py-4 text-2xl font-bold border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="0"
                                    max={maxLoan}
                                />
                            </div>
                            <p className="text-sm text-slate-600 mt-2">
                                Maximum: ₦{maxLoan.toLocaleString()} ({tierInfo.maxLoanMultiplier}x your contribution)
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-900 mb-2">
                                Repayment Duration
                            </label>
                            <select
                                value={formData.durationMonths}
                                onChange={(e) => setFormData({ ...formData, durationMonths: Number(e.target.value) })}
                                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value={3}>3 months</option>
                                <option value={6}>6 months</option>
                                <option value={9}>9 months</option>
                                <option value={12}>12 months</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* Step 2: Purpose */}
                {step === 2 && (
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-900 mb-2">
                                What will you use the loan for?
                            </label>
                            <textarea
                                rows={6}
                                value={formData.purpose}
                                onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="Describe how you plan to use this loan (e.g., purchasing farm equipment, inventory, export goods preparation)"
                            />
                        </div>

                        <div className="bg-blue-50 rounded-lg p-6">
                            <h3 className="font-semibold text-blue-900 mb-3">Acceptable Loan Purposes</h3>
                            <ul className="space-y-2 text-sm text-blue-800">
                                <li>• Business expansion or inventory purchase</li>
                                <li>• Export goods preparation and packaging</li>
                                <li>• Farm equipment or agricultural inputs</li>
                                <li>• Working capital for approved transactions</li>
                                <li>• Professional training or certification fees</li>
                            </ul>
                        </div>
                    </div>
                )}

                {/* Step 3: Guarantor Details */}
                {step === 3 && (
                    <div className="space-y-6">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
                            <p className="text-sm text-slate-600 leading-relaxed">
                                Please provide details of a guarantor who can verify your identity and financial capability. Easy Sales admins will contact the guarantor before approving the loan.
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-2">
                                    Guarantor Full Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={formData.guarantorName}
                                    onChange={(e) => setFormData({ ...formData, guarantorName: e.target.value })}
                                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 ${wizardErrors.guarantorName ? 'border-red-500' : 'border-slate-300'}`}
                                    placeholder="Enter guarantor's full name"
                                />
                                {wizardErrors.guarantorName && <p className="text-xs text-red-500 mt-1">{wizardErrors.guarantorName}</p>}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-2">
                                    Guarantor Phone Number <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="tel"
                                    value={formData.guarantorPhone}
                                    onChange={(e) => setFormData({ ...formData, guarantorPhone: e.target.value })}
                                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 ${wizardErrors.guarantorPhone ? 'border-red-500' : 'border-slate-300'}`}
                                    placeholder="e.g. 08012345678"
                                />
                                {wizardErrors.guarantorPhone && <p className="text-xs text-red-500 mt-1">{wizardErrors.guarantorPhone}</p>}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-2">
                                    Guarantor Email Address (Optional)
                                </label>
                                <input
                                    type="email"
                                    value={formData.guarantorEmail}
                                    onChange={(e) => setFormData({ ...formData, guarantorEmail: e.target.value })}
                                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="guarantor@example.com"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-900 mb-2">
                                    Relationship to Applicant (Optional)
                                </label>
                                <select
                                    value={formData.guarantorRelationship}
                                    onChange={(e) => setFormData({ ...formData, guarantorRelationship: e.target.value })}
                                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">Select Relationship</option>
                                    <option value="Employer">Employer</option>
                                    <option value="Business Partner">Business Partner</option>
                                    <option value="Colleague">Colleague</option>
                                    <option value="Family Member">Family Member</option>
                                    <option value="Spouse">Spouse</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 4: Review */}
                {step === 4 && loanCost && (
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
                                    {/*
                                      * #345. This read a hardcoded "2.0%".
                                      *
                                      * The figures either side of it are computed
                                      * with getTierInterestRate(tier), which returns
                                      * DEFAULT_MONTHLY_INTEREST_RATE = 10 — ten
                                      * percent per MONTH — and the server records the
                                      * same 10. So the review screen showed "Monthly
                                      * Interest 2.0%" beside a Total Interest figure
                                      * computed at five times that, and the applicant
                                      * signed for a rate the screen never showed them.
                                      * It reads the rate the application is actually
                                      * filed at.
                                      */}
                                    <p className="text-blue-100 text-sm">Monthly Interest</p>
                                    <p className="text-2xl font-bold">{getTierInterestRate(tier)}%</p>
                                </div>
                                <div>
                                    <p className="text-blue-100 text-sm">Total Interest</p>
                                    <p className="text-2xl font-bold">₦{loanCost.totalInterest.toLocaleString()}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-emerald-50 rounded-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-semibold text-emerald-900">
                                    Monthly Payment
                                </h3>
                                <p className="text-3xl font-bold text-emerald-600">
                                    ₦{Math.round(loanCost.monthlyPayment).toLocaleString()}
                                </p>
                            </div>
                            <p className="text-sm text-emerald-700">
                                Total Repayment: ₦{Math.round(loanCost.totalRepayment).toLocaleString()}
                            </p>
                        </div>

                        <div className="bg-slate-50 rounded-lg p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <h3 className="font-semibold text-slate-900 mb-1">Loan Purpose</h3>
                                <p className="text-slate-600 text-sm">{formData.purpose}</p>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 mb-1">Guarantor</h3>
                                <p className="text-slate-600 text-sm">
                                    <strong>Name:</strong> {formData.guarantorName}<br />
                                    <strong>Phone:</strong> {formData.guarantorPhone}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 5: Documents */}
                {step === 5 && (
                    <div className="space-y-6">
                        <div className="text-center">
                            <Upload className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                Supporting Documents (Optional)
                            </h3>
                            <p className="text-slate-600">
                                Upload any documents that support your loan application
                            </p>
                        </div>

                        <div className="border-2 border-dashed border-slate-300 rounded-lg p-8">
                            <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                            <p className="text-center text-slate-600 mb-2">
                                Drag and drop files here or click to browse
                            </p>
                            <p className="text-center text-sm text-slate-500">
                                PDF, JPG, PNG (Max 10MB per file)
                            </p>
                        </div>

                        <div className="bg-amber-50 rounded-lg p-6">
                            <h3 className="font-semibold text-amber-900 mb-3">
                                Recommended Documents
                            </h3>
                            <ul className="space-y-2 text-sm text-amber-800">
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
            <div className="bg-slate-50 px-8 py-6 flex items-center justify-between border-t border-slate-200">
                <button
                    onClick={step === 1 ? onCancel : handlePrevious}
                    disabled={submitting}
                    className="flex items-center space-x-2 px-6 py-3 text-slate-900 hover:bg-slate-200 rounded-lg font-semibold transition disabled:opacity-50"
                >
                    <ArrowLeft className="w-5 h-5" />
                    <span>{step === 1 ? "Cancel" : "Previous"}</span>
                </button>

                <button
                    onClick={step === 5 ? handleSubmit : handleNext}
                    disabled={submitting || (step === 1 && (formData.amount === 0 || formData.amount > maxLoan))}
                    className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <span>
                        {step === 5 ? (submitting ? "Submitting..." : "Submit Application") : "Next"}
                    </span>
                    {step === 5 ? (
                        submitting ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Check className="w-5 h-5" />
                        )
                    ) : (
                        <ArrowRight className="w-5 h-5" />
                    )}
                </button>
            </div>
        </div>
    );
}
