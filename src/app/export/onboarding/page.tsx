/**
 * Export Windows Onboarding - Main Page
 * 
 * Multi-step onboarding flow for Export Windows service
 */

"use client";

import { useState, useEffect } from "react";
import { z } from "zod";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Package, TrendingUp, Shield, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useStorage } from "@/hooks/use-storage";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { useToast } from "@/contexts/ToastContext";
import { OnboardingStep } from "@/types/service-registration";

import { submitExportOnboardingAction, checkExportStatusAction, getExportApplicationAction, resubmitExportApplicationAction, checkExportAccessAction } from "@/app/actions/export";

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
    const { data: session, status } = useSession();
    const { showToast } = useToast();
    const { uploadFile, uploadState } = useStorage();
    const [isUploadingClient, setIsUploadingClient] = useState(false);
    const [filesUploading, setFilesUploading] = useState<{ file: File; field: string }[]>([]);
    const [currentStepId, setCurrentStepId] = useState("profile");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [steps, setSteps] = useState<OnboardingStep[]>(ONBOARDING_STEPS);
    const [formData, setFormData] = useState<any>({});
    const [isLoading, setIsLoading] = useState(true);
    const [revisionNote, setRevisionNote] = useState<string | null>(null);
    const [isRevisionMode, setIsRevisionMode] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);

    // Check existing application status on mount
    useEffect(() => {
        // SESSION CRASH FIX: do not run until NextAuth has finished loading.
        // Without this guard, checkExportStatusAction() fires before requireSession()
        // can resolve the session cookie, causing a silent auth failure and
        // setIsLoading(false) being called with no meaningful status check.
        if (status === "loading") return;

        const checkStatus = async () => {
            try {
                // Read ?edit=true parameter
                const params = new URLSearchParams(window.location.search);
                const isEditParam = params.get("edit") === "true";

                const status = await checkExportStatusAction();
                if (status === "pending_approval" || status === "pending" || status === "under_review") {
                    const params = new URLSearchParams(window.location.search);
                    const isEditParam = params.get("edit") === "true";

                    if (isEditParam) {
                        const result = await getExportApplicationAction();
                        if (result.success ) {
                            setFormData((prev: any) => ({ ...prev, ...result }));
                        }
                        setIsEditMode(true);
                        setIsLoading(false);
                    } else {
                        // Stay on page — do NOT auto-redirect pending users
                        // They can navigate to the pending status page themselves via a link
                        setIsLoading(false);
                    }
                } else if (status === "approved" || status === "active") {
                    const hasAccess = await checkExportAccessAction();
                    if (hasAccess) {
                        router.replace("/export/dashboard");
                    } else {
                        setIsLoading(false);
                    }
                } else if (status === "revision_required" || status === "rejected") {
                    const result = await getExportApplicationAction();
                    if (result.success ) {
                        setFormData((prev: any) => ({ ...prev, ...result }));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]); // re-run once session transitions from "loading" → "authenticated"

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

    
    function handleStepChange(stepData: any) {
        setFormData((prev: any) => {
            const next = { ...prev, ...stepData };
            if (!isRevisionMode) {
                const userId = session?.user?.id;
                if (userId) {
                    try { localStorage.setItem(`export_draft_${userId}`, JSON.stringify({ step: currentStepId, data: next })); } catch { /* non-blocking */ }
                }
            }
            return next;
        });
    };

    function handleNext(stepData: any) {
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

    function handleBack() {
        const prevIndex = currentStepIndex - 1;
        if (prevIndex >= 0) {
            setCurrentStepId(steps[prevIndex].id);
        }
    };

    async function handleSubmit(finalData: any) {
        // ── Pre-submission Zod Guard ───────────────────────────────────────────
        const exportOnboardingSchema = z.object({
            profile: z.object({
                minInvestment: z.number({ message: "Minimum investment amount is required." }),
                maxInvestment: z.number({ message: "Maximum investment amount is required." }),
                investmentGoals: z.array(z.string()).min(1, "At least one investment goal must be selected."),
                riskTolerance: z.enum(["low", "medium", "high"], { message: "Risk tolerance is required." }),
            }, { message: "Investment profile details are required." }),
            kyc: z.object({
                kycData: z.object({
                    firstName: z.string().trim().min(2, "First name must be at least 2 characters."),
                    lastName: z.string().trim().min(2, "Last name must be at least 2 characters."),
                    phoneNumber: z.string().trim().min(5, "Phone number is required."),
                    address: z.string().trim().min(5, "Address is required."),
                    city: z.string().trim().min(2, "City is required."),
                    state: z.string().trim().min(2, "State is required."),
                    ninVerified: z.boolean().refine(val => val === true, {
                        message: "Identity (NIN) must be verified."
                    }),
                    bvnVerified: z.boolean().refine(val => val === true, {
                        message: "BVN must be verified."
                    }),
                }, { message: "Identity verification details are required." })
            }, { message: "KYC verification details are required." }),
            bank: z.object({
                bankName: z.string().trim().min(1, "Bank name is required."),
                accountNumber: z.string().trim().length(10, "Account number must be exactly 10 digits."),
                accountName: z.string().trim().min(1, "Account name is required."),
                verified: z.boolean().refine(val => val === true, {
                    message: "Bank account must be verified."
                }),
            }, { message: "Bank account details are required." }),
            terms: z.object({
                accepted: z.boolean().optional(),
                agreedToTerms: z.boolean().optional(),
            }, { message: "Terms & conditions must be reviewed and accepted." }).refine(data => data.accepted === true || data.agreedToTerms === true, {
                message: "You must accept the terms and conditions.",
                path: ["accepted"]
            })
        });

        const validation = exportOnboardingSchema.safeParse(finalData);
        if (!validation.success) {
            const firstError = validation.error.issues[0];
            const errorPath = firstError.path;
            
            // Map the error path back to step ID
            if (errorPath[0] === "profile") {
                setCurrentStepId("profile");
            } else if (errorPath[0] === "kyc") {
                setCurrentStepId("kyc");
            } else if (errorPath[0] === "bank") {
                setCurrentStepId("bank");
            } else if (errorPath[0] === "terms") {
                setCurrentStepId("terms");
            }
            
            showToast(firstError.message, "error");
            return;
        }
        // ────────────────────────────────────────────────────────────────────────

        setIsSubmitting(true);
        try {
            if (isRevisionMode || isEditMode) {
                // Resubmit — send text fields only (no file re-upload required)
                const result = await resubmitExportApplicationAction({
                    profile: finalData.profile,
                    kyc: finalData.kyc,
                    bank: finalData.bank,
                    terms: finalData.terms,
                });
                if (result.success) {
                    showToast("Application resubmitted for review!", "success");
                    // STUCK BUTTON FIX: reset before navigating so button is never
                    // permanently disabled if navigation is slow or fails.
                    setIsSubmitting(false);
                    router.replace("/export/onboarding/pending");
                } else {
                    showToast(`Failed to resubmit: ${result.error}`, "error");
                    setIsSubmitting(false);
                }
                return;
            }

            let uploadedIdDocument = "";
            let uploadedProofOfAddress = "";
            
            const localFilesToUpload: { file: File; field: 'idDocument' | 'proofOfAddress' }[] = [];
            
            if (finalData.kyc?.documents?.idDocument instanceof File) {
                localFilesToUpload.push({
                    file: finalData.kyc.documents.idDocument,
                    field: 'idDocument'
                });
            } else if (typeof finalData.kyc?.documents?.idDocument === 'string') {
                uploadedIdDocument = finalData.kyc.documents.idDocument;
            }

            if (finalData.kyc?.documents?.proofOfAddress instanceof File) {
                localFilesToUpload.push({
                    file: finalData.kyc.documents.proofOfAddress,
                    field: 'proofOfAddress'
                });
            } else if (typeof finalData.kyc?.documents?.proofOfAddress === 'string') {
                uploadedProofOfAddress = finalData.kyc.documents.proofOfAddress;
            }

            if (localFilesToUpload.length > 0) {
                setFilesUploading(localFilesToUpload);
                setIsUploadingClient(true);
                try {
                    await Promise.all(
                        localFilesToUpload.map(async ({ file, field }) => {
                            const url = await uploadFile(file, `export-kyc/${session?.user?.id || 'anonymous'}/${field}_${Date.now()}`);
                            if (field === 'idDocument') uploadedIdDocument = url;
                            if (field === 'proofOfAddress') uploadedProofOfAddress = url;
                        })
                    );
                } catch (uploadErr) {
                    setIsUploadingClient(false);
                    setIsSubmitting(false);
                    throw uploadErr;
                } finally {
                    setIsUploadingClient(false);
                }
            }

            const fd = new FormData();
            if (finalData.profile) fd.append("profile", JSON.stringify(finalData.profile));
            if (finalData.kyc?.kycData) fd.append("kycData", JSON.stringify(finalData.kyc.kycData));
            
            if (uploadedIdDocument) fd.append("idDocument", uploadedIdDocument);
            if (uploadedProofOfAddress) fd.append("proofOfAddress", uploadedProofOfAddress);
            
            if (finalData.bank) fd.append("bank", JSON.stringify(finalData.bank));
            if (finalData.terms) fd.append("terms", JSON.stringify(finalData.terms));

            const result = await submitExportOnboardingAction(null, fd);

            if (result.success) {
                // Clear draft on success
                const userId = session?.user?.id;
                if (userId) { try { localStorage.removeItem(`export_draft_${userId}`); } catch { /* non-blocking */ } }
                showToast("Onboarding submitted successfully!", "success");
                // STUCK BUTTON FIX: reset before navigating so button is never
                // permanently disabled if navigation is slow or fails.
                setIsSubmitting(false);
                router.replace("/export/onboarding/pending");
            } else {
                logger.error("Onboarding submission failed:", result.error);
                showToast(`Failed to submit: ${result.error}`, "error");
                setIsSubmitting(false);
            }
        } catch (error) {
            logger.error("Error submitting onboarding:", error);
            showToast("An error occurred. Please try again.", "error");
            setIsSubmitting(false);
        }
    };

    const renderCurrentStep = () => {
        switch (currentStepId) {
            case "profile":
                return (
                    <InvestmentProfileStep
                        onNext={handleNext}
                        onChange={handleStepChange}
                        initialData={formData.profile}
                    />
                );
            case "kyc":
                return (
                    <KYCVerificationStep
                        onNext={handleNext}
                        onBack={handleBack}
                        onChange={handleStepChange}
                        initialData={formData.kyc}
                    />
                );
            case "bank":
                return (
                    <BankAccountStep
                        onNext={handleNext}
                        onBack={handleBack}
                        onChange={handleStepChange}
                        initialData={formData.bank}
                    />
                );
            case "terms":
                return (
                    <TermsAcceptanceStep
                        onNext={handleNext}
                        onBack={handleBack}
                        onChange={handleStepChange}
                        initialData={formData.terms}
                        // Disable submit while any file upload is still in flight
                        isSubmitting={isSubmitting || isUploadingClient}
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
            {isUploadingClient && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl space-y-6 text-center">
                        <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto animate-pulse">
                            <Loader2 className="w-8 h-8 text-orange-600 animate-spin" />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-xl font-bold text-slate-900">Uploading Verification Documents</h3>
                            <p className="text-sm text-slate-500">Please wait while we secure and upload your KYC documents to Cloudinary.</p>
                        </div>
                        <div className="space-y-4 text-left p-4 bg-slate-50 border border-slate-200 rounded-xl max-h-60 overflow-y-auto">
                            {filesUploading.map(({ file, field }) => {
                                const state = uploadState[file.name];
                                const progress = state?.progress ?? 0;
                                const error = state?.error ?? null;
                                return (
                                    <div key={file.name} className="space-y-1.5">
                                        <div className="flex justify-between text-xs font-semibold text-slate-700">
                                            <span className="truncate max-w-[200px] flex items-center gap-1">
                                                📄 {field === 'idDocument' ? 'ID Document' : 'Proof of Address'}
                                            </span>
                                            <span className={error ? "text-red-600" : "text-orange-600"}>
                                                {error ? "Failed" : progress === 100 ? "Completed" : `${Math.round(progress)}%`}
                                            </span>
                                        </div>
                                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-300 ${error ? "bg-red-500" : "bg-orange-600"}`}
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                        {error && <p className="text-[10px] text-red-500 font-medium">{error}</p>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
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

            {/* Edit Mode Banner */}
            {isEditMode && !isRevisionMode && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-300 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-blue-900">Editing Application</p>
                        <p className="text-sm text-blue-700 mt-1">You are currently editing your submitted application. Changes will be saved upon resubmission.</p>
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
                                Access verified export opportunities with competitive, contract-backed returns
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
