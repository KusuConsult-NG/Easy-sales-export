"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Home, TrendingUp, Shield, CheckCircle, ArrowLeft, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import { submitFarmNationOnboardingAction, checkFarmNationStatusAction, getFarmNationApplicationAction, resubmitFarmNationApplicationAction } from "@/app/actions/farm-nation";

// Step components (to be created)
import RoleSelectionStep from "./steps/RoleSelectionStep";
import ProfileStep from "./steps/ProfileStep";
import InterestsStep from "./steps/InterestsStep";
import TermsStep from "./steps/TermsStep";

type RoleType = "buyer" | "seller" | "both";

interface OnboardingStep {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    required: boolean;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        id: "role",
        title: "Account Type",
        description: "Choose how you want to use Farm Nation",
        completed: false,
        required: true,
    },
    {
        id: "profile",
        title: "Profile & Location",
        description: "Tell us about yourself and your location",
        completed: false,
        required: true,
    },
    {
        id: "interests",
        title: "Preferences",
        description: "Your property interests and goals",
        completed: false,
        required: true,
    },
    {
        id: "terms",
        title: "Terms & Agreement",
        description: "Review and accept platform terms",
        completed: false,
        required: true,
    },
];

export default function FarmNationOnboardingPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [currentStepId, setCurrentStepId] = useState("role");
    const [steps, setSteps] = useState<OnboardingStep[]>(ONBOARDING_STEPS);
    const [formData, setFormData] = useState<any>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isRevisionMode, setIsRevisionMode] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [rejectionReason, setRejectionReason] = useState<string | null>(null);

    // Check existing application status on mount
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await checkFarmNationStatusAction();
                if (status === "pending" || status === "under_review") {
                    const params = new URLSearchParams(window.location.search);
                    const isEditParam = params.get("edit") === "true";

                    if (isEditParam) {
                        const result = await getFarmNationApplicationAction();
                        if (result.success && result.data) {
                            setFormData((prev: any) => ({ ...prev, ...result.data }));
                        }
                        setIsEditMode(true);
                        setIsLoading(false);
                    } else {
                        router.replace("/farm-nation/onboarding/pending");
                    }
                } else if (status === "approved" || status === "active") {
                    router.replace("/farm-nation/properties");
                } else if (status === "rejected" || status === "revision_required") {
                    const result = await getFarmNationApplicationAction();
                    if (result.success && result.data) {
                        setFormData((prev: any) => ({ ...prev, ...result.data }));
                    }
                    if (result.rejectionReason) setRejectionReason(result.rejectionReason);
                    setIsRevisionMode(true);
                    setIsLoading(false);
                } else {
                    // Restore draft from localStorage for fresh applicants
                    const userId = session?.user?.id;
                    if (userId) {
                        try {
                            const saved = localStorage.getItem(`farmnation_draft_${userId}`);
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
                logger.error("Failed to check Farm Nation status:", error);
                setIsLoading(false);
            }
        };
        checkStatus();
    }, [router, session?.user?.id]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
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
            if (!isRevisionMode) {
                const userId = session?.user?.id;
                if (userId) {
                    try { localStorage.setItem(`farmnation_draft_${userId}`, JSON.stringify({ step: nextStepId, data: next })); } catch { /* non-blocking */ }
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
            if (isRevisionMode || isEditMode) {
                const result = await resubmitFarmNationApplicationAction(finalData);
                if (result.success) {
                    showToast(isEditMode ? "Application updated successfully!" : "Application resubmitted for review!", "success");
                    router.push("/farm-nation/onboarding/pending");
                } else {
                    showToast(result.error || "Failed to submit updates", "error");
                }
                return;
            }

            const result = await submitFarmNationOnboardingAction(finalData);
            if (result.success) {
                // Clear draft on success
                const userId = session?.user?.id;
                if (userId) { try { localStorage.removeItem(`farmnation_draft_${userId}`); } catch { /* non-blocking */ } }
                showToast("Onboarding completed successfully!", "success");
                if (finalData.role === "seller" || finalData.role === "both") {
                    router.push("/farm-nation/list-land");
                } else {
                    router.push("/farm-nation/properties");
                }
            } else {
                showToast(result.error || "Failed to complete onboarding", "error");
            }
        } catch (error) {
            logger.error("Error submitting onboarding:", error);
            showToast("An error occurred. Please try again.", "error");
        }
    };

    const renderCurrentStep = () => {
        switch (currentStepId) {
            case "role":
                return (
                    <RoleSelectionStep
                        onNext={handleNext}
                        initialData={formData.role}
                    />
                );
            case "profile":
                return (
                    <ProfileStep
                        onNext={handleNext}
                        onBack={handleBack}
                        initialData={formData.profile}
                    />
                );
            case "interests":
                return (
                    <InterestsStep
                        onNext={handleNext}
                        onBack={handleBack}
                        initialData={formData.interests}
                        role={formData.role}
                    />
                );
            case "terms":
                return (
                    <TermsStep
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
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-linear-to-r from-teal-600 to-cyan-600 text-white py-6 px-4 md:px-8">
                <div className="max-w-4xl mx-auto">
                    <div className="flex items-center justify-between mb-3">
                        <Link
                            href="/farm-nation"
                            className="inline-flex items-center gap-2 text-teal-100 hover:text-white text-sm font-medium transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center gap-2 text-teal-100 hover:text-white text-sm font-medium transition-colors"
                        >
                            <Home className="w-4 h-4" />
                            Hub
                        </Link>
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-2xl md:text-3xl font-bold">Farm Nation Onboarding</h1>
                    </div>
                    <p className="text-teal-100">
                        Step {currentStepIndex + 1} of {steps.length}
                    </p>
                </div>
            </div>

            {/* Step Indicator */}
            <div className="max-w-4xl mx-auto px-4 md:px-8 py-6">
                <div className="flex items-center justify-between">
                    {steps.map((step, index) => (
                        <div key={step.id} className="flex items-center flex-1">
                            <div className="flex flex-col items-center">
                                <div
                                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-colors ${step.completed
                                        ? "bg-teal-600 text-white"
                                        : index === currentStepIndex
                                            ? "bg-teal-100 text-teal-600 border-2 border-teal-600"
                                            : "bg-slate-200 text-slate-500"
                                        }`}
                                >
                                    {step.completed ? (
                                        <CheckCircle className="w-5 h-5" />
                                    ) : (
                                        index + 1
                                    )}
                                </div>
                                <div className="mt-2 text-center hidden md:block">
                                    <p className="text-xs font-medium text-slate-900">
                                        {step.title}
                                    </p>
                                </div>
                            </div>
                            {index < steps.length - 1 && (
                                <div
                                    className={`flex-1 h-1 mx-2 ${step.completed
                                        ? "bg-teal-600"
                                        : "bg-slate-200"
                                        }`}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Current Step Content */}
            <div className="max-w-4xl mx-auto px-4 md:px-8 py-8">
                {/* Rejection / Revision Banner */}
                {isRevisionMode && (
                    <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-amber-900">Your application requires updates</p>
                            {rejectionReason && <p className="text-sm text-amber-700 mt-1">{rejectionReason}</p>}
                            <p className="text-xs text-amber-600 mt-1">Update your details below and resubmit.</p>
                        </div>
                    </div>
                )}

                {/* Editing Banner */}
                {isEditMode && !isRevisionMode && (
                    <div className="mb-6 p-4 bg-blue-50 border border-blue-300 rounded-xl flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-blue-900">Editing Application</p>
                            <p className="text-sm text-blue-700 mt-1">You are modifying a submitted application. Your changes will be saved when you complete the form.</p>
                        </div>
                    </div>
                )}
                <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8">
                    {renderCurrentStep()}
                </div>

                {/* Benefits Reminder */}
                <div className="mt-8 bg-teal-50 border border-teal-200 rounded-lg p-6">
                    <h3 className="font-semibold text-teal-900 mb-4 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5" />
                        Why Complete Your Profile?
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div className="flex items-start gap-2">
                            <TrendingUp className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium text-teal-900">
                                    Better Matches
                                </p>
                                <p className="text-teal-700">
                                    Get property recommendations tailored to your needs
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-2">
                            <Shield className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium text-teal-900">
                                    Verified Listings
                                </p>
                                <p className="text-teal-700">
                                    Access to verified agricultural properties nationwide
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-2">
                            <Home className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium text-teal-900">
                                    Secure Transactions
                                </p>
                                <p className="text-teal-700">
                                    Protected by escrow and legal documentation
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
