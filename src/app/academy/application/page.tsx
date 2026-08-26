"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle, CreditCard, Loader2, Shield } from "lucide-react";
import PersonalInfoStep from "./steps/PersonalInfoStep";
import EducationStep from "./steps/EducationStep";
import InterestsStep from "./steps/InterestsStep";
import ReviewStep from "./ReviewStep";
import { checkAcademyStatusAction, submitAcademyApplicationAction, getAcademyApplicationAction, resubmitAcademyApplicationAction } from "@/app/actions/academy";
import { checkAcademyPaymentStatusAction, initiateAcademyPaymentAction } from "@/app/actions/academy";
import { useSession } from "next-auth/react";
import { useToast } from "@/contexts/ToastContext";
import { AlertTriangle } from "lucide-react";

interface PersonalInfoData {
    firstName: string;
    lastName: string;
    otherName?: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    state: string;
    lga: string;
    occupation: string;
}

interface EducationData {
    educationLevel: string;
    fieldOfStudy: string;
    yearsExperience: number;
    currentRole: string;
}

interface InterestsData {
    learningPaths: string[];
    topics: string;
    goals: string;
}

const STEPS = [
    { id: 1, title: "Personal Info", description: "Basic information" },
    { id: 2, title: "Education", description: "Academic background" },
    { id: 3, title: "Interests", description: "Learning goals" },
    { id: 4, title: "Review", description: "Confirm details" },
    { id: 5, title: "Payment", description: "Select Plan" }
];

export default function AcademyApplicationPage() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isPaying, setIsPaying] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState<"paid" | "unpaid">("unpaid");
    /**
     * #316 — the payment check itself failed, so neither "paid" nor "unpaid"
     * is known. Distinct from paymentStatus, which may only hold an answer the
     * server actually gave.
     */
    const [paymentCheckFailed, setPaymentCheckFailed] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState<"foundation" | "standard" | "elite">("foundation");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [revisionNote, setRevisionNote] = useState<string | null>(null);
    const [isRevisionMode, setIsRevisionMode] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const { data: session, status } = useSession();
    const { showToast } = useToast();

    const [personalInfo, setPersonalInfo] = useState<PersonalInfoData>({
        firstName: "",
        lastName: "",
        otherName: "",
        email: "",
        phone: "",
        dateOfBirth: "",
        gender: "",
        state: "",
        lga: "",
        occupation: ""
    });

    const [education, setEducation] = useState<EducationData>({
        educationLevel: "",
        fieldOfStudy: "",
        yearsExperience: 0,
        currentRole: ""
    });

    const [interests, setInterests] = useState<InterestsData>({
        learningPaths: [],
        topics: "",
        goals: ""
    });

    // Restore draft from localStorage
    const [restored, setRestored] = useState(false);
    useEffect(() => {
        if (!session?.user?.id) return;
        try {
            const draft = localStorage.getItem(`academy_draft_${session.user.id}`);
            if (draft) {
                const parsed = JSON.parse(draft);
                if (parsed.personalInfo) {
                    setPersonalInfo(prev => ({
                        ...prev,
                        ...parsed.personalInfo,
                        firstName: parsed.personalInfo.firstName || "",
                        lastName: parsed.personalInfo.lastName || "",
                        otherName: parsed.personalInfo.otherName || "",
                        email: parsed.personalInfo.email || "",
                        phone: parsed.personalInfo.phone || "",
                        dateOfBirth: parsed.personalInfo.dateOfBirth || "",
                        gender: parsed.personalInfo.gender || "",
                        state: parsed.personalInfo.state || "",
                        lga: parsed.personalInfo.lga || "",
                        occupation: parsed.personalInfo.occupation || ""
                    }));
                }
                if (parsed.education) {
                    setEducation(prev => ({
                        ...prev,
                        ...parsed.education,
                        educationLevel: parsed.education.educationLevel || "",
                        fieldOfStudy: parsed.education.fieldOfStudy || "",
                        yearsExperience: parsed.education.yearsExperience !== undefined ? parsed.education.yearsExperience : 0,
                        currentRole: parsed.education.currentRole || ""
                    }));
                }
                if (parsed.interests) {
                    setInterests(prev => ({
                        ...prev,
                        ...parsed.interests,
                        learningPaths: parsed.interests.learningPaths || [],
                        topics: parsed.interests.topics || "",
                        goals: parsed.interests.goals || ""
                    }));
                }
            }
        } catch (e) {}
        setRestored(true);
    }, [session?.user?.id]);

    // Save draft whenever form data changes
    useEffect(() => {
        if (!session?.user?.id || !restored) return;
        try {
            localStorage.setItem(`academy_draft_${session.user.id}`, JSON.stringify({
                personalInfo, education, interests, currentStep
            }));
        } catch (e) {}
    }, [personalInfo, education, interests, currentStep, session?.user?.id, restored]);

    useEffect(() => {
        /**
         * Read the payment status, or null when the check itself failed — #316.
         *
         * All five call sites below did `payStatus.data || "unpaid"` or
         * `payStatus.data === "unpaid"`, neither of which can tell a real
         * "unpaid" from a failed read. Now that the action distinguishes them,
         * reading `.data` directly would be worse than before rather than
         * better: `null === "unpaid"` is false, so a failed check would fall
         * into the else branch and be treated as PAID. One helper, so no site
         * can get that wrong on its own.
         */
        const readPaymentStatus = async (): Promise<"paid" | "unpaid" | null> => {
            const res = await checkAcademyPaymentStatusAction();
            if (!res.success) return null;
            return res.data === "paid" ? "paid" : "unpaid";
        };

        const checkStatus = async () => {
            try {
                const status = await checkAcademyStatusAction();
                if (status.data === "pending" || status.data === "under_review") {
                    const params = new URLSearchParams(window.location.search);
                    const isEditParam = params.get("edit") === "true";

                    if (isEditParam) {
                        const result = await getAcademyApplicationAction();
                        if (result.success) {
                            const d = result.data ?? {};
                            if (d.personalInfo) {
                                const pi = d.personalInfo;
                                setPersonalInfo((prev: any) => ({
                                    ...prev,
                                    ...pi,
                                    firstName: pi.firstName || (pi.fullName ? pi.fullName.split(' ')[0] : '') || prev.firstName || "",
                                    lastName: pi.lastName || (pi.fullName ? pi.fullName.split(' ').slice(1).join(' ') : '') || prev.lastName || "",
                                    otherName: pi.otherName || prev.otherName || "",
                                    email: pi.email || prev.email || "",
                                    phone: pi.phone || prev.phone || "",
                                    dateOfBirth: pi.dateOfBirth || prev.dateOfBirth || "",
                                    gender: pi.gender || prev.gender || "",
                                    state: pi.state || prev.state || "",
                                    lga: pi.lga || prev.lga || "",
                                    occupation: pi.occupation || prev.occupation || ""
                                }));
                            }
                            if (d.education) {
                                setEducation((prev: any) => ({
                                    ...prev,
                                    ...d.education,
                                    educationLevel: d.education.educationLevel || prev.educationLevel || "",
                                    fieldOfStudy: d.education.fieldOfStudy || prev.fieldOfStudy || "",
                                    yearsExperience: d.education.yearsExperience !== undefined ? d.education.yearsExperience : prev.yearsExperience || 0,
                                    currentRole: d.education.currentRole || prev.currentRole || ""
                                }));
                            }
                            if (d.interests) {
                                setInterests((prev: any) => ({
                                    ...prev,
                                    ...d.interests,
                                    learningPaths: d.interests.learningPaths || prev.learningPaths || [],
                                    topics: d.interests.topics || prev.topics || "",
                                    goals: d.interests.goals || prev.goals || ""
                                }));
                            }
                        }
                        setIsEditMode(true);
                        const pay = await readPaymentStatus();
                        setPaymentCheckFailed(pay === null);
                        if (pay) setPaymentStatus(pay);
                        setIsLoading(false);
                    } else {
                        // Check payment status
                        const pay = await readPaymentStatus();
                        if (pay === null) {
                            // Do not push a learner who may have paid onto the
                            // payment step. #316.
                            setPaymentCheckFailed(true);
                            setIsLoading(false);
                            return;
                        }
                        setPaymentCheckFailed(false);
                        setPaymentStatus(pay);

                        if (pay === "unpaid") {
                            // Hasn't paid yet — show payment step
                            setCurrentStep(5);
                            setIsLoading(false);
                        } else {
                            // Paid but status shows "pending" — verify an actual application exists
                            // before redirecting. Payment alone sets status="pending" on the USERS doc,
                            // so we must check the ACADEMY_APPLICATIONS collection to distinguish
                            // "paid but form not submitted yet" from "application submitted and pending review".
                            const appResult = await getAcademyApplicationAction();
                            const hasSubmittedApplication = appResult.success && appResult.data && (
                                appResult.data.personalInfo?.firstName || appResult.data.firstName
                            );

                            if (hasSubmittedApplication) {
                                // Real application submitted — go to pending review page
                                router.replace("/academy/application/pending");
                            } else {
                                // Paid but form not submitted — stay on form, show payment confirmed
                                setCurrentStep(5);
                                setIsLoading(false);
                            }
                        }
                    }
                } else if (status.data === "approved" || status.data === "active") {
                    const pay = await readPaymentStatus();
                    if (pay === null) {
                        // Neither branch is safe on an unknown answer: one asks
                        // an approved learner to pay again, the other sends an
                        // unpaid one into the dashboard. #316.
                        setPaymentCheckFailed(true);
                        setIsLoading(false);
                    } else if (pay === "unpaid") {
                        setPaymentStatus("unpaid");
                        setCurrentStep(5);
                        setIsLoading(false);
                    } else {
                        router.replace("/academy/dashboard");
                    }
                } else if (status.data === "revision_required") {
                    // Pre-populate form with existing data
                    const result = await getAcademyApplicationAction();
                    if (result.success) {
                        const d = result.data ?? {};
                        if (d.personalInfo) {
                            const pi = d.personalInfo;
                            setPersonalInfo((prev: any) => ({
                                ...prev,
                                ...pi,
                                firstName: pi.firstName || (pi.fullName ? pi.fullName.split(' ')[0] : '') || prev.firstName || "",
                                lastName: pi.lastName || (pi.fullName ? pi.fullName.split(' ').slice(1).join(' ') : '') || prev.lastName || "",
                                otherName: pi.otherName || prev.otherName || "",
                                email: pi.email || prev.email || "",
                                phone: pi.phone || prev.phone || "",
                                dateOfBirth: pi.dateOfBirth || prev.dateOfBirth || "",
                                gender: pi.gender || prev.gender || "",
                                state: pi.state || prev.state || "",
                                lga: pi.lga || prev.lga || "",
                                occupation: pi.occupation || prev.occupation || ""
                            }));
                        }
                        if (d.education) {
                            setEducation((prev: any) => ({
                                ...prev,
                                ...d.education,
                                educationLevel: d.education.educationLevel || prev.educationLevel || "",
                                fieldOfStudy: d.education.fieldOfStudy || prev.fieldOfStudy || "",
                                yearsExperience: d.education.yearsExperience !== undefined ? d.education.yearsExperience : prev.yearsExperience || 0,
                                currentRole: d.education.currentRole || prev.currentRole || ""
                            }));
                        }
                        if (d.interests) {
                            setInterests((prev: any) => ({
                                ...prev,
                                ...d.interests,
                                learningPaths: d.interests.learningPaths || prev.learningPaths || [],
                                topics: d.interests.topics || prev.topics || "",
                                goals: d.interests.goals || prev.goals || ""
                            }));
                        }
                        if (d.revisionNote) setRevisionNote(d.revisionNote);
                    }
                    setIsRevisionMode(true);
                    const pay = await readPaymentStatus();
                    setPaymentCheckFailed(pay === null);
                    if (pay) setPaymentStatus(pay);
                    setIsLoading(false);
                } else {
                    const pay = await readPaymentStatus();
                    setPaymentCheckFailed(pay === null);
                    if (pay) setPaymentStatus(pay);
                    setIsLoading(false);
                }
            } catch (error) {
                logger.error("Failed to check Academy status:", error);
                setIsLoading(false);
            }
        };

        // SESSION CRASH FIX: do not run until NextAuth has finished loading.
        // The old guard `if (session)` was wrong: during the loading phase,
        // session is null, which hit the else branch and called setIsLoading(false)
        // immediately — causing the form to flash before auth resolved.
        if (status === "loading") return;
        // If not authenticated, stop the loading spinner and show the form
        // (middleware will handle the redirect to /auth/login if needed).
        if (!session) {
            setIsLoading(false);
            return;
        }

        checkStatus();

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]); // re-run once session transitions from "loading" → "authenticated"



    // Clear field-specific errors when data changes
    const clearFieldError = (field: string) => {
        setErrors(prev => {
            const newErrors = { ...prev };
            delete newErrors[field];
            return newErrors;
        });
    };

    useEffect(() => {
        if (personalInfo.firstName) clearFieldError('firstName');
    }, [personalInfo.firstName]);

    useEffect(() => {
        if (personalInfo.lastName) clearFieldError('lastName');
    }, [personalInfo.lastName]);

    useEffect(() => {
        if (personalInfo.email) clearFieldError('email');
    }, [personalInfo.email]);

    useEffect(() => {
        if (personalInfo.phone) clearFieldError('phone');
    }, [personalInfo.phone]);

    useEffect(() => {
        if (personalInfo.dateOfBirth) clearFieldError('dateOfBirth');
    }, [personalInfo.dateOfBirth]);

    useEffect(() => {
        if (personalInfo.state) clearFieldError('state');
    }, [personalInfo.state]);

    useEffect(() => {
        if (personalInfo.lga) clearFieldError('lga');
    }, [personalInfo.lga]);

    useEffect(() => {
        if (personalInfo.gender) clearFieldError('gender');
    }, [personalInfo.gender]);

    useEffect(() => {
        if (personalInfo.occupation) clearFieldError('occupation');
    }, [personalInfo.occupation]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    // #316 — the payment check failed, so we do not know whether this learner
    // has paid. Showing the form would present the payment step to somebody who
    // may already have paid, which is what the old "unpaid on error" default
    // did. Say so instead.
    if (paymentCheckFailed) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
                    <h2 className="text-xl font-bold text-slate-900 mb-2">
                        We could not check your payment status
                    </h2>
                    <p className="text-slate-600 text-sm mb-6">
                        This is a problem reaching the server, not a change to your
                        registration &mdash; nothing has been charged and nothing has been
                        lost. Please try again in a moment.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition"
                    >
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    const validateStep = (step: number): boolean => {
        const newErrors: Record<string, string> = {};

        if (step === 1) {
            if (!(personalInfo?.firstName || "").trim()) newErrors.firstName = "First name is required";
            if (!(personalInfo?.lastName || "").trim()) newErrors.lastName = "Last name is required";
            if (!(personalInfo?.email || "").trim()) {
                newErrors.email = "Email is required";
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalInfo?.email || "")) {
                newErrors.email = "Invalid email format";
            }
            if (!(personalInfo?.phone || "").trim()) newErrors.phone = "Phone number is required";
            if (!personalInfo?.dateOfBirth) newErrors.dateOfBirth = "Date of birth is required";
            if (!personalInfo?.gender) newErrors.gender = "Gender is required";
            if (!personalInfo?.state) newErrors.state = "State is required";
            if (!personalInfo?.lga) newErrors.lga = "LGA is required";
            if (!(personalInfo?.occupation || "").trim()) newErrors.occupation = "Occupation is required";
        }

        if (step === 2) {
            if (!education?.educationLevel) newErrors.educationLevel = "Education level is required";
            if (!education?.currentRole) newErrors.currentRole = "Current role is required";
        }

        if (step === 3) {
            if ((interests?.learningPaths || []).length === 0) {
                newErrors.learningPaths = "Please select at least one learning path";
            }
            if (!(interests?.goals || "").trim()) newErrors.goals = "Learning goals are required";
        }

        if (step >= 4) {
            if (!acceptTerms) {
                newErrors.acceptTerms = "You must accept the terms and conditions to continue";
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    function handleNext() {
        if (validateStep(currentStep)) {
            setCurrentStep((prev) => Math.min(prev + 1, 5));
        }
    };

    function handlePrevious() {
        setCurrentStep((prev) => Math.max(prev - 1, 1));
        setErrors({});
    };

    async function handlePayment() {
        setIsPaying(true);
        try {
            const result = await initiateAcademyPaymentAction(selectedPlan);
            if (result.success && result.data?.paymentUrl) {
                // If already paid, the action returns paymentUrl = "/academy/application".
                // Navigating there would cause an infinite loop — detect and handle gracefully.
                if (result.data.paymentUrl === "/academy/application") {
                    setPaymentStatus("paid");
                    showToast("Payment already confirmed. You can now submit your application.", "info");
                } else {
                    window.location.href = result.data.paymentUrl;
                }
            } else {
                showToast(result.error || "Failed to initiate payment", "error");
            }
        } catch (error) {
            logger.error("Payment initiation error:", error);
            showToast("Failed to initiate payment. Please try again.", "error");
        } finally {
            setIsPaying(false);
        }
    };

    async function handleSubmit() {
        // ── Pre-submission guard — validate ALL steps before server call ──────
        // validateStep(4) only checks terms. Also run steps 1-3 here so a
        // localStorage-restored draft with incomplete data is caught before
        // hitting the server action.
        if (!validateStep(1)) {
            showToast("Personal information is incomplete. Please review Step 1.", "error");
            setCurrentStep(1);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }
        if (!validateStep(2)) {
            showToast("Education details are incomplete. Please review Step 2.", "error");
            setCurrentStep(2);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }
        if (!validateStep(3)) {
            showToast("Please select at least one learning path and provide your goals.", "error");
            setCurrentStep(3);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }
        if (!validateStep(4)) return; // Terms acceptance check
        // ─────────────────────────────────────────────────────────────────────

        setIsSubmitting(true);

        try {
            const enrichedPersonalInfo = {
                ...personalInfo,
                fullName: `${personalInfo?.firstName || ""} ${personalInfo?.lastName || ""}`.trim(),
            };
            const response = (isRevisionMode || isEditMode)
                ? await resubmitAcademyApplicationAction({ personalInfo: enrichedPersonalInfo, education, interests })
                : await submitAcademyApplicationAction({ personalInfo: enrichedPersonalInfo, education, interests });

            if (response.success) {
                // Clear draft
                try { localStorage.removeItem(`academy_draft_${session?.user?.id}`); } catch (e) {}
                router.push("/academy/dashboard");
            } else {
                setErrors({ submit: response.error || "Failed to submit application" });
            }
        } catch (error) {
            logger.error("Application submission error:", error);
            setErrors({ submit: "Failed to submit application. Please try again." });
        } finally {
            setIsSubmitting(false);
        }
    };

        const PLANS = [
        { id: "foundation", name: "Foundation Plan", price: 45000, originalPrice: 50000 },
        { id: "standard", name: "Standard Plan", price: 90000, originalPrice: 100000 },
        { id: "elite", name: "Elite Plan", price: 270000, originalPrice: 300000 },
    ] as const;

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div style={{ background: "linear-gradient(to right, #2563eb, #4f46e5)" }} className="text-white py-12">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <h1 className="text-3xl md:text-4xl font-bold mb-2">Academy Learner Application</h1>
                    <p className="text-blue-100 mb-2">
                        Join thousands of successful agripreneurs who transformed their careers
                    </p>
                    <p className="text-xs text-blue-200/80 uppercase tracking-widest font-semibold">
                        Powered by Easy Sales Export
                    </p>
                </div>
            </div>

            {/* Revision / Edit Banner */}
            {isRevisionMode && revisionNote && (
                <div className="max-w-4xl mx-auto px-6 mt-6">
                    <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex gap-3 items-start shadow-md">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-amber-800">Revision Requested by Admin</p>
                            <p className="text-sm text-amber-700 mt-1">{revisionNote}</p>
                            <p className="text-xs text-amber-600 mt-2">Please update your details below and resubmit.</p>
                        </div>
                    </div>
                </div>
            )}

            {isEditMode && !isRevisionMode && (
                <div className="max-w-4xl mx-auto px-6 mt-6">
                    <div className="p-4 bg-blue-50 border border-blue-300 rounded-xl flex gap-3 items-start shadow-md">
                        <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-blue-900">Editing Application</p>
                            <p className="text-sm text-blue-700 mt-1">You are modifying a submitted application. Your changes will be saved when you complete the form.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Progress Steps */}
            <div className={`max-w-4xl mx-auto px-6 ${(isRevisionMode || isEditMode) ? "mt-6" : "-mt-8"}`}>
                <div className="bg-white rounded-2xl p-6 shadow-lg">
                    <div className="flex items-center justify-between">
                        {STEPS.map((step, index) => (
                            <div key={step.id} className="flex-1">
                                <div className="flex items-center">
                                    <div className="flex flex-col items-center flex-1">
                                        <div
                                            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${currentStep > step.id
                                                ? "bg-green-600 text-white"
                                                : currentStep === step.id
                                                    ? "bg-blue-600 text-white"
                                                    : "bg-slate-200 text-slate-500"
                                                }`}
                                        >
                                            {currentStep > step.id ? (
                                                <CheckCircle className="w-5 h-5" />
                                            ) : (
                                                step.id
                                            )}
                                        </div>
                                        <div className="mt-2 text-center">
                                            <p className={`text-sm font-semibold ${currentStep >= step.id
                                                ? "text-slate-900"
                                                : "text-slate-500"
                                                }`}>
                                                {step.title}
                                            </p>
                                            <p className="text-xs text-slate-500 hidden md:block">
                                                {step.description}
                                            </p>
                                        </div>
                                    </div>
                                    {index < STEPS.length - 1 && (
                                        <div
                                            className={`h-1 flex-1 mx-2 rounded-full transition-all ${currentStep > step.id
                                                ? "bg-green-600"
                                                : "bg-slate-200"
                                                }`}
                                        />
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Form Content */}
            <div className="max-w-4xl mx-auto px-6 py-12">
                <div className="bg-white rounded-2xl p-8 shadow-lg">
                    {currentStep === 1 && (
                        <PersonalInfoStep
                            data={personalInfo}
                            onChange={setPersonalInfo}
                            errors={errors}
                        />
                    )}
                    {currentStep === 2 && (
                        <EducationStep
                            data={education}
                            onChange={setEducation}
                            errors={errors}
                        />
                    )}
                    {currentStep === 3 && (
                        <InterestsStep
                            data={interests}
                            onChange={setInterests}
                            errors={errors}
                        />
                    )}
                    {currentStep === 4 && (
                        <ReviewStep
                            personalInfo={{
                                ...personalInfo,
                                fullName: `${personalInfo?.firstName || ""} ${personalInfo?.lastName || ""}`.trim(),
                            }}
                            education={education}
                            interests={interests}
                            acceptTerms={acceptTerms}
                            onAcceptTermsChange={setAcceptTerms}
                            errors={errors}
                        />
                    )}


                    {currentStep === 5 && paymentStatus === "unpaid" && (
                        <div className="max-w-lg mx-auto">
                            <div className="text-center mb-8">
                                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <CreditCard className="w-8 h-8 text-blue-600" />
                                </div>
                                <h2 className="text-2xl font-bold text-slate-900 mb-2">Select Academy Plan</h2>
                                <p className="text-slate-600">
                                    Choose a learning plan that fits your career goals to proceed with your application.
                                </p>
                            </div>

                            <div className="space-y-4 mb-6">
                                {PLANS.map(plan => (
                                    <button
                                        key={plan.id}
                                        onClick={() => setSelectedPlan(plan.id)}
                                        className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center ${selectedPlan === plan.id
                                            ? "border-blue-600 bg-blue-50"
                                            : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
                                            }`}
                                    >
                                        <div className="flex items-center gap-3 w-full">
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedPlan === plan.id ? "border-blue-600" : "border-slate-300"
                                                }`}>
                                                {selectedPlan === plan.id && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                                            </div>
                                            <div className="flex items-center flex-wrap gap-2 text-base md:text-lg">
                                                <span className="font-semibold text-slate-900">
                                                    {plan.name.replace(' Plan', '')} -
                                                </span>
                                                <span className="text-slate-400 line-through">
                                                    {plan.originalPrice / 1000}k
                                                </span>
                                                <span className="font-bold text-slate-900">
                                                    {plan.price / 1000}k
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={handlePayment}
                                disabled={isPaying}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-blue-300 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isPaying ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Shield className="w-5 h-5" />
                                        Pay ₦{PLANS.find(p => p.id === selectedPlan)?.price.toLocaleString()} to Continue
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                    
                    {currentStep === 5 && paymentStatus === "paid" && (
                        <div className="max-w-lg mx-auto text-center py-8">
                            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle className="w-10 h-10 text-green-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-4">Payment Confirmed</h2>
                            <p className="text-slate-600 mb-8">
                                Your payment has been successfully processed. Click the button below to submit your application.
                            </p>
                        </div>
                    )}

                    {/* Navigation Buttons */}
                    <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
                        <button
                            type="button"
                            onClick={handlePrevious}
                            disabled={currentStep === 1}
                            className="inline-flex items-center gap-2 px-6 py-3 text-slate-600 font-semibold rounded-xl hover:bg-slate-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ArrowLeft className="w-5 h-5" />
                            Previous
                        </button>

                        {currentStep < 5 ? (
                            <button
                                type="button"
                                onClick={handleNext}
                                className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg hover:shadow-blue-500/50"
                            >
                                Continue
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={isSubmitting || paymentStatus !== "paid"}
                                className="inline-flex items-center gap-2 px-8 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition shadow-lg hover:shadow-green-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="w-5 h-5" />
                                        Submit Application
                                    </>
                                )}
                            </button>
                        )}
                    </div>

                    {errors.submit && (
                        <p className="mt-4 text-sm text-red-600 text-center">{errors.submit}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
