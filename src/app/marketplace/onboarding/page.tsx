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
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import OnboardingLayout from "@/components/shared/OnboardingLayout";
import StepIndicator from "@/components/shared/StepIndicator";
import AccountTypeStep from "./steps/AccountTypeStep";
import BusinessProfileStep from "./steps/BusinessProfileStep";
import ProductInterestsStep from "./steps/ProductInterestsStep";
import TermsStep from "./steps/TermsStep";
import BusinessVerificationStep from "./steps/BusinessVerificationStep";
import BankAccountStep from "./steps/BankAccountStep";

type AccountType = "buyer" | "seller" | "both";

interface OnboardingData {
    // Step 1: Account Type
    accountType: AccountType;

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
        businessRegistration?: File;
        taxId?: string;
        farmPhotos?: File[];
        productSamples?: File[];
    };

    // Step 6: Bank Account (Sellers)
    bankAccount?: {
        bankName: string;
        accountNumber: string;
        accountName: string;
    };
}

export default function MarketplaceOnboarding() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [currentStep, setCurrentStep] = useState(1);
    const [formData, setFormData] = useState<Partial<OnboardingData>>({});

    // AUTH GATE: Redirect unauthenticated users to marketplace registration
    useEffect(() => {
        if (status === "loading") return; // Wait for session check

        if (status === "unauthenticated" || !session) {
            // Redirect to marketplace-specific registration
            router.replace("/marketplace/register?returnUrl=/marketplace/onboarding");
        }
    }, [session, status, router]);

    // Show loading while checking auth
    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-slate-600 dark:text-slate-400">Loading...</p>
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
        setFormData(prev => ({ ...prev, ...data }));
    };

    const handleNext = () => {
        if (currentStep < totalSteps) {
            setCurrentStep(prev => prev + 1);
        } else {
            handleSubmit();
        }
    };

    const handleBack = () => {
        if (currentStep > 1) {
            setCurrentStep(prev => prev - 1);
        }
    };

    const handleSubmit = async () => {
        try {
            const formDataPayload = new FormData();

            // Step 1: Account Type
            formDataPayload.append("accountType", formData.accountType!);

            // Step 2: Business Profile
            formDataPayload.append("businessName", formData.businessName || "");
            formDataPayload.append("businessType", formData.businessType || "individual");
            formDataPayload.append("phone", formData.phone || "");
            formDataPayload.append("location", JSON.stringify(formData.location));

            // Step 3: Product Interests
            if (formData.sellerCategories) {
                formDataPayload.append("sellerCategories", JSON.stringify(formData.sellerCategories));
            }
            if (formData.productionCapacity) {
                formDataPayload.append("productionCapacity", formData.productionCapacity);
            }
            if (formData.certifications) {
                formDataPayload.append("certifications", JSON.stringify(formData.certifications));
            }
            // Buyer interests (if 'both')
            if (formData.buyerInterests) {
                formDataPayload.append("buyerInterests", JSON.stringify(formData.buyerInterests));
            }

            // Step 5: Documents
            if (formData.documents?.businessRegistration) {
                formDataPayload.append("businessRegistration", formData.documents.businessRegistration);
            }

            formData.documents?.farmPhotos?.forEach((file, index) => {
                formDataPayload.append(`farmPhotos_${index}`, file);
            });

            formData.documents?.productSamples?.forEach((file, index) => {
                formDataPayload.append(`productSamples_${index}`, file);
            });

            // Step 6: Bank Account
            if (formData.bankAccount) {
                formDataPayload.append("bankAccount", JSON.stringify(formData.bankAccount));
            }

            // Client-side import to avoid build issues with server action direct usage if not properly typed
            const { submitMarketplaceOnboardingAction } = await import("@/app/actions/marketplace");

            const result = await submitMarketplaceOnboardingAction(null, formDataPayload);

            if (result.success) {
                // Redirect based on account type
                if (isSeller) {
                    router.push("/marketplace/onboarding/pending");
                } else {
                    router.push("/marketplace/buyer/dashboard");
                }
            } else {
                console.error("Submission failed:", result.error);
                // Ideally show error toast here
            }

        } catch (error) {
            console.error("Marketplace registration error:", error);
        }
    };

    const renderStep = () => {
        switch (currentStep) {
            case 1:
                return (
                    <AccountTypeStep
                        value={formData.accountType}
                        onChange={(accountType) => updateFormData({ accountType })}
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
