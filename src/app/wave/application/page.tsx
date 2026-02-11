/**
 * WAVE Program Application - Multi-Step Form
 * 
 * 5 Steps:
 * 1. Eligibility Check
 * 2. Agricultural Experience  
 * 3. Business Proposal
 * 4. Document Upload
 * 5. Review & Submit
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    ChevronLeft,
    ChevronRight,
    CheckCircle,
    Loader2,
} from "lucide-react";
import { submitMultiStepWaveApplicationAction } from "@/app/actions/wave";
import { useToast } from "@/contexts/ToastContext";

// Step imports
import EligibilityStep from "./steps/EligibilityStep";
import ExperienceStep from "./steps/ExperienceStep";
import ProposalStep from "./steps/ProposalStep";
import DocumentsStep from "./steps/DocumentsStep";
import ReviewStep from "./ReviewStep";

export interface WaveApplicationData {
    // Step 1: Eligibility
    fullName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: "female" | "male" | "";
    citizenship: string;
    stateOfResidence: string;

    // Step 2: Experience
    agriculturalActivity: string;
    yearsOfExperience: number;
    farmSize: string;
    monthlyRevenue: string;
    currentChallenges: string;

    // Step 3: Proposal
    businessName: string;
    businessDescription: string;
    targetMarket: string;
    fundingNeeded: number;
    shortTermGoals: string;
    mediumTermGoals: string;
    longTermGoals: string;
    expectedImpact: string;

    // Step 4: Documents
    documents: {
        governmentId?: File | null;
        passportPhoto?: File | null;
        businessEvidence?: File | null;
        bankStatement?: File | null;
        businessRegistration?: File | null;
    };
}

const INITIAL_DATA: WaveApplicationData = {
    fullName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    gender: "",
    citizenship: "nigerian",
    stateOfResidence: "",
    agriculturalActivity: "",
    yearsOfExperience: 0,
    farmSize: "",
    monthlyRevenue: "",
    currentChallenges: "",
    businessName: "",
    businessDescription: "",
    targetMarket: "",
    fundingNeeded: 0,
    shortTermGoals: "",
    mediumTermGoals: "",
    longTermGoals: "",
    expectedImpact: "",
    documents: {},
};

const STEPS = [
    "Eligibility",
    "Experience",
    "Proposal",
    "Documents",
    "Review",
];



export default function WaveApplicationPage() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(0);
    const [formData, setFormData] = useState<WaveApplicationData>(INITIAL_DATA);
    const [submitting, setSubmitting] = useState(false);
    const { showToast } = useToast();

    const updateFormData = (data: Partial<WaveApplicationData>) => {
        setFormData((prev) => ({ ...prev, ...data }));
    };

    const nextStep = () => {
        if (currentStep < STEPS.length - 1) {
            setCurrentStep((prev) => prev + 1);
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    const prevStep = () => {
        if (currentStep > 0) {
            setCurrentStep((prev) => prev - 1);
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            // Submit WAVE application with full multi-step data
            const result = await submitMultiStepWaveApplicationAction(formData);

            if (result.success) {
                router.push("/wave/application/success");
            } else {
                showToast(result.error || "Failed to submit application. Please try again.", "error");
            }
        } catch (error) {
            console.error("Submission error:", error);
            showToast("An unexpected error occurred. Please try again.", "error");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-stone-900 via-emerald-900 to-stone-900">
            <div className="max-w-4xl mx-auto px-4 py-12">
                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-white mb-4">
                        WAVE Program Application
                    </h1>
                    <p className="text-lg text-emerald-200 mb-2">
                        Women's Agribusiness Venture Empowerment
                    </p>
                    <p className="text-xs text-emerald-200/50 uppercase tracking-widest font-semibold">
                        Implemented by Easy Sales Export
                    </p>
                </div>

                {/* Progress Bar */}
                <div className="mb-12">
                    <div className="flex items-center justify-between mb-2">
                        {STEPS.map((step, index) => (
                            <div
                                key={step}
                                className="flex-1 flex flex-col items-center relative"
                            >
                                <div
                                    className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all z-10 ${index < currentStep
                                        ? "bg-emerald-600 text-white"
                                        : index === currentStep
                                            ? "bg-emerald-600 text-white ring-4 ring-emerald-500/30"
                                            : "bg-emerald-900 text-emerald-400 border border-emerald-700"
                                        }`}
                                >
                                    {index < currentStep ? (
                                        <CheckCircle className="w-5 h-5" />
                                    ) : (
                                        index + 1
                                    )}
                                </div>
                                <span className={`text-xs mt-2 text-center font-medium ${index <= currentStep ? "text-white" : "text-emerald-700"}`}>
                                    {step}
                                </span>
                                {index < STEPS.length - 1 && (
                                    <div
                                        className={`absolute top-5 left-1/2 w-full h-0.5 -z-10 ${index < currentStep
                                            ? "bg-emerald-600"
                                            : "bg-emerald-900"
                                            }`}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Step Content */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-xl p-8 mb-8 text-white">
                    {currentStep === 0 && (
                        <EligibilityStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                        />
                    )}
                    {currentStep === 1 && (
                        <ExperienceStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 2 && (
                        <ProposalStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 3 && (
                        <DocumentsStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 4 && (
                        <ReviewStep
                            data={formData}
                            onBack={prevStep}
                            onSubmit={handleSubmit}
                            submitting={submitting}
                            onEdit={(step) => setCurrentStep(step)}
                        />
                    )}
                </div>

                {/* Navigation Buttons (shown for steps 1-4) */}
                {currentStep < 4 && (
                    <div className="flex items-center justify-between">
                        <button
                            onClick={prevStep}
                            disabled={currentStep === 0}
                            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10 text-emerald-100"
                        >
                            <ChevronLeft className="w-5 h-5" />
                            Back
                        </button>
                        <div className="text-sm text-emerald-400">
                            Step {currentStep + 1} of {STEPS.length}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
