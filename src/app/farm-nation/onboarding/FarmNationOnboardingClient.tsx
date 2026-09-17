"use client";

import { useState, useEffect } from "react";
import { restoredStepId } from "@/lib/draft-step";
import { z } from "zod";
import { logger } from '@/lib/logger';
import { staleSubmitAdvice } from "@/lib/stale-deployment-recovery";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Home, TrendingUp, Shield, CheckCircle, ArrowLeft, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import { submitFarmNationOnboardingAction, checkFarmNationStatusAction, getFarmNationApplicationAction, resubmitFarmNationApplicationAction, checkFarmNationAccessAction } from "@/app/actions/farm-nation";
import { useServerSeed } from "@/hooks/useServerSeed";

// Step components (to be created)
import RoleSelectionStep from "./steps/RoleSelectionStep";
import ProfileStep from "./steps/ProfileStep";
import InterestsStep from "./steps/InterestsStep";
import TermsStep from "./steps/TermsStep";
import { FormHomeButton } from "@/components/forms/FormNavButtons";

//   #790 One rule for where a submitted application goes, shared with the
//   gate above it — see lib/onboarding-destination.
import { onboardingDestination } from "@/lib/onboarding-destination";
import ListLoadFailed from "@/components/common/ListLoadFailed";

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

export default function FarmNationOnboardingClient({ initial = null }: {
    /**
     *   #555 The status check that GATES this wizard, already made.
     *
     *   Only that first check. Everything the effect does with it — the
     *   pending/approved/edit-mode branching, the redirects, the conditional
     *   verification read behind `?edit=true` — stays in the client. Moving the
     *   REDIRECTS to the server would change how an onboarding flow behaves,
     *   which is a different decision from removing a round trip.
     */
    initial?: Awaited<ReturnType<typeof checkFarmNationStatusAction>> | null;
}) {
    const takeSeed = useServerSeed(initial);
    const router = useRouter();
    const { data: session, status } = useSession();
    const { showToast } = useToast();
    const [currentStepId, setCurrentStepId] = useState("role");
    //   #793 The read failed, as distinct from finding nothing.
    const [loadFailed, setLoadFailed] = useState(false);
    const [steps, setSteps] = useState<OnboardingStep[]>(ONBOARDING_STEPS);
    const [formData, setFormData] = useState<any>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isRevisionMode, setIsRevisionMode] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [rejectionReason, setRejectionReason] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Check existing application status on mount
    useEffect(() => {
        // SESSION CRASH FIX: do not run until NextAuth has finished loading.
        // Without this guard, checkFarmNationStatusAction() fires before requireSession()
        // can resolve the session cookie, causing a silent auth failure.
        if (status === "loading") return;

        const checkStatus = async () => {
            try {
                const result = takeSeed() ?? await checkFarmNationStatusAction();
                if (result.success) {
                    const status = result.data;
                    if (status === "pending" || status === "under_review") {
                        const params = new URLSearchParams(window.location.search);
                        const isEditParam = params.get("edit") === "true";

                        if (isEditParam) {
                            const result = await getFarmNationApplicationAction();
                            if (!result.success) {
                                //   #793 The read FAILED. Entering edit mode now
                                //   would present a blank form as her application.
                                setLoadFailed(true); setIsLoading(false); return;
                            }
                            if (result.success && result.data?.application) {
                                setFormData((prev: any) => ({ ...prev, ...result.data.application }));
                            }
                            setIsEditMode(true);
                            setIsLoading(false);
                        } else {
                            /*
                             *   #790 "PENDING" AND FULLY ADMITTED AT THE SAME TIME.
                             *
                             *   This sent every member whose status reads pending
                             *   to a screen saying she is waiting for approval —
                             *   but Farm Nation's submit grants `farmer` or
                             *   `investor` there and then, and those roles admit
                             *   her at Layer 1 of checkModuleAccess. So the same
                             *   person was inside the module through one door and
                             *   told she was queuing at another.
                             *
                             *   The gate asks what the member area will actually
                             *   allow, which is the one answer that cannot bounce.
                             */
                            const access = await checkFarmNationAccessAction().catch(() => null);
                            //   #790 A FAILED ACCESS CHECK IS NOT A "NO".
                            //   Swallowing it would route an APPROVED member to a
                            //   screen saying she is pending — #786's class, where
                            //   a query that failed is presented as a legitimate
                            //   empty answer. The pending page is still the safe
                            //   landing (it has a way home, and her next visit
                            //   re-asks), but the failure is recorded not dropped.
                            if (!access?.success) logger.error("[farm-nation onboarding] access check failed", { reason: access?.error });
                            router.replace(onboardingDestination("farm-nation", {
                                hasAccess: !!(access?.success && access.data),
                            }));
                        }
                    } else if (status === "approved" || status === "active") {
                        const hasAccessResult = await checkFarmNationAccessAction();
                        setIsLoading(false); // Let form load cleanly without bouncing
                        if (hasAccessResult.success && hasAccessResult.data) {
                            router.replace("/farm-nation/properties");
                        }
                    } else if (status === "rejected" || status === "revision_required") {
                        const result = await getFarmNationApplicationAction();
                        /*
                         *   #795 THE SAME BRANCH AGAIN, AND #793 REACHED ONE OF THEM.
                         *
                         *   #793 guarded the EDIT branch of each form and stopped
                         *   there. Every form reads its application in two or three
                         *   branches, so six of fourteen reads were guarded and eight
                         *   were not — my own fix being the defect it was about.
                         *
                         *   And the branch it missed is the worse one: REVISION. A
                         *   member told to correct a rejected application, handed a
                         *   blank form, resubmits blank over the record she was
                         *   fixing.
                         */
                        if (!result.success) { setLoadFailed(true); setIsLoading(false); return; }
                        if (result.success && result.data?.application) {
                            setFormData((prev: any) => ({ ...prev, ...result.data.application }));
                        }
                        if (result.data?.rejectionReason) setRejectionReason(result.data.rejectionReason);
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
                                    //   #625 — see draft-step. An unknown id
                                    //   rendered an empty card here too.
                                    const savedStep = restoredStepId(parsed.step, ONBOARDING_STEPS.map(s => s.id));
                                    if (savedStep !== null) setCurrentStepId(savedStep);
                                }
                            } catch { /* non-blocking */ }
                        }
                        setIsLoading(false);
                    }
                } else {
                    setIsLoading(false);
                }
            } catch (error) {
                logger.error("Failed to check Farm Nation status:", error);
                setIsLoading(false);
            }
        };
        checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]); // re-run once session transitions from "loading" → "authenticated"

    /*
     *   #793 A FAILED READ IS NOT AN EMPTY APPLICATION.
     *
     *   #588 established this exact rule for LISTS and swept thirty-six screens
     *   with it — "a refusal and an empty result collapsed into one branch". It
     *   was never applied to the FORMS, where the same collapse costs more: the
     *   edit path read the member's existing application, prefilled on success,
     *   and entered edit mode REGARDLESS. So a failed read handed her a BLANK
     *   form presented as an edit of the application she had already filled in.
     *
     *   She then re-types it, or submits it missing the fields she cannot see —
     *   which is the owner's report, "details added to the form and some are
     *   missing in the process of submission".
     */
    if (loadFailed) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
                <div className="w-full max-w-lg space-y-4">
                    <ListLoadFailed
                        what="your onboarding details"
                        onRetry={() => window.location.reload()}
                    />
                    <div className="flex justify-center">
                        <FormHomeButton />
                    </div>
                </div>
            </div>
        );
    }

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

    
    function handleStepChange(stepData: any) {
        setFormData((prev: any) => {
            const next = { ...prev, ...stepData };
            if (!isRevisionMode) {
                const userId = session?.user?.id;
                if (userId) {
                    try { localStorage.setItem(`farmnation_draft_${userId}`, JSON.stringify({ step: currentStepId, data: next })); } catch { /* non-blocking */ }
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

    function handleBack() {
        const prevIndex = currentStepIndex - 1;
        if (prevIndex >= 0) {
            setCurrentStepId(steps[prevIndex].id);
        }
    };

    async function handleSubmit(finalData: any) {
        // ── Pre-submission Zod Guard ───────────────────────────────────────────
        const farmNationOnboardingSchema = z.object({
            role: z.enum(["buyer", "seller", "both"], {
                message: "Please select an account type before submitting.",
            }),
            profile: z.object({
                firstName: z.string().trim().min(2, "First name must be at least 2 characters."),
                lastName: z.string().trim().min(2, "Last name must be at least 2 characters."),
                phone: z.string().trim().min(5, "Phone number is required."),
                state: z.string().trim().min(1, "State is required."),
                lga: z.string().trim().min(1, "LGA is required."),
                address: z.string().trim().min(5, "Address is required."),
                // optional flat fields
                otherName: z.string().optional(),
                businessName: z.string().optional(),
                fullName: z.string().optional(),
                // legacy nested location (for revision mode pre-filled data)
                location: z.object({
                    state: z.string().optional(),
                    lga: z.string().optional(),
                }).optional(),
            }, { message: "Profile details are required." }),
            interests: z.object({
                propertyTypes: z.array(z.string()).optional(),
                budgetRange: z.string().optional(),
                preferredSize: z.string().optional(),
                listingTypes: z.array(z.string()).optional(),
                totalAcreage: z.string().optional(),
                readyToList: z.boolean().optional(),
                farmLocation: z.string().optional(),
                latitude: z.string().optional(),
                longitude: z.string().optional(),
                farmDocuments: z.array(z.string()).optional(),
            }).optional().nullable(),
            terms: z.object({
                termsAccepted: z.boolean().refine(val => val === true, {
                    message: "You must accept the Terms of Service.",
                }),
                privacyAccepted: z.boolean().refine(val => val === true, {
                    message: "You must accept the Privacy Policy.",
                }),
                feeDisclosureAccepted: z.boolean().refine(val => val === true, {
                    message: "You must accept the Fee Disclosure.",
                }),
            }, { message: "You must accept all terms to continue." }),
        });

        const validation = farmNationOnboardingSchema.safeParse(finalData);
        if (!validation.success) {
            const firstError = validation.error.issues[0];
            const errorPath = firstError.path;
            
            // Map the error path back to step ID
            if (errorPath[0] === "role") {
                setCurrentStepId("role");
            } else if (errorPath[0] === "profile") {
                setCurrentStepId("profile");
            } else if (errorPath[0] === "interests") {
                setCurrentStepId("interests");
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
                const result = await resubmitFarmNationApplicationAction(finalData);
                if (result.success) {
                    showToast(isEditMode ? "Application updated successfully!" : "Application resubmitted for review!", "success");
                    setIsSubmitting(false);
                    //   #790 The resubmit path, same rule — see the submit
                    //   handler below and lib/onboarding-destination.
                    const reAccess = await checkFarmNationAccessAction().catch(() => null);
                    if (!reAccess?.success) logger.error("[farm-nation onboarding] access check failed after resubmit", { reason: reAccess?.error });
                    router.push(onboardingDestination("farm-nation", {
                        hasAccess: !!(reAccess?.success && reAccess.data),
                    }));
                } else {
                    showToast(result.error || "Failed to submit updates", "error");
                    setIsSubmitting(false);
                }
                return;
            }

            const result = await submitFarmNationOnboardingAction(finalData);
            if (result.success) {
                // Clear draft on success
                const userId = session?.user?.id;
                if (userId) { try { localStorage.removeItem(`farmnation_draft_${userId}`); } catch { /* non-blocking */ } }
                showToast("Onboarding completed successfully!", "success");
                setIsSubmitting(false);
                /*
                 *   #790 Farm Nation grants `farmer`/`investor` AT SUBMIT, and
                 *   those roles admit her at Layer 1 — so she really is
                 *   auto-approved and the dashboard really is right for her.
                 *   It is asked rather than assumed because the record says
                 *   "pending" at the same moment, and the two have to agree
                 *   about where she goes.
                 */
                const access = await checkFarmNationAccessAction().catch(() => null);
                if (!access?.success) logger.error("[farm-nation onboarding] access check failed after submit", { reason: access?.error });
                router.push(onboardingDestination("farm-nation", {
                    hasAccess: !!(access?.success && access.data),
                }));
            } else {
                showToast(result.error || "Failed to complete onboarding", "error");
                setIsSubmitting(false);
            }
        } catch (error) {
            logger.error("Error submitting onboarding:", error);
            //   #855 — a stale action id reaches this catch and no error
            //   boundary, so the advice has to be correct HERE.
            showToast(staleSubmitAdvice(error)
                ?? "An error occurred. Please try again.", "error");
            setIsSubmitting(false);
        }
    };

    const renderCurrentStep = () => {
        switch (currentStepId) {
            case "role":
                return (
                    <RoleSelectionStep
                        onNext={handleNext}
                        onChange={handleStepChange}
                        initialData={formData.role}
                    />
                );
            case "profile":
                return (
                    <ProfileStep
                        onNext={handleNext}
                        onBack={handleBack}
                        onChange={handleStepChange}
                        initialData={formData.profile}
                    />
                );
            case "interests":
                return (
                    <InterestsStep
                        onNext={handleNext}
                        onBack={handleBack}
                        onChange={handleStepChange}
                        initialData={formData.interests}
                        role={formData.role}
                    />
                );
            case "terms":
                return (
                    <TermsStep
                        onNext={handleNext}
                        onBack={handleBack}
                        onChange={handleStepChange}
                        initialData={formData.terms}
                        isSubmitting={isSubmitting}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div style={{ background: "linear-gradient(to right, #0d9488, #0891b2)" }} className="text-white py-6 px-4 md:px-8">
                <div className="max-w-4xl mx-auto">
                    <div className="flex items-center justify-between mb-3">
                        {/*   #777 Home beside Back, at the top left, as asked. */}
                        <div className="flex items-center gap-1">
                            <FormHomeButton className="text-teal-100! hover:text-white! hover:bg-white/10!" />
                            <Link
                                href="/farm-nation"
                                className="inline-flex items-center gap-2 text-teal-100 hover:text-white text-sm font-medium transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Back
                            </Link>
                        </div>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center gap-2 text-teal-100 hover:text-white text-sm font-medium transition-colors"
                        >
                            <Home className="w-4 h-4" />
                            Dashboard
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
                                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-colors ${(step.completed || index < currentStepIndex)
                                        ? "bg-teal-600 text-white"
                                        : index === currentStepIndex
                                            ? "bg-teal-100 text-teal-600 border-2 border-teal-600"
                                            : "bg-slate-200 text-slate-500"
                                        }`}
                                >
                                    {(step.completed || index < currentStepIndex) ? (
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
                                    className={`flex-1 h-1 mx-2 ${(step.completed || index < currentStepIndex)
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
