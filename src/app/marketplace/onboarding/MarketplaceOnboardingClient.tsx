/**
 * Marketplace Onboarding - Main Flow
 * 
 * 6-step onboarding with conditional branching:
 * - Buyers: Steps 1-4 (immediate access)
 * - Sellers: Steps 1-6 (verification required)
 * - Both: Steps 1-6 (seller verification)
 * 
 * SECURITY: Requires authentication before onboarding
 */

"use client";

import { useState, useEffect } from "react";
import { restoredStepIndex } from "@/lib/draft-step";
import { z } from "zod";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import OnboardingLayout from "@/components/shared/OnboardingLayout";
import { 
    checkMarketplaceStatusAction, 
    getSellerVerificationAction, 
    checkMarketplaceAccessAction, 
    resubmitSellerVerificationAction, 
    submitMarketplaceOnboardingAction 
} from "@/app/actions/marketplace";
import { useServerSeed } from "@/hooks/useServerSeed";
import StepIndicator from "@/components/shared/StepIndicator";
import AccountTypeStep from "./steps/AccountTypeStep";
import BusinessProfileStep from "./steps/BusinessProfileStep";
import ProductInterestsStep from "./steps/ProductInterestsStep";
import TermsStep from "./steps/TermsStep";
import BusinessVerificationStep from "./steps/BusinessVerificationStep";
import BankAccountStep from "./steps/BankAccountStep";

//   #790 One rule for where a submitted application goes, shared with the
//   gate above it — see lib/onboarding-destination.
import { onboardingDestination } from "@/lib/onboarding-destination";
import ListLoadFailed from "@/components/common/ListLoadFailed";
import { FormHomeButton } from "@/components/forms/FormNavButtons";

type AccountType = "buyer" | "seller" | "both";

interface OnboardingData {
    // Step 1: Account Type
    accountType: AccountType;
    sellerCategory?: "wholesale" | "retail"; // NEW: wholesale or retail

    // Step 2: Business Profile
    businessName: string;
    businessType: "individual" | "cooperative" | "company";
    phone: string;
    location: {
        state: string;
        lga: string;
        address: string;
    };

    // Step 3: Product Interests
    buyerInterests?: string[];
    orderVolume?: string;
    deliveryPreferences?: string[];
    sellerCategories?: string[];
    productionCapacity?: string;
    certifications?: string[];

    // Step 4: Terms
    termsAccepted: boolean;

    // Step 5: Business Verification (Sellers)
    documents?: {
        businessRegistration?: { name: string; url: string };
        cacNumber?: string;
        cacVerified?: boolean;
        companyName?: string;
        taxId?: string;
        tinVerified?: boolean;
        farmPhotos?: { name: string; url: string }[];
        productSamples?: { name: string; url: string }[];
    };

    // Step 6: Bank Account (Sellers)
    bankAccount?: {
        bankName: string;
        accountNumber: string;
        accountName: string;
    };
}

export default function MarketplaceOnboardingClient({ initial = null }: {
    /**
     *   #555 The status check that GATES this wizard, already made.
     *
     *   Only that first check. Everything the effect does with it — the
     *   pending/approved/edit-mode branching, the redirects, the conditional
     *   verification read behind `?edit=true` — stays in the client. Moving the
     *   REDIRECTS to the server would change how an onboarding flow behaves,
     *   which is a different decision from removing a round trip.
     */
    initial?: Awaited<ReturnType<typeof checkMarketplaceStatusAction>> | null;
}) {
    const takeSeed = useServerSeed(initial);
    const router = useRouter();
    const { data: session, status } = useSession();
    const [currentStep, setCurrentStep] = useState(1);
    //   #793 The read failed, as distinct from finding nothing.
    const [loadFailed, setLoadFailed] = useState(false);
    const [formData, setFormData] = useState<Partial<OnboardingData>>({});
    const [isRevisionMode, setIsRevisionMode] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [rejectionReason, setRejectionReason] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const userId = session?.user?.id;
    const DRAFT_KEY = userId ? `marketplace_draft_${userId}` : null;

    // AUTH GATE: Auth is now enforced server-side in layout.tsx.
    useEffect(() => {
        if (status === "loading") return;

        const checkStatus = async () => {
            try {
                const result = takeSeed() ?? await checkMarketplaceStatusAction();
                const marketplaceStatus = (result.success && result.data) ? result.data.status : null;
                const accountType = (result.success && result.data) ? result.data.accountType : null;

                if (marketplaceStatus === "pending" || marketplaceStatus === "under_review") {
                    const params = new URLSearchParams(window.location.search);
                    const isEditParam = params.get("edit") === "true";

                    if (isEditParam) {
                        const verif = await getSellerVerificationAction();
                        if (!verif.success) {
                            //   #793 The read FAILED. Entering edit mode now
                            //   would present a blank form as her application.
                            setLoadFailed(true); return;
                        }
                        if (verif.success && verif.data?.verification) {
                            const v = verif.data.verification as any;
                            setFormData(prev => ({
                                ...prev,
                                businessName: v.businessName || prev.businessName,
                                phone: v.phone || prev.phone,
                                location: v.location || prev.location,
                                bankAccount: v.bankAccount || prev.bankAccount,
                            }));
                        }
                        setIsEditMode(true);
                    } else {
                        //   #790 The same rule the submit handler below uses.
                        router.replace(onboardingDestination("marketplace", { hasAccess: false }));
                    }
                } else if (marketplaceStatus === "approved" || marketplaceStatus === "active") {
                    const hasAccessResult = await checkMarketplaceAccessAction();
                    if (hasAccessResult.success && hasAccessResult.data) {
                        router.replace(onboardingDestination("marketplace", {
                            hasAccess: true, accountType,
                        }));
                    }
                } else if (marketplaceStatus === "rejected" || marketplaceStatus === "suspended") {
                    // Prefill form from Firestore for rejected / suspended users
                    const verif = await getSellerVerificationAction();
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
                    if (!verif.success) { setLoadFailed(true); return; }
                    if (verif.success && verif.data?.verification) {
                        const v = verif.data.verification as any;
                        setFormData(prev => ({
                            ...prev,
                            businessName: v.businessName || prev.businessName,
                            phone: v.phone || prev.phone,
                            location: v.location || prev.location,
                            bankAccount: v.bankAccount || prev.bankAccount,
                        }));
                        if (v.rejectionReason) setRejectionReason(v.rejectionReason);
                    }
                    setIsRevisionMode(true);
                } else {
                    // Restore draft from localStorage for fresh applicants
                    if (DRAFT_KEY) {
                        try {
                            const saved = localStorage.getItem(DRAFT_KEY);
                            if (saved) {
                                const parsed = JSON.parse(saved);
                                if (parsed.data) setFormData(parsed.data);
                                //   #625 — refused if it is not a step this
                                //   flow has. Six steps for a seller and four
                                //   otherwise, so a draft saved as a seller and
                                //   restored as a buyer could already land past
                                //   the end. The widest is used here because the
                                //   seller flag is not settled at restore time;
                                //   the render switch covers 1..6.
                                const savedStep = restoredStepIndex(parsed.step, 6, 1);
                                if (savedStep !== null) setCurrentStep(savedStep);
                            }
                        } catch { /* non-blocking */ }
                    }
                }
            } catch (error) {
                logger.error("Failed to check Marketplace status:", error);
            }
        };
        if (session?.user) {
            checkStatus();
        }

    }, [session, status, router, DRAFT_KEY, takeSeed]);

    // Show loading while checking auth
    if (status === "loading") {
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
                        what="your seller details"
                        onRetry={() => window.location.reload()}
                    />
                    <div className="flex justify-center">
                        <FormHomeButton />
                    </div>
                </div>
            </div>
        );
    }

    return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-slate-600">Loading...</p>
                </div>
            </div>
        );
    }

    // Don't render onboarding form if not authenticated
    if (!session) {
        return null;
    }

    // Determine total steps based on account type
    const isSeller = formData.accountType === "seller" || formData.accountType === "both";
    const totalSteps = isSeller ? 6 : 4;

    const steps = [
        { id: 1, title: "Account Type", description: "Choose your role" },
        { id: 2, title: "Business Profile", description: "Your information" },
        { id: 3, title: "Product Interests", description: "Categories & preferences" },
        { id: 4, title: "Terms", description: "Accept agreements" },
        ...(isSeller ? [
            { id: 5, title: "Verification", description: "Business documents" },
            { id: 6, title: "Bank Account", description: "Payment details" }
        ] : [])
    ];

    const updateFormData = (data: Partial<OnboardingData>) => {
        setFormData(prev => {
            const next = { ...prev, ...data };
            if (!isRevisionMode && DRAFT_KEY) {
                try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ step: currentStep, data: next })); } catch { /* non-blocking */ }
            }
            return next;
        });
    };

    function handleNext() {
        if (currentStep < totalSteps) {
            const nextStep = currentStep + 1;
            setCurrentStep(nextStep);
            // Persist draft after each step (not in revision mode)
            if (!isRevisionMode && DRAFT_KEY) {
                try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ step: nextStep, data: formData })); } catch { /* non-blocking */ }
            }
        } else {
            handleSubmit();
        }
    };

    function handleBack() {
        if (currentStep > 1) {
            setCurrentStep(prev => prev - 1);
        }
    };

    async function handleSubmit() {
        // ── Pre-submission Zod Guard ───────────────────────────────────────────
        const locationSchema = z.object({
            state: z.string().trim().min(1, "State is required."),
            lga: z.string().trim().min(1, "LGA is required."),
            address: z.string().trim().min(1, "Address is required."),
        }, { message: "Location is required." });

        const baseSchema = z.object({
            accountType: z.enum(["buyer", "seller", "both"], {
                message: "Please select an account type.",
            }),
            businessName: z.string().trim().min(2, "Business name must be at least 2 characters."),
            businessType: z.enum(["individual", "cooperative", "company"], {
                message: "Please select a business type.",
            }).default("individual"),
            phone: z.string().trim().min(5, "Phone number is required."),
            location: locationSchema,
            termsAccepted: z.boolean().refine(val => val === true, {
                message: "You must accept the terms and conditions.",
            }),
        });

        let marketplaceSchema = baseSchema;
        if (formData.accountType === "seller" || formData.accountType === "both") {
            marketplaceSchema = baseSchema.extend({
                bankAccount: z.object({
                    bankName: z.string().trim().min(1, "Bank name is required."),
                    accountNumber: z.string().trim().length(10, "Account number must be exactly 10 digits."),
                    accountName: z.string().trim().min(1, "Account name is required."),
                }, { message: "Bank account details are required for sellers." }),
            });
        }

        const validation = marketplaceSchema.safeParse(formData);
        if (!validation.success) {
            const firstError = validation.error.issues[0];
            const errorPath = firstError.path;
            
            // Map the error path back to step ID
            if (errorPath[0] === "accountType") {
                setCurrentStep(1);
            } else if (errorPath[0] === "businessName" || errorPath[0] === "businessType" || errorPath[0] === "phone" || errorPath[0] === "location") {
                setCurrentStep(2);
            } else if (errorPath[0] === "buyerInterests" || errorPath[0] === "orderVolume" || errorPath[0] === "sellerCategories") {
                setCurrentStep(3);
            } else if (errorPath[0] === "termsAccepted") {
                setCurrentStep(4);
            } else if (errorPath[0] === "documents") {
                setCurrentStep(5);
            } else if (errorPath[0] === "bankAccount") {
                setCurrentStep(6);
            }
            
            toast.error(firstError.message);
            return;
        }
        // ────────────────────────────────────────────────────────────────────────
        setIsSubmitting(true);

        try {
            if (isRevisionMode || isEditMode) {
                const result = await resubmitSellerVerificationAction({
                    businessName: formData.businessName,
                    phone: formData.phone,
                    location: formData.location,
                    bankAccount: formData.bankAccount as any,
                } as any);
                if (result.success) {
                    if (DRAFT_KEY) { try { localStorage.removeItem(DRAFT_KEY); } catch { /* non-blocking */ } }
                    toast.success("Resubmitted successfully!");
                    setIsSubmitting(false);
                    //   #790 The resubmit path, same rule. A seller correcting a
                    //   rejected verification goes back to pending, so the
                    //   dashboard was never where she was going.
                    const reAccess = await checkMarketplaceAccessAction().catch(() => null);
                    if (!reAccess?.success) logger.error("[marketplace onboarding] access check failed after resubmit", { reason: reAccess?.error });
                    router.push(onboardingDestination("marketplace", {
                        hasAccess: !!(reAccess?.success && reAccess.data),
                        accountType: formData.accountType,
                    }));
                } else {
                    logger.error("Resubmission failed:", result.error);
                    toast.error(result.error || "Resubmission failed");
                    setIsSubmitting(false);
                }
                return;
            }

            const formDataPayload = new FormData();

            formDataPayload.append("accountType", formData.accountType!);
            if (formData.sellerCategory) formDataPayload.append("sellerCategory", formData.sellerCategory);
            formDataPayload.append("businessName", formData.businessName || "");
            formDataPayload.append("businessType", formData.businessType || "individual");
            formDataPayload.append("phone", formData.phone || "");
            formDataPayload.append("location", JSON.stringify(formData.location));

            if (formData.sellerCategories) formDataPayload.append("sellerCategories", JSON.stringify(formData.sellerCategories));
            if (formData.productionCapacity) formDataPayload.append("productionCapacity", formData.productionCapacity);
            if (formData.certifications) formDataPayload.append("certifications", JSON.stringify(formData.certifications));
            if (formData.buyerInterests) formDataPayload.append("buyerInterests", JSON.stringify(formData.buyerInterests));
            if (formData.documents?.businessRegistration) formDataPayload.append("businessRegistration", JSON.stringify(formData.documents.businessRegistration));

            formData.documents?.farmPhotos?.forEach((file, index) => {
                formDataPayload.append(`farmPhotos_${index}`, JSON.stringify(file));
            });
            formData.documents?.productSamples?.forEach((file, index) => {
                formDataPayload.append(`productSamples_${index}`, JSON.stringify(file));
            });

            if (formData.bankAccount) formDataPayload.append("bankAccount", JSON.stringify(formData.bankAccount));

            const result = await submitMarketplaceOnboardingAction(formDataPayload);

            if (result.success) {
                // Clear draft on success
                if (DRAFT_KEY) { try { localStorage.removeItem(DRAFT_KEY); } catch { /* non-blocking */ } }
                toast.success("Onboarding completed!");
                setIsSubmitting(false);
                /*
                 *   #790 THE TWO ANSWERS THIS FORM HAS, and it gave neither.
                 *
                 *   A BUYER-ONLY submission writes status "active" and grants
                 *   marketplace_buyer — auto-approved, and her screen is the
                 *   BUYER dashboard. A seller writes "pending" with no role and
                 *   belongs on the pending page. Both were sent to
                 *   /marketplace/dashboard: the buyer to a screen that is not
                 *   hers, the seller to one she cannot open at all.
                 */
                const access = await checkMarketplaceAccessAction().catch(() => null);
                if (!access?.success) logger.error("[marketplace onboarding] access check failed after submit", { reason: access?.error });
                router.push(onboardingDestination("marketplace", {
                    hasAccess: !!(access?.success && access.data),
                    accountType: formData.accountType,
                }));
            } else {
                logger.error("Submission failed:", result.error);
                toast.error(result.error || "Submission failed");
                setIsSubmitting(false);
            }

        } catch (error: any) {
            logger.error("Marketplace registration error:", error);
            toast.error(error.message || "An unexpected error occurred");
            setIsSubmitting(false);
        }
    };

    const renderStep = () => {
        switch (currentStep) {
            case 1:
                return (
                    <AccountTypeStep
                        value={formData.accountType}
                        sellerCategory={formData.sellerCategory}
                        onChange={(accountType) => updateFormData({ accountType })}
                        onSellerCategoryChange={(sellerCategory) => updateFormData({ sellerCategory })}
                        onNext={handleNext}
                    />
                );
            case 2:
                return (
                    <BusinessProfileStep
                        data={{
                            businessName: formData.businessName || "",
                            businessType: formData.businessType || "individual",
                            phone: formData.phone || "",
                            location: formData.location || { state: "", lga: "", address: "" }
                        }}
                        onChange={(data) => updateFormData(data)}
                        onNext={handleNext}
                        onBack={handleBack}
                    />
                );
            case 3:
                return (
                    <ProductInterestsStep
                        accountType={formData.accountType!}
                        data={{
                            buyerInterests: formData.buyerInterests,
                            orderVolume: formData.orderVolume,
                            deliveryPreferences: formData.deliveryPreferences,
                            sellerCategories: formData.sellerCategories,
                            productionCapacity: formData.productionCapacity,
                            certifications: formData.certifications
                        }}
                        onChange={(data) => updateFormData(data)}
                        onNext={handleNext}
                        onBack={handleBack}
                    />
                );
            case 4:
                return (
                    <TermsStep
                        accepted={formData.termsAccepted || false}
                        onChange={(termsAccepted) => updateFormData({ termsAccepted })}
                        onNext={handleNext}
                        onBack={handleBack}
                        isFinalStep={!isSeller}
                        isSubmitting={isSubmitting}
                    />
                );
            case 5:
                return (
                    <BusinessVerificationStep
                        data={formData.documents}
                        onChange={(documents) => updateFormData({ documents })}
                        onNext={handleNext}
                        onBack={handleBack}
                    />
                );
            case 6:
                return (
                    <BankAccountStep
                        data={formData.bankAccount}
                        onChange={(bankAccount) => updateFormData({ bankAccount })}
                        onNext={handleNext}
                        onBack={handleBack}
                        isSubmitting={isSubmitting}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <OnboardingLayout
            title="Marketplace Onboarding"
            subtitle="Join Nigeria's premier agricultural marketplace"
            serviceName="marketplace"
        >
            {/* Rejection / Revision Banner */}
            {isRevisionMode && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-amber-900">Your verification requires updates</p>
                        {rejectionReason && <p className="text-sm text-amber-700 mt-1">{rejectionReason}</p>}
                        <p className="text-xs text-amber-600 mt-1">Update your details and resubmit for review.</p>
                    </div>
                </div>
            )}

            {/* Edit Mode Banner */}
            {isEditMode && !isRevisionMode && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-300 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-blue-900">Editing Application</p>
                        <p className="text-sm text-blue-700 mt-1">You are currently editing your submitted seller verification. Changes will be saved upon resubmission.</p>
                    </div>
                </div>
            )}

            <div className="mb-8">
                <StepIndicator
                    steps={steps}
                    currentStep={currentStep}
                />
            </div>

            {renderStep()}
        </OnboardingLayout>
    );
}
