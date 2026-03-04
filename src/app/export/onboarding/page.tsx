/**
 * Export Windows Onboarding - Main Page
 * 
 * Multi-step onboarding flow for Export Windows service
 */

"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Package, TrendingUp, Shield, CheckCircle, AlertTriangle } from "lucide-react";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { useToast } from "@/contexts/ToastContext";
import { OnboardingStep } from "@/types/service-registration";

import { submitExportOnboardingAction, checkExportStatusAction, getExportApplicationAction, resubmitExportApplicationAction } from "@/app/actions/export";

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
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [currentStepId, setCurrentStepId] = useState("profile");
    const [steps, setSteps] = useState<OnboardingStep[]>(ONBOARDING_STEPS);
    const [formData, setFormData] = useState<any>({});
    const [isLoading, setIsLoading] = useState(true);
    const [revisionNote, setRevisionNote] = useState<string | null>(null);
    const [isRevisionMode, setIsRevisionMode] = useState(false);

    // Check existing application status on mount
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await checkExportStatusAction();
                if (status === "pending_approval" || status === "pending" || status === "under_review") {
                    router.replace("/export/onboarding/pending");
                } else if (status === "approved" || status === "active") {
                    router.replace("/export/dashboard");
                } else if (status === "revision_required" || status === "rejected") {
                    const result = await getExportApplicationAction();
                    if (result.success && result.data) {
                        setFormData((prev: any) => ({ ...prev, ...result.data }));
                    }
                    if (result.revisionNote) setRevisionNote(result.revisionNote);
                    setIsRevisionMode(true);
                    setIsLoading(false);
                } else {
                    // Restore draft from localStorage for fresh applicants
                    const userId = session?.user?.id;
                    if (userId) {
                        try {
                            const saved = localStorage.getItem(`export_draft_${userId}`);
                            if (saved) {
                                const parsed = JSON.parse(saved);
                                if (parsed.data) setFormData(parsed.data);
                                if (parsed.step) setCurrentStepId(parsed.step);
                            }
                        } catch { /* non-blocking */ }
                    }
                    setIsLoading(false);
                }
            } catch (error) {
                logger.error("Failed to check export status:", error);
                setIsLoading(false);
            }
        };

        checkStatus();
    }, [router, session?.user?.id]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
            </div>
        );
    }

    const currentStepIndex = steps.findIndex((s) => s.id === currentStepId);

    const markStepComplete = (stepId: string) => {
        setSteps((prev) =>
            prev.map((step) =>
                step.id === stepId ? { ...step, completed: true } : step
            )
        );
    };

    const handleNext = (stepData: any) => {
        const next = { ...formData, ...stepData };
        setFormData(next);
        markStepComplete(currentStepId);

        const nextIndex = currentStepIndex + 1;
        if (nextIndex < steps.length) {
            const nextStepId = steps[nextIndex].id;
            setCurrentStepId(nextStepId);
            // Persist draft after every step (user-scoped key)
            if (!isRevisionMode) {
                const userId = session?.user?.id;
                if (userId) {
                    try { localStorage.setItem(`export_draft_${userId}`, JSON.stringify({ step: nextStepId, data: next })); } catch { /* non-blocking */ }
                }
            }
        } else {
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
            if (isRevisionMode) {
                // Resubmit — send text fields only (no file re-upload required)
                const result = await resubmitExportApplicationAction({
                    profile: finalData.profile,
                    kyc: finalData.kyc,
                    bank: finalData.bank,
                    terms: finalData.terms,
                });
                if (result.success) {
                    showToast("Application resubmitted for review!", "success");
                    router.push("/export/onboarding/pending");
                } else {
                    showToast(`Failed to resubmit: ${result.error}`, "error");
                }
                return;
            }

            const fd = new FormData();
            if (finalData.profile) fd.append("profile", JSON.stringify(finalData.profile));
            if (finalData.kyc?.kycData) fd.append("kycData", JSON.stringify(finalData.kyc.kycData));
            if (finalData.kyc?.documents?.idDocument) fd.append("idDocument", finalData.kyc.documents.idDocument);
            if (finalData.kyc?.documents?.proofOfAddress) fd.append("proofOfAddress", finalData.kyc.documents.proofOfAddress);
            if (finalData.bank) fd.append("bank", JSON.stringify(finalData.bank));
            if (finalData.terms) fd.append("terms", JSON.stringify(finalData.terms));

            const result = await submitExportOnboardingAction(null, fd);

            if (result.success) {
                // Clear draft on success
                const userId = session?.user?.id;
                if (userId) { try { localStorage.removeItem(`export_draft_${userId}`); } catch { /* non-blocking */ } }
                showToast("Onboarding submitted successfully!", "success");
                router.push("/export/onboarding/pending");
            } else {
                logger.error("Onboarding submission failed:", result.error);
                showToast(`Failed to submit: ${result.error}`, "error");
            }
        } catch (error) {
            logger.error("Error submitting onboarding:", error);
            showToast("An error occurred. Please try again.", "error");
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
            {/* Rejection / Revision Banner */}
            {isRevisionMode && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-amber-900">Your application requires updates</p>
                        {revisionNote && <p className="text-sm text-amber-700 mt-1">{revisionNote}</p>}
                        <p className="text-xs text-amber-600 mt-1">Review and update your details, then resubmit.</p>
                    </div>
                </div>
            )}

            {/* Step Indicator */}
            <StepIndicator steps={steps} currentStepId={currentStepId} />

            {/* Current Step Content */}
            <div className="mt-8">{renderCurrentStep()}</div>

            {/* Benefits Reminder */}
            <div className="mt-12 bg-orange-50 border border-orange-200 rounded-lg p-6">
                <h3 className="font-semibold text-orange-900 mb-4 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    Why Verify Your Account?
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-start gap-2">
                        <TrendingUp className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
                        <div>
                            <p className="font-medium text-orange-900">
                                Higher Returns
                            </p>
                            <p className="text-orange-700">
                                Access premium export opportunities with 18-22% ROI
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Shield className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
                        <div>
                            <p className="font-medium text-orange-900">
                                Secure Escrow
                            </p>
                            <p className="text-orange-700">
                                Your funds are protected with professional escrow services
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Package className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
                        <div>
                            <p className="font-medium text-orange-900">
                                Verified Contracts
                            </p>
                            <p className="text-orange-700">
                                All export contracts are thoroughly vetted and verified
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </OnboardingLayout>
    );
}
