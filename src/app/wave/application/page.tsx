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

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    ChevronLeft,
    ChevronRight,
    CheckCircle,
    Loader2,
} from "lucide-react";
import { submitMultiStepWaveApplicationAction, getWaveApplicationAction, resubmitWaveApplicationAction } from "@/app/actions/wave";
import { useToast } from "@/contexts/ToastContext";
import { useSessionExpiry } from "@/hooks/useSessionExpiry";
import { AlertTriangle } from "lucide-react";

// Step imports
import PersonalDetailsStep from "./steps/PersonalDetailsStep";
import CivicStatusStep from "./steps/CivicStatusStep";
import SocioEconomicStep from "./steps/SocioEconomicStep";
import AgriInterestStep from "./steps/AgriInterestStep";
import FinancialStep from "./steps/FinancialStep";
import TrainingStep from "./steps/TrainingStep";
import ReviewStep from "./ReviewStep";

export interface WaveApplicationData {
    // SECTION A: Personal Identification
    surname: string;
    firstName: string;
    otherNames: string;
    dateOfBirth: string;
    age: number;
    phone: string;
    alternativePhone: string;
    email: string;
    residentialAddress: string;
    stateOfOrigin: string;
    lgaOfOrigin: string;
    stateOfResidence: string;
    lgaOfResidence: string;
    maritalStatus: "single" | "married" | "widowed" | "divorced" | "";
    nextOfKinName: string;
    nextOfKinPhone: string;
    nextOfKinRelationship: string;

    // SECTION B: National Identity & Civic Status
    nin: string;
    votersCardNumber: string;
    pollingUnit: string;
    ward: string;
    yearOfVoterRegistration: string;
    votedInLastElection: boolean;

    // SECTION C: Socio-Economic Profile
    highestEducation: "none" | "primary" | "secondary" | "tertiary" | "vocational" | "";
    currentOccupation: string;
    averageMonthlyIncome: "below_50k" | "50k_100k" | "100k_250k" | "above_250k" | "";
    involvedInAgriculture: boolean;
    agricultureTypes: ("farming" | "processing" | "trading" | "export" | "logistics")[];

    // SECTION D: Agricultural Interest & Value Chain
    valueChainAreas: ("crop_production" | "livestock" | "processing_packaging" | "aggregation_trading" | "export_market")[];
    preferredCommodities: ("rice" | "maize" | "sesame" | "soybeans" | "ginger" | "cassava" | "vegetables" | "other")[];
    preferredCommodityOther: string;
    hasAccessToFarmland: boolean;
    farmlandHectares: number;
    needsFarmlandAccess: boolean;

    // SECTION E: Financial & Cooperative Details
    hasBankAccount: boolean;
    bankName: string;
    accountNumber: string;
    bvn: string;
    isMemberOfCooperative: boolean;
    cooperativeName: string;
    willingToJoinCooperative: boolean;

    // SECTION F: Training, Support & Commitment
    supportNeeded: ("training" | "inputs" | "mechanization" | "finance" | "market_access")[];
    willingToUndergoTraining: boolean;
    willingToComplyWithStandards: boolean;
    willingToParticipateInME: boolean;

    // SECTION G: Declaration & Consent
    declarationAccepted: boolean;
    consentGiven: boolean;
}

const INITIAL_DATA: WaveApplicationData = {
    // SECTION A: Personal Identification
    surname: "",
    firstName: "",
    otherNames: "",
    dateOfBirth: "",
    age: 0,
    phone: "",
    alternativePhone: "",
    email: "",
    residentialAddress: "",
    stateOfOrigin: "",
    lgaOfOrigin: "",
    stateOfResidence: "",
    lgaOfResidence: "",
    maritalStatus: "",
    nextOfKinName: "",
    nextOfKinPhone: "",
    nextOfKinRelationship: "",

    // SECTION B: National Identity & Civic Status
    nin: "",
    votersCardNumber: "",
    pollingUnit: "",
    ward: "",
    yearOfVoterRegistration: "",
    votedInLastElection: false,

    // SECTION C: Socio-Economic Profile
    highestEducation: "",
    currentOccupation: "",
    averageMonthlyIncome: "",
    involvedInAgriculture: false,
    agricultureTypes: [],

    // SECTION D: Agricultural Interest & Value Chain
    valueChainAreas: [],
    preferredCommodities: [],
    preferredCommodityOther: "",
    hasAccessToFarmland: false,
    farmlandHectares: 0,
    needsFarmlandAccess: false,

    // SECTION E: Financial & Cooperative Details
    hasBankAccount: false,
    bankName: "",
    accountNumber: "",
    bvn: "",
    isMemberOfCooperative: false,
    cooperativeName: "",
    willingToJoinCooperative: false,

    // SECTION F: Training, Support & Commitment
    supportNeeded: [],
    willingToUndergoTraining: false,
    willingToComplyWithStandards: false,
    willingToParticipateInME: false,

    // SECTION G: Declaration & Consent
    declarationAccepted: false,
    consentGiven: false,
};

const STEPS = [
    "Personal Details",
    "Civic Status",
    "Socio-Economic",
    "Agricultural Interest",
    "Financial Details",
    "Training & Support",
    "Review",
];



export default function WaveApplicationPage() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(0);
    const [formData, setFormData] = useState<WaveApplicationData>(INITIAL_DATA);
    const [submitting, setSubmitting] = useState(false);
    const [restored, setRestored] = useState(false);
    const [revisionNote, setRevisionNote] = useState<string | null>(null);
    const [isRevisionMode, setIsRevisionMode] = useState(false);
    const { showToast } = useToast();
    const { data: session, status } = useSession();
    const { run: guardRun } = useSessionExpiry();

    // Restore saved progress from localStorage — scoped by user ID to prevent PII leaks across accounts
    useEffect(() => {
        if (status === "loading") return; // wait for session
        const userId = session?.user?.id;
        const draftKey = userId ? `wave_app_draft_${userId}` : null;
        if (!draftKey) { setRestored(true); return; }
        try {
            const saved = localStorage.getItem(draftKey);
            if (saved) {
                const { step, data } = JSON.parse(saved);
                if (data) setFormData({ ...INITIAL_DATA, ...data });
                if (typeof step === "number") setCurrentStep(step);
                showToast("Your previous progress has been restored.", "success");
            }
        } catch {
            // Ignore parse errors — start fresh
        }
        setRestored(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, session?.user?.id]);

    // Warn before tab close / navigation away mid-form
    useEffect(() => {
        if (currentStep === 0 || submitting) return; // no warning on first step or after submit
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [currentStep, submitting]);

    // Mobile back button: intercept popstate and go to the previous step
    useEffect(() => {
        const handlePopState = (e: PopStateEvent) => {
            if (currentStep > 0) {
                e.preventDefault?.();
                setCurrentStep(prev => Math.max(0, prev - 1));
                // Re-push a state so the next back press also gets caught
                window.history.pushState({ waveStep: currentStep - 1 }, "");
            }
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [currentStep]);

    useEffect(() => {
        // Auth is now enforced server-side in middleware.
        if (session?.user?.id) {
            checkApplicationStatus();
        }
    }, [session, router, showToast]);

    const checkApplicationStatus = async () => {
        try {
            const { checkWaveStatusAction } = await import("@/app/actions/wave");
            const waveStatus = await checkWaveStatusAction();

            if (waveStatus === "pending" || waveStatus === "under_review") {
                router.replace("/wave/application/review-pending");
            } else if (waveStatus === "approved") {
                router.replace("/wave/dashboard");
            } else if (waveStatus === "revision_required") {
                // Pre-populate form with existing data for editing
                const result = await getWaveApplicationAction();
                if (result.success && result.data) {
                    setFormData((prev: any) => ({ ...prev, ...result.data }));
                    setCurrentStep(0); // Start from beginning so user can review all steps
                }
                if (result.revisionNote) {
                    setRevisionNote(result.revisionNote);
                }
                setIsRevisionMode(true);
            } else if (waveStatus === "rejected") {
                // Stay on form, allow re-application
            }
        } catch (error) {
            console.error("Failed to check status", error);
        }
    };

    if (status === "loading" || !restored) {
        return (
            <div className="min-h-screen bg-stone-900 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
        );
    }

    const updateFormData = (data: Partial<WaveApplicationData>) => {
        setFormData((prev) => {
            const next = { ...prev, ...data };
            // Persist draft after every field update (user-scoped key)
            const userId = session?.user?.id;
            if (userId) {
                try {
                    localStorage.setItem(`wave_app_draft_${userId}`, JSON.stringify({ step: currentStep, data: next }));
                } catch { /* quota exceeded, non-blocking */ }
            }
            return next;
        });
    };

    const goToStep = (step: number) => {
        setCurrentStep(step);
        const userId = session?.user?.id;
        if (userId) {
            try {
                localStorage.setItem(`wave_app_draft_${userId}`, JSON.stringify({ step, data: formData }));
            } catch { /* non-blocking */ }
        }
        // Push a history entry so the mobile back button goes to previous step, not previous page
        if (typeof window !== "undefined") {
            window.history.pushState({ waveStep: step }, "");
        }
        window.scrollTo({ top: 0, behavior: "smooth" });

    };

    const nextStep = () => {
        if (currentStep < STEPS.length - 1) {
            goToStep(currentStep + 1);
        }
    };

    const prevStep = () => {
        if (currentStep > 0) {
            goToStep(currentStep - 1);
        }
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const result = isRevisionMode
                ? await guardRun(resubmitWaveApplicationAction(formData))
                : await guardRun(submitMultiStepWaveApplicationAction(formData));
            if (result.success) {
                const userId = session?.user?.id;
                if (userId) {
                    try { localStorage.removeItem(`wave_app_draft_${userId}`); } catch { /* non-blocking */ }
                }
                router.push("/wave/application/success");
            } else {
                showToast(result.error || "Failed to submit application. Please try again.", "error");
            }
        } catch (error) {
            logger.error("Submission error:", error);
            showToast("An unexpected error occurred. Please try again.", "error");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-white">
            <div className="max-w-4xl mx-auto px-4 py-12">
                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-slate-900 mb-4">
                        WAVE Program Application
                    </h1>
                    <p className="text-lg text-slate-700 mb-2">
                        Women's Agribusiness Venture Empowerment
                    </p>
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">
                        Implemented by Easy Sales Export
                    </p>
                </div>

                {/* Revision Banner — shown when admin has requested changes */}
                {isRevisionMode && revisionNote && (
                    <div className="mb-8 p-4 bg-amber-50 border border-amber-300 rounded-xl flex gap-3 items-start">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-amber-800">Revision Requested</p>
                            <p className="text-sm text-amber-700 mt-1">{revisionNote}</p>
                            <p className="text-xs text-amber-600 mt-2">Please review and update your details below, then resubmit the form.</p>
                        </div>
                    </div>
                )}

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
                        <PersonalDetailsStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                        />
                    )}
                    {currentStep === 1 && (
                        <CivicStatusStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 2 && (
                        <SocioEconomicStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 3 && (
                        <AgriInterestStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 4 && (
                        <FinancialStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 5 && (
                        <TrainingStep
                            data={formData}
                            updateData={updateFormData}
                            onNext={nextStep}
                            onBack={prevStep}
                        />
                    )}
                    {currentStep === 6 && (
                        <ReviewStep
                            data={formData}
                            onBack={prevStep}
                            onSubmit={handleSubmit}
                            submitting={submitting}
                            onEdit={(step) => goToStep(step)}
                        />
                    )}
                </div>

                {/* Navigation Buttons (shown for steps 1-6) */}
                {currentStep < 6 && (
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
