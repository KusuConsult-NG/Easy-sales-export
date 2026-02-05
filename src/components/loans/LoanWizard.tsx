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
import { LoanPurpose } from "@/types/strict";

const STEPS = [
    { id: 1, title: "Loan Details", icon: DollarSign, description: "Amount & Purpose" },
    { id: 2, title: "Collateral", icon: FileText, description: "Security Information" },
    { id: 3, title: "Business Info", icon: Building2, description: "Company Details" },
    { id: 4, title: "Documents", icon: Upload, description: "Upload Files" },
    { id: 5, title: "Review", icon: CheckCircle, description: "Confirm & Submit" },
];

interface LoanWizardProps {
    onSubmit: (data: LoanApplicationData) => Promise<void>;
    onCancel?: () => void;
}

export function LoanWizard({ onSubmit, onCancel }: LoanWizardProps) {
    const [currentStep, setCurrentStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const methods = useForm<LoanApplicationData>({
        resolver: zodResolver(loanApplicationSchema),
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
            documents: [],
        },
    });

    const { register, formState: { errors }, trigger, getValues, watch } = methods;

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

    const handleSubmit = async (data: LoanApplicationData) => {
        setIsSubmitting(true);
        try {
            await onSubmit(data);
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
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Loan Application
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400">
                        Complete all steps to submit your application
                    </p>
                </motion.div>

                {/* Progress Steps */}
                <div className="mb-12 relative">
                    {/* Progress Line */}
                    <div className="absolute top-6 left-0 right-0 h-1 bg-slate-200 dark:bg-slate-700 -z-10" />
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
                                                    : 'bg-slate-200 dark:bg-slate-700'
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
                            className="bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-lg mb-8"
                        >
                            {/* Step 1: Loan Details */}
                            {currentStep === 1 && (
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                        Loan Details
                                    </h3>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Loan Amount (₦)
                                        </label>
                                        <input
                                            type="number"
                                            {...register("amount", { valueAsNumber: true })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#1358ec] focus:border-transparent"
                                            placeholder="10,000"
                                        />
                                        {errors.amount && (
                                            <p className="mt-1 text-sm text-red-600">{errors.amount.message}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Loan Purpose
                                        </label>
                                        <select
                                            {...register("purpose")}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#1358ec]"
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
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Repayment Period (Months)
                                        </label>
                                        <input
                                            type="number"
                                            {...register("repaymentPeriod", { valueAsNumber: true })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#1358ec]"
                                            placeholder="12"
                                        />
                                        {errors.repaymentPeriod && (
                                            <p className="mt-1 text-sm text-red-600">{errors.repaymentPeriod.message}</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Step 2: Collateral */}
                            {currentStep === 2 && (
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                        Collateral Information
                                    </h3>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Collateral Type
                                        </label>
                                        <input
                                            {...register("collateral.type")}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#1358ec]"
                                            placeholder="e.g., Land, Vehicle, Equipment"
                                        />
                                        {errors.collateral?.type && (
                                            <p className="mt-1 text-sm text-red-600">{errors.collateral.type.message}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Estimated Value (₦)
                                        </label>
                                        <input
                                            type="number"
                                            {...register("collateral.value", { valueAsNumber: true })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#1358ec]"
                                            placeholder="50,000"
                                        />
                                        {errors.collateral?.value && (
                                            <p className="mt-1 text-sm text-red-600">{errors.collateral.value.message}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Description
                                        </label>
                                        <textarea
                                            {...register("collateral.description")}
                                            rows={4}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-[#1358ec]"
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
                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                        Business Information
                                    </h3>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                                Business Name
                                            </label>
                                            <input
                                                {...register("businessDetails.name")}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 focus:ring-2 focus:ring-[#1358ec]"
                                            />
                                            {errors.businessDetails?.name && (
                                                <p className="mt-1 text-sm text-red-600">{errors.businessDetails.name.message}</p>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                                Business Type
                                            </label>
                                            <input
                                                {...register("businessDetails.type")}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 focus:ring-2 focus:ring-[#1358ec]"
                                            />
                                            {errors.businessDetails?.type && (
                                                <p className="mt-1 text-sm text-red-600">{errors.businessDetails.type.message}</p>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                                Years in Operation
                                            </label>
                                            <input
                                                type="number"
                                                {...register("businessDetails.yearsInOperation", { valueAsNumber: true })}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 focus:ring-2 focus:ring-[#1358ec]"
                                            />
                                            {errors.businessDetails?.yearsInOperation && (
                                                <p className="mt-1 text-sm text-red-600">{errors.businessDetails.yearsInOperation.message}</p>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                                Annual Revenue (₦)
                                            </label>
                                            <input
                                                type="number"
                                                {...register("businessDetails.annualRevenue", { valueAsNumber: true })}
                                                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 focus:ring-2 focus:ring-[#1358ec]"
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
                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                        Upload Documents
                                    </h3>
                                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center">
                                        <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                        <p className="text-slate-600 dark:text-slate-400">
                                            Document upload functionality - integrate with your file upload service
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Step 5: Review */}
                            {currentStep === 5 && (
                                <div className="space-y-6">
                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                        Review & Submit
                                    </h3>
                                    <div className="space-y-4">
                                        <div className="bg-slate-50 dark:bg-slate-700 p-4 rounded-xl">
                                            <h4 className="font-semibold mb-2">Loan Amount:</h4>
                                            <p className="text-2xl font-bold text-[#1358ec]">₦{watch("amount")?.toLocaleString()}</p>
                                        </div>
                                        <div className="bg-slate-50 dark:bg-slate-700 p-4 rounded-xl">
                                            <h4 className="font-semibold mb-2">Purpose:</h4>
                                            <p>{watch("purpose")}</p>
                                        </div>
                                        <div className="bg-slate-50 dark:bg-slate-700 p-4 rounded-xl">
                                            <h4 className="font-semibold mb-2">Repayment Period:</h4>
                                            <p>{watch("repaymentPeriod")} months</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>

                    {/* Navigation Buttons */}
                    <div className="flex justify-between">
                        <button
                            type="button"
                            onClick={currentStep === 1 ? onCancel : prevStep}
                            className="px-6 py-3 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors flex items-center gap-2"
                        >
                            <ChevronLeft className="w-5 h-5" />
                            {currentStep === 1 ? 'Cancel' : 'Previous'}
                        </button>

                        {currentStep < STEPS.length ? (
                            <button
                                type="button"
                                onClick={nextStep}
                                className="px-6 py-3 rounded-xl bg-[#1358ec] text-white font-medium hover:bg-[#1046c7] transition-colors flex items-center gap-2"
                            >
                                Next
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        ) : (
                            <button
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
