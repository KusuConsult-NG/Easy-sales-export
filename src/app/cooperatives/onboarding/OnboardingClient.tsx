/**
 * Cooperative Membership Onboarding
 * 
 * Main onboarding flow orchestrator
 */

"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerCooperativeMemberAction } from "@/app/actions/cooperative";
import { CooperativeErrorBoundary } from "@/components/errors/CooperativeErrorBoundary";
import { useToast } from "@/contexts/ToastContext";

// Steps
import PersonalInfoStep from "./steps/PersonalInfoStep";
import NextOfKinStep from "./steps/NextOfKinStep";
import DocumentUploadStep from "./steps/DocumentUploadStep";
import { getMembershipAction, checkCooperativeStatusAction } from "@/app/actions/cooperative";
import { Loader2 } from "lucide-react";

function CooperativeOnboardingContent({ initialTier }: { initialTier: "basic" | "premium" }) {
    const router = useRouter();
    const { showToast } = useToast();
    const [currentStep, setCurrentStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(false); // No longer loading initially

    // Use prop for tier
    const [tier] = useState<"basic" | "premium">(initialTier);

    const [personalInfo, setPersonalInfo] = useState({
        fullName: "",
        phone: "",
        email: "",
        dateOfBirth: "",
        gender: "",
        occupation: "",
        address: {
            state: "",
            lga: "",
            street: ""
        }
    });

    const [nextOfKin, setNextOfKin] = useState({
        fullName: "",
        relationship: "",
        phone: "",
        address: ""
    });

    const [documents, setDocuments] = useState({
        validId: undefined as { name: string; url: string } | undefined,
        passportPhoto: undefined as { name: string; url: string } | undefined,
        proofOfAddress: undefined as { name: string; url: string } | undefined,
        bvn: ""
    });

    const totalSteps = 3;

    const steps = [
        { number: 1, name: "Personal Info" },
        { number: 2, name: "Next of Kin" },
        { number: 3, name: "Documents" },
    ];

    const handleComplete = async () => {
        setIsSubmitting(true);
        try {
            const formData = new FormData();

            // Tier (From Server, verified)
            formData.append("membershipTier", tier);

            // Personal Info
            const nameParts = personalInfo.fullName.trim().split(" ");
            const firstName = nameParts[0] || "";
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : firstName; // Fallback if single name

            formData.append("firstName", firstName);
            formData.append("lastName", lastName);
            formData.append("dateOfBirth", personalInfo.dateOfBirth);
            formData.append("gender", personalInfo.gender);
            formData.append("email", personalInfo.email);
            formData.append("phone", personalInfo.phone);
            formData.append("occupation", personalInfo.occupation);

            // Address Mapping
            formData.append("stateOfOrigin", personalInfo.address.state);
            formData.append("lga", personalInfo.address.lga || "N/A");
            formData.append("residentialAddress", personalInfo.address.street);

            // Next of Kin
            formData.append("nextOfKinName", nextOfKin.fullName);
            formData.append("nextOfKinPhone", nextOfKin.phone);
            formData.append("nextOfKinAddress", nextOfKin.address);

            // Documents (uploaded to Firebase Storage)
            if (documents.validId?.url) {
                formData.append("validIdUrl", documents.validId.url);
                formData.append("validIdName", documents.validId.name);
            }
            if (documents.passportPhoto?.url) {
                formData.append("passportPhotoUrl", documents.passportPhoto.url);
                formData.append("passportPhotoName", documents.passportPhoto.name);
            }
            if (documents.proofOfAddress?.url) {
                formData.append("proofOfAddressUrl", documents.proofOfAddress.url);
                formData.append("proofOfAddressName", documents.proofOfAddress.name);
            }

            // BVN
            if (documents.bvn) {
                formData.append("bvn", documents.bvn);
            }

            // Call Server Action
            const result = await registerCooperativeMemberAction(formData);

            if (result.success) {
                showToast("Application submitted successfully!", "success");
                // Redirect to pending page
                router.push("/cooperatives/onboarding/pending");
            } else {
                showToast(result.error || "Registration failed. Please try again.", "error");
                setIsSubmitting(false);
            }
        } catch (error) {
            logger.error("Registration error:", error);
            showToast("An unexpected error occurred.", "error");
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-8 py-6">
                    <Link
                        href="/cooperatives"
                        className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Cooperatives
                    </Link>
                    <h1 className="text-2xl font-bold text-slate-900">
                        Cooperative Membership Application
                    </h1>
                    <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                        <span>Powered by</span>
                        <span className="font-bold text-purple-600">Easy Sales Export</span>
                    </div>
                </div>
            </div>

            {/* Progress Indicator */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-8 py-6">
                    <div className="flex items-center justify-between mb-4">
                        {steps.map((step, index) => (
                            <div key={step.number} className="flex items-center flex-1">
                                <div className="flex flex-col items-center flex-1">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${currentStep > step.number
                                        ? "bg-purple-600 text-white"
                                        : currentStep === step.number
                                            ? "bg-purple-600 text-white ring-4 ring-purple-200"
                                            : "bg-slate-200 text-slate-600"
                                        }`}>
                                        {step.number}
                                    </div>
                                    <span className={`text-xs mt-2 font-medium ${currentStep === step.number
                                        ? "text-purple-600"
                                        : "text-slate-600"
                                        }`}>
                                        {step.name}
                                    </span>
                                </div>
                                {index < steps.length - 1 && (
                                    <div className={`h-0.5 flex-1 mx-2 ${currentStep > step.number
                                        ? "bg-purple-600"
                                        : "bg-slate-200"
                                        }`} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="text-center">
                        <p className="text-sm text-slate-600">
                            Step {currentStep} of {totalSteps}
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-8 py-12">
                {isLoading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                    </div>
                ) : (
                    <>
                        {currentStep === 1 && (
                            <PersonalInfoStep
                                data={personalInfo}
                                onChange={setPersonalInfo}
                                onNext={() => setCurrentStep(2)}
                                onBack={() => router.push("/cooperatives")} // Back to dashboard/hub
                            />
                        )}
                        {currentStep === 2 && (
                            <NextOfKinStep
                                data={nextOfKin}
                                onChange={setNextOfKin}
                                onNext={() => setCurrentStep(3)}
                                onBack={() => setCurrentStep(1)}
                            />
                        )}
                        {currentStep === 3 && (
                            <DocumentUploadStep
                                data={documents}
                                onChange={setDocuments}
                                onNext={handleComplete}
                                onBack={() => setCurrentStep(2)}
                                isSubmitting={isSubmitting} // Pass submitting state to final step
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

// Wrap with error boundary
export default function CooperativeOnboardingClient({ initialTier }: { initialTier: "basic" | "premium" }) {
    return (
        <CooperativeErrorBoundary>
            <CooperativeOnboardingContent initialTier={initialTier} />
        </CooperativeErrorBoundary>
    );
}
