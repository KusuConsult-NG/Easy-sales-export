"use client";

import { useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import {
    ChevronRight,
    ChevronLeft,
    Check,
    DollarSign,
    FileText,
    Building2,
    Upload,
    CheckCircle
} from "lucide-react";
import { loanApplicationSchema, type LoanApplicationData } from "@/lib/validations/loan";
import DocumentUpload from "@/components/shared/DocumentUpload";
import { uploadDocumentAction } from "@/app/actions/upload";
import { BUSINESS_LOAN_MONTHLY_RATE, MIN_TERM_MONTHS, MAX_TERM_MONTHS } from "@/lib/loan-terms";
import { LoanPurpose } from "@/types/strict";

/**
 *   #289 NONE OF THIS FORM'S TEN INPUTS HAD AN ACCESSIBLE NAME.
 *
 *        Every field was `<label className="...">Loan Amount (₦)</label>`
 *        followed by a sibling `<input>`. No `htmlFor`, no `id`, and the input
 *        not nested inside the label — so nothing associated the two. A screen
 *        reader announces ten unlabelled edit boxes on a form that asks for a
 *        loan amount, collateral value and annual revenue.
 *
 *        Found because a test could not fill the form: getByLabelText is how
 *        testing-library reaches a field, and it reaches it the same way a
 *        screen reader does. The wizard was unfillable by both for the same
 *        reason.
 *
 *        Same class as this file's h1 note below — /loans/apply had no
 *        document heading either.
 */
const STEPS = [
    { id: 1, title: "Loan Details", icon: DollarSign, description: "Amount & Purpose" },
    { id: 2, title: "Collateral", icon: FileText, description: "Security Information" },
    { id: 3, title: "Business Info", icon: Building2, description: "Company Details" },
    { id: 4, title: "Documents", icon: Upload, description: "Upload Files" },
    { id: 5, title: "Review", icon: CheckCircle, description: "Confirm & Submit" },
];

interface LoanWizardProps {
    /**
     * Files the application. MUST REJECT IF THE APPLICATION WAS NOT FILED.
     *
     *   #287 A REFUSED LOAN APPLICATION SAID NOTHING AND SHOWED NOTHING.
     *
     *        /loans/apply is the only loan application page in the product. Its
     *        handler was:
     *
     *            const result = await submitLoanApplication(data);
     *            if (result.success) { router.push(...) }
     *            // If not success, error handling should be done in the component
     *
     *        The component had no error handling. So every refusal — not signed
     *        in, validation rejected server-side, or the one-open-application
     *        rule (#288) — produced exactly nothing: the button said
     *        "Submitting…", said "Submit Application" again, and the applicant
     *        stayed on step 5 with no message. The only move that dead button
     *        suggests is pressing it again, which can never work.
     *
     *        A thrown error was no better. `await onSubmit(data)` had a
     *        `finally` and no `catch`, so a rejection became an unhandled
     *        promise rejection and the screen still said nothing.
     *
     *        THE UNREFERENCED COPY OF THIS WIZARD GOT IT RIGHT.
     *        components/LoanApplicationWizard.tsx — no importer anywhere — has
     *        `setError(res.error)`, a catch, and a finally. The wired one is the
     *        one that dropped the answer, which is the shape of #276, #277,
     *        #279 and #281 with the halves the other way round.
     *
     * Rejecting rather than returning a result is deliberate: a `void` return
     * can be ignored by writing no code, which is precisely how this happened. A
     * rejection cannot — the catch below is the only place it can land.
     */
    onSubmit: (data: LoanApplicationData) => Promise<void>;
    onCancel?: () => void;
}

/**
 * Documents a loan application may carry.
 *
 * `type` matches the union in loanApplicationSchema. Only the ID is required —
 * the schema asks for at least one document, and demanding a full set would
 * block applicants who have the essentials to hand.
 */
const REQUIRED_DOCUMENTS: Array<{
    type: "id" | "business_reg" | "financial_statement" | "other";
    label: string;
    required: boolean;
}> = [
    { type: "id", label: "Government-issued ID", required: true },
    { type: "business_reg", label: "Business registration (CAC certificate)", required: false },
    { type: "financial_statement", label: "Recent financial statement or bank statement", required: false },
];

export function LoanWizard({ onSubmit, onCancel }: LoanWizardProps) {
    const [currentStep, setCurrentStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [uploading, setUploading] = useState<string[]>([]);
    const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
    // #287. What the server said when it refused, so the applicant can act on
    // it. Nothing held this before, so nothing could be shown.
    const [submitError, setSubmitError] = useState<string | null>(null);

    const methods = useForm<LoanApplicationData>({
        resolver: zodResolver(loanApplicationSchema as any),
        mode: "onChange",
        defaultValues: {
            amount: 10000,
            purpose: LoanPurpose.AGRICULTURE,
            repaymentPeriod: 12,
            collateral: {
                type: "",
                value: 0,
                description: "",
            },
            businessDetails: {
                name: "",
                type: "",
                yearsInOperation: 0,
                annualRevenue: 0,
            },
            // Empty by design. This used to default to a hardcoded
            // "dummy_id.pdf" pointing at example.com, which satisfied the
            // schema's "at least one document" rule — so every application ever
            // submitted referenced a document that did not exist, and step 4
            // had no way to replace it.
            documents: [],
        },
    });

    const { register, formState: { errors }, trigger, getValues, watch, setValue } = methods;

    const uploadedDocuments = watch("documents") ?? [];

    /**
     * Uploads a file and records the returned URL on the form.
     *
     * The file goes through uploadDocumentAction, which validates it and stores
     * it in Cloudinary. It previously went nowhere: step 4 was never built, and
     * the form defaulted to a hardcoded dummy_id.pdf that satisfied the
     * schema's "at least one document" rule.
     */
    async function handleDocumentUpload(
        docType: "id" | "business_reg" | "financial_statement" | "other",
        file: File
    ) {
        setUploadErrors((prev) => {
            const next = { ...prev };
            delete next[docType];
            return next;
        });
        setUploading((prev) => [...prev, docType]);

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("fileName", file.name);
            formData.append("mimeType", file.type);
            formData.append("documentType", `loan_${docType}`);

            const result = await uploadDocumentAction(formData);

            if (!result.success || !result.url) {
                setUploadErrors((prev) => ({
                    ...prev,
                    [docType]: result.success ? "Upload returned no file location." : result.error,
                }));
                return;
            }

            // Replace any earlier upload of the same type rather than stacking
            // duplicates, so re-uploading a corrected file does the obvious thing.
            const current = (getValues("documents") ?? []).filter((d: any) => d.type !== docType);
            setValue(
                "documents",
                [...current, { name: file.name, url: result.url, type: docType }],
                { shouldValidate: true }
            );
        } catch (err) {
            setUploadErrors((prev) => ({
                ...prev,
                [docType]: err instanceof Error ? err.message : "Upload failed. Please try again.",
            }));
        } finally {
            setUploading((prev) => prev.filter((t) => t !== docType));
        }
    }

    const nextStep = async () => {
        // Validate current step fields before proceeding
        const fieldsToValidate = getFieldsForStep(currentStep);
        const isValid = await trigger(fieldsToValidate as any);

        if (isValid && currentStep < STEPS.length) {
            setCurrentStep(currentStep + 1);
        }
    };

    const prevStep = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        }
    };

    async function handleSubmit(data: LoanApplicationData) {
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            await onSubmit(data);
        } catch (err) {
            // #287. There was no catch here at all — only a finally — so a
            // rejected submission became an unhandled promise rejection and the
            // screen said nothing. On success onSubmit navigates away, so
            // reaching this line means the application was NOT filed.
            setSubmitError(
                err instanceof Error && err.message
                    ? err.message
                    : "Your application could not be submitted. Please try again."
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    const getFieldsForStep = (step: number): string[] => {
        switch (step) {
            case 1: return ['amount', 'purpose', 'repaymentPeriod'];
            case 2: return ['collateral.type', 'collateral.value', 'collateral.description'];
            case 3: return ['businessDetails.name', 'businessDetails.type', 'businessDetails.yearsInOperation', 'businessDetails.annualRevenue'];
            case 4: return ['documents'];
            default: return [];
        }
    };

    const currentStepPercentage = ((currentStep - 1) / (STEPS.length - 1)) * 100;

    return (
        <FormProvider {...methods}>
            <div className="max-w-4xl mx-auto p-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8"
                >
                    {/*
                      * h1, not h2 — /loans/apply had NO h1 at all.
                      *
                      * This is the page's main heading and the only heading at
                      * the top of it, but it was marked up as a subheading, so
                      * the loan application page had no document title in its
                      * heading structure. A screen reader user navigating by
                      * headings lands on a level-2 with no level-1 above it, and
                      * "skip to main heading" has nothing to reach.
                      *
                      * Safe to promote: LoanWizard is rendered in exactly one
                      * place, src/app/loans/apply/page.tsx, so this cannot
                      * introduce a second h1 on some other page.
                      */}
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Loan Application
                    </h1>
                    <p className="text-slate-600">
                        Complete all steps to submit your application
                    </p>
                </motion.div>

                {/* Progress Steps */}
                <div className="mb-12 relative">
                    {/* Progress Line */}
                    <div className="absolute top-6 left-0 right-0 h-1 bg-slate-200 -z-10" />
                    <motion.div
                        className="absolute top-6 left-0 h-1 bg-[#1358ec] -z-10"
                        initial={{ width: "0%" }}
                        animate={{ width: `${currentStepPercentage}%` }}
                        transition={{ duration: 0.3 }}
                    />

                    <div className="flex justify-between">
                        {STEPS.map((step) => {
                            const Icon = step.icon;
                            const isActive = currentStep === step.id;
                            const isCompleted = currentStep > step.id;

                            return (
                                <div key={step.id} className="flex flex-col items-center">
                                    <motion.div
                                        className={`
                      w-12 h-12 rounded-full flex items-center justify-center
                      transition-all duration-300 shadow-lg relative z-10
                      ${isCompleted
                                                ? 'bg-green-600'
                                                : isActive
                                                    ? 'bg-[#1358ec]'
                                                    : 'bg-slate-200'
                                            }
                    `}
                                        whileHover={{ scale: 1.1 }}
                                    >
                                        {isCompleted ? (
                                            <Check className="w-6 h-6 text-white" />
                                        ) : (
                                            <Icon className={`w-6 h-6 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                                        )}
                                    </motion.div>
                                    <div className="mt-2 text-center">
                                        <p className={`text-xs font-medium ${isActive ? 'text-[#1358ec]' : isCompleted ? 'text-green-600' : 'text-slate-400'
                                            }`}>
                                            {step.title}
                                        </p>
                                        <p className="text-xs text-slate-500">{step.description}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Form Steps */}
                <form onSubmit={methods.handleSubmit(handleSubmit)}>
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentStep}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3 }}
                            className="bg-white rounded-2xl p-8 shadow-lg mb-8"
                        >
                            {/* Step 1: Loan Details */}
                            {currentStep === 1 && (
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-bold text-slate-900 mb-4">
                                        Loan Details
                                    </h3>

                                    <div>
                                        <label htmlFor="loan-amount" className="block text-sm font-medium text-slate-900 mb-2">
                                            Loan Amount (₦)
                                        </label>
                                        <input
                                            type="number"
                                            id="loan-amount"
                                            {...register("amount", { valueAsNumber: true })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-[#1358ec] focus:border-transparent"
                                            placeholder="10,000"
                                        />
                                        {errors.amount && (
                                            <p className="mt-1 text-sm text-red-600">{errors.amount.message}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label htmlFor="loan-purpose" className="block text-sm font-medium text-slate-900 mb-2">
                                            Loan Purpose
                                        </label>
                                        <select
                                            id="loan-purpose"
                                            {...register("purpose")}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-[#1358ec]"
                                        >
                                            <option value={LoanPurpose.AGRICULTURE}>Agriculture</option>
                                            <option value={LoanPurpose.EQUIPMENT}>Equipment</option>
                                            <option value={LoanPurpose.LAND}>Land Purchase</option>
                                            <option value={LoanPurpose.WORKING_CAPITAL}>Working Capital</option>
                                            <option value={LoanPurpose.OTHER}>Other</option>
                                        </select>
                                        {errors.purpose && (
                                            <p className="mt-1 text-sm text-red-600">{errors.purpose.message}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label htmlFor="loan-repayment-period" className="block text-sm font-medium text-slate-900 mb-2">
                                            Repayment Period (Months)
                                        </label>
                                        <input
                                            type="number"
                                            min={MIN_TERM_MONTHS}
                                            max={MAX_TERM_MONTHS}
                                            step={1}
                                            id="loan-repayment-period"
                                            {...register("repaymentPeriod", { valueAsNumber: true })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-[#1358ec]"
                                            placeholder="12"
                                        />
                                        <p className="mt-1 text-xs text-slate-500">
                                            {MIN_TERM_MONTHS}–{MAX_TERM_MONTHS} months, at{" "}
                                            {BUSINESS_LOAN_MONTHLY_RATE}% interest per month.
                                        </p>
                                        {errors.repaymentPeriod && (
                                            <p className="mt-1 text-sm text-red-600">{errors.repaymentPeriod.message}</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Step 2: Collateral */}
                            {currentStep === 2 && (
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-bold text-slate-900 mb-4">
                                        Collateral Information
                                    </h3>

                                    <div>
                                        <label htmlFor="collateral-type" className="block text-sm font-medium text-slate-900 mb-2">
                                            Collateral Type
                                        </label>
                                        <input
                                            id="collateral-type"
                                            {...register("collateral.type")}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-[#1358ec]"
                                            placeholder="e.g., Land, Vehicle, Equipment"
                                        />
                                        {errors.collateral?.type && (
                                            <p className="mt-1 text-sm text-red-600">{errors.collateral.type.message}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label htmlFor="collateral-value" className="block text-sm font-medium text-slate-900 mb-2">
                                            Estimated Value (₦)
                                        </label>
                                        <input
                                            type="number"
                                            id="collateral-value"
                                            {...register("collateral.value", { valueAsNumber: true })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-[#1358ec]"
                                            placeholder="50,000"
                                        />
                                        {errors.collateral?.value && (
                                            <p className="mt-1 text-sm text-red-600">{errors.collateral.value.message}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label htmlFor="collateral-description" className="block text-sm font-medium text-slate-900 mb-2">
                                            Description
                                        </label>
                                        <textarea
                                            id="collateral-description"
                                            {...register("collateral.description")}
                                            rows={4}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-[#1358ec]"
                                            placeholder="Provide detailed description of the collateral..."
                                        />
                                        {errors.collateral?.description && (
                                            <p className="mt-1 text-sm text-red-600">{errors.collateral.description.message}</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Step 3: Business Details */}
                            {currentStep === 3 && (
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-bold text-slate-900 mb-4">
                                        Business Information
                                    </h3>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="business-name" className="block text-sm font-medium text-slate-900 mb-2">
                                                Business Name
                                            </label>
                                            <input
                                                id="business-name"
                                            {...register("businessDetails.name")}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-[#1358ec]"
                                            />
                                            {errors.businessDetails?.name && (
                                                <p className="mt-1 text-sm text-red-600">{errors.businessDetails.name.message}</p>
                                            )}
                                        </div>

                                        <div>
                                            <label htmlFor="business-type" className="block text-sm font-medium text-slate-900 mb-2">
                                                Business Type
                                            </label>
                                            <input
                                                id="business-type"
                                            {...register("businessDetails.type")}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-[#1358ec]"
                                            />
                                            {errors.businessDetails?.type && (
                                                <p className="mt-1 text-sm text-red-600">{errors.businessDetails.type.message}</p>
                                            )}
                                        </div>

                                        <div>
                                            <label htmlFor="business-years" className="block text-sm font-medium text-slate-900 mb-2">
                                                Years in Operation
                                            </label>
                                            <input
                                                type="number"
                                                id="business-years"
                                            {...register("businessDetails.yearsInOperation", { valueAsNumber: true })}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-[#1358ec]"
                                            />
                                            {errors.businessDetails?.yearsInOperation && (
                                                <p className="mt-1 text-sm text-red-600">{errors.businessDetails.yearsInOperation.message}</p>
                                            )}
                                        </div>

                                        <div>
                                            <label htmlFor="business-revenue" className="block text-sm font-medium text-slate-900 mb-2">
                                                Annual Revenue (₦)
                                            </label>
                                            <input
                                                type="number"
                                                id="business-revenue"
                                            {...register("businessDetails.annualRevenue", { valueAsNumber: true })}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-[#1358ec]"
                                            />
                                            {errors.businessDetails?.annualRevenue && (
                                                <p className="mt-1 text-sm text-red-600">{errors.businessDetails.annualRevenue.message}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Step 4: Documents - Simplified for now */}
                            {currentStep === 4 && (
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-bold text-slate-900 mb-4">
                                        Upload Documents
                                    </h3>
                                    <p className="text-sm text-slate-600 -mt-2">
                                        Provide at least one document. Accepted: JPG, PNG or PDF, up to 5MB each.
                                    </p>

                                    <div className="grid gap-5">
                                        {REQUIRED_DOCUMENTS.map((doc) => (
                                            <DocumentUpload
                                                key={doc.type}
                                                label={doc.label}
                                                accept="image/jpeg,image/png,application/pdf"
                                                maxSize={5}
                                                required={doc.required}
                                                error={uploadErrors[doc.type]}
                                                onUpload={(file) => handleDocumentUpload(doc.type, file)}
                                            />
                                        ))}
                                    </div>

                                    {uploading.length > 0 && (
                                        <p className="text-sm text-slate-500">
                                            Uploading {uploading.length} file
                                            {uploading.length > 1 ? "s" : ""}…
                                        </p>
                                    )}

                                    {uploadedDocuments.length > 0 && (
                                        <div className="rounded-xl border border-slate-200 p-4">
                                            <p className="text-sm font-medium text-slate-900 mb-2">
                                                Uploaded ({uploadedDocuments.length})
                                            </p>
                                            <ul className="space-y-1">
                                                {uploadedDocuments.map((d) => (
                                                    <li
                                                        key={d.url}
                                                        className="flex items-center gap-2 text-sm text-slate-600"
                                                    >
                                                        <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                                                        <span className="truncate">{d.name}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {errors.documents && (
                                        <p className="text-sm text-red-600">
                                            {errors.documents.message ??
                                                "Please upload at least one document."}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Step 5: Review */}
                            {currentStep === 5 && (
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-bold text-slate-900 mb-4">
                                        Review & Submit
                                    </h3>
                                    <div className="space-y-4">
                                        <div className="bg-slate-50 p-4 rounded-xl">
                                            <h4 className="font-semibold mb-2">Loan Amount:</h4>
                                            <p className="text-2xl font-bold text-[#1358ec]">₦{watch("amount")?.toLocaleString()}</p>
                                        </div>
                                        <div className="bg-slate-50 p-4 rounded-xl">
                                            <h4 className="font-semibold mb-2">Purpose:</h4>
                                            <p>{watch("purpose")}</p>
                                        </div>
                                        <div className="bg-slate-50 p-4 rounded-xl">
                                            <h4 className="font-semibold mb-2">Repayment Period:</h4>
                                            <p>{watch("repaymentPeriod")} months</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>

                    {/*
                      * #287. Above the buttons, so it is beside the control the
                      * applicant just pressed rather than at the top of a page
                      * they are scrolled past. role="alert" so a screen reader
                      * announces it — the previous behaviour was silent in
                      * every sense.
                      */}
                    {submitError && (
                        <div
                            role="alert"
                            className="mb-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
                        >
                            <span>{submitError}</span>
                        </div>
                    )}

                    {/* Navigation Buttons */}
                    <div className="flex justify-between">
                        <button
                            key={currentStep === 1 ? 'cancel-btn' : 'prev-btn'}
                            type="button"
                            onClick={currentStep === 1 ? onCancel : prevStep}
                            className="px-6 py-3 rounded-xl bg-slate-200 text-slate-900 font-medium hover:bg-slate-300 transition-colors flex items-center gap-2"
                        >
                            <ChevronLeft className="w-5 h-5" />
                            {currentStep === 1 ? 'Cancel' : 'Previous'}
                        </button>

                        {currentStep < STEPS.length ? (
                            <button
                                key="next-btn"
                                type="button"
                                onClick={nextStep}
                                className="px-6 py-3 rounded-xl bg-[#1358ec] text-white font-medium hover:bg-[#1046c7] transition-colors flex items-center gap-2"
                            >
                                Next
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        ) : (
                            <button
                                key="submit-btn"
                                type="submit"
                                disabled={isSubmitting}
                                className="px-6 py-3 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSubmitting ? 'Submitting...' : 'Submit Application'}
                                <CheckCircle className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </FormProvider>
    );
}
