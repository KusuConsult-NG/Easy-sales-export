/**
 * Export Windows Onboarding - Main Page
 * 
 * Multi-step onboarding flow for Export Windows service
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, TrendingUp, Shield, CheckCircle } from "lucide-react";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { OnboardingStep } from "@/types/service-registration";

import { submitExportOnboardingAction } from "@/app/actions/export";

// Import step components
import { InvestmentProfileStep } from "./steps/InvestmentProfileStep";
import { KYCVerificationStep } from "./steps/KYCVerificationStep";
import { BankAccountStep } from "./steps/BankAccountStep";
import { TermsAcceptanceStep } from "./steps/TermsAcceptanceStep";

const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        id: "profile",
        title: "Investment Profile",
        description: "Tell us about your investment goals and preferences",
        completed: false,
        required: true,
    },
    {
        id: "kyc",
        title: "Verification",
        description: "Verify your identity for secure transactions",
        completed: false,
        required: true,
    },
    {
        id: "bank",
        title: "Bank Account",
        description: "Link your bank account for seamless transactions",
        completed: false,
        required: true,
    },
    {
        id: "terms",
        title: "Terms & Agreement",
        description: "Review and accept the investment agreement",
        completed: false,
        required: true,
    },
];

export default function ExportOnboardingPage() {
    const router = useRouter();
    const [currentStepId, setCurrentStepId] = useState("profile");
    const [steps, setSteps] = useState<OnboardingStep[]>(ONBOARDING_STEPS);
    const [formData, setFormData] = useState<any>({});

    const currentStepIndex = steps.findIndex((s) => s.id === currentStepId);

    const markStepComplete = (stepId: string) => {
        setSteps((prev) =>
            prev.map((step) =>
                step.id === stepId ? { ...step, completed: true } : step
            )
        );
    };

    const handleNext = (stepData: any) => {
        // Save step data
        setFormData((prev: any) => ({ ...prev, ...stepData }));

        // Mark current step as complete
        markStepComplete(currentStepId);

        // Move to next step
        const nextIndex = currentStepIndex + 1;
        if (nextIndex < steps.length) {
            setCurrentStepId(steps[nextIndex].id);
        } else {
            // All steps complete - submit onboarding
            handleSubmit({ ...formData, ...stepData });
        }
    };

    const handleBack = () => {
        const prevIndex = currentStepIndex - 1;
        if (prevIndex >= 0) {
            setCurrentStepId(steps[prevIndex].id);
        }
    };

    const handleSubmit = async (finalData: any) => {
        try {
            const result = await submitExportOnboardingAction(finalData);

            if (result.success) {
                // Successfully submitted - redirect to pending page
                router.push("/export/onboarding/pending");
            } else {
                // Handle error
                console.error("Onboarding submission failed:", result.error);
                alert(`Failed to submit: ${result.error}`);
            }
        } catch (error) {
            console.error("Error submitting onboarding:", error);
            alert("An error occurred. Please try again.");
        }
    };

    const renderCurrentStep = () => {
        switch (currentStepId) {
            case "profile":
                return (
                    <InvestmentProfileStep
                        onNext={handleNext}
                        initialData={formData.profile}
                    />
                );
            case "kyc":
                return (
                    <KYCVerificationStep
                        onNext={handleNext}
                        onBack={handleBack}
                        initialData={formData.kyc}
                    />
                );
            case "bank":
                return (
                    <BankAccountStep
                        onNext={handleNext}
                        onBack={handleBack}
                        initialData={formData.bank}
                    />
                );
            case "terms":
                return (
                    <TermsAcceptanceStep
                        onNext={handleNext}
                        onBack={handleBack}
                        initialData={formData.terms}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <OnboardingLayout
            serviceName="Export Windows"
            serviceIcon={<Package className="w-6 h-6" />}
            currentStep={currentStepIndex + 1}
            totalSteps={steps.length}
            backUrl="/export"
        >
            {/* Step Indicator */}
            <StepIndicator steps={steps} currentStepId={currentStepId} />

            {/* Current Step Content */}
            <div className="mt-8">{renderCurrentStep()}</div>

            {/* Benefits Reminder */}
            <div className="mt-12 bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-lg p-6">
                <h3 className="font-semibold text-orange-900 dark:text-orange-100 mb-4 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    Why Verify Your Account?
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-start gap-2">
                        <TrendingUp className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="font-medium text-orange-900 dark:text-orange-100">
                                Higher Returns
                            </p>
                            <p className="text-orange-700 dark:text-orange-300">
                                Access premium export opportunities with 18-22% ROI
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Shield className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="font-medium text-orange-900 dark:text-orange-100">
                                Secure Escrow
                            </p>
                            <p className="text-orange-700 dark:text-orange-300">
                                Your funds are protected with professional escrow services
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Package className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="font-medium text-orange-900 dark:text-orange-100">
                                Verified Contracts
                            </p>
                            <p className="text-orange-700 dark:text-orange-300">
                                All export contracts are thoroughly vetted and verified
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </OnboardingLayout>
    );
}
