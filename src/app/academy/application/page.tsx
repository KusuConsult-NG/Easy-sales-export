"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle, CreditCard, Loader2, Shield } from "lucide-react";
import PersonalInfoStep from "./steps/PersonalInfoStep";
import EducationStep from "./steps/EducationStep";
import InterestsStep from "./steps/InterestsStep";
import ReviewStep from "./ReviewStep";
import { checkAcademyStatusAction, checkAcademyPaymentStatusAction, initiateAcademyPaymentAction, submitAcademyApplicationAction, getAcademyApplicationAction, resubmitAcademyApplicationAction } from "@/app/actions/academy";
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
    { id: 4, title: "Review", description: "Confirm details" }
];

export default function AcademyApplicationPage() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isPaying, setIsPaying] = useState(false);
    const [paymentStatus, setPaymentStatus] = useState<"paid" | "unpaid">("unpaid");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [revisionNote, setRevisionNote] = useState<string | null>(null);
    const [isRevisionMode, setIsRevisionMode] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const { data: session } = useSession();
    const { showToast } = useToast();

    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await checkAcademyStatusAction();
                if (status.data === "pending" || status.data === "under_review") {
                    const params = new URLSearchParams(window.location.search);
                    const isEditParam = params.get("edit") === "true";

                    if (isEditParam) {
                        const result = await getAcademyApplicationAction();
                        if (result.success && result.data) {
                            const d = result.data;
                            if (d.personalInfo) {
                                const pi = d.personalInfo;
                                setPersonalInfo((prev: any) => ({
                                    ...prev,
                                    ...pi,
                                    firstName: pi.firstName || (pi.fullName ? pi.fullName.split(' ')[0] : '') || prev.firstName,
                                    lastName: pi.lastName || (pi.fullName ? pi.fullName.split(' ').slice(1).join(' ') : '') || prev.lastName,
                                }));
                            }
                            if (d.education) setEducation((prev: any) => ({ ...prev, ...d.education }));
                            if (d.interests) setInterests((prev: any) => ({ ...prev, ...d.interests }));
                        }
                        setIsEditMode(true);
                        const payStatus = await checkAcademyPaymentStatusAction();
                        setPaymentStatus(payStatus.data || "unpaid");
                        setIsLoading(false);
                    } else {
                        // Stay on page — do NOT auto-redirect pending users
                        const payStatus = await checkAcademyPaymentStatusAction();
                        setPaymentStatus(payStatus.data || "unpaid");
                        setIsLoading(false);
                    }
                } else if (status.data === "approved" || status.data === "active") {
                    router.replace("/academy/dashboard");
                } else if (status.data === "revision_required") {
                    // Pre-populate form with existing data
                    const result = await getAcademyApplicationAction();
                    if (result.success && result.data) {
                        const d = result.data;
                        if (d.personalInfo) {
                            const pi = d.personalInfo;
                            setPersonalInfo((prev: any) => ({
                                ...prev,
                                ...pi,
                                firstName: pi.firstName || (pi.fullName ? pi.fullName.split(' ')[0] : '') || prev.firstName,
                                lastName: pi.lastName || (pi.fullName ? pi.fullName.split(' ').slice(1).join(' ') : '') || prev.lastName,
                            }));
                        }
                        if (d.education) setEducation((prev: any) => ({ ...prev, ...d.education }));
                        if (d.interests) setInterests((prev: any) => ({ ...prev, ...d.interests }));
                        if (d.revisionNote) setRevisionNote(d.revisionNote);
                    }
                    setIsRevisionMode(true);
                    // Check payment status — user already paid previously
                    const payStatus = await checkAcademyPaymentStatusAction();
                    setPaymentStatus(payStatus.data || "unpaid");
                    setIsLoading(false);
                } else {
                    // Check payment status
                    const payStatus = await checkAcademyPaymentStatusAction();
                    setPaymentStatus(payStatus.data || "unpaid");
                    setIsLoading(false);
                }
            } catch (error) {
                logger.error("Failed to check Academy status:", error);
                setIsLoading(false);
            }
        };

        if (session) {
            checkStatus();
        } else {
            setIsLoading(false);
        }
    }, [router, session]);



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

    const validateStep = (step: number): boolean => {
        const newErrors: Record<string, string> = {};

        if (step === 1) {
            if (!personalInfo.firstName.trim()) newErrors.firstName = "First name is required";
            if (!personalInfo.lastName.trim()) newErrors.lastName = "Last name is required";
            if (!personalInfo.email.trim()) {
                newErrors.email = "Email is required";
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalInfo.email)) {
                newErrors.email = "Invalid email format";
            }
            if (!personalInfo.phone.trim()) newErrors.phone = "Phone number is required";
            if (!personalInfo.dateOfBirth) newErrors.dateOfBirth = "Date of birth is required";
            if (!personalInfo.gender) newErrors.gender = "Gender is required";
            if (!personalInfo.state) newErrors.state = "State is required";
            if (!personalInfo.lga) newErrors.lga = "LGA is required";
            if (!personalInfo.occupation.trim()) newErrors.occupation = "Occupation is required";
        }

        if (step === 2) {
            if (!education.educationLevel) newErrors.educationLevel = "Education level is required";
            if (!education.currentRole) newErrors.currentRole = "Current role is required";
        }

        if (step === 3) {
            if (interests.learningPaths.length === 0) {
                newErrors.learningPaths = "Please select at least one learning path";
            }
            if (!interests.goals.trim()) newErrors.goals = "Learning goals are required";
        }

        if (step === 4) {
            if (!acceptTerms) {
                newErrors.acceptTerms = "You must accept the terms and conditions to continue";
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (validateStep(currentStep)) {
            setCurrentStep((prev) => Math.min(prev + 1, 4));
        }
    };

    const handlePrevious = () => {
        setCurrentStep((prev) => Math.max(prev - 1, 1));
        setErrors({});
    };

    const handlePayment = async () => {
        setIsPaying(true);
        try {
            const result = await initiateAcademyPaymentAction();
            if (result.success && result.data?.paymentUrl) {
                window.location.href = result.data.paymentUrl;
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

    const handleSubmit = async () => {
        if (!validateStep(4)) return;

        setIsSubmitting(true);

        try {
            const enrichedPersonalInfo = {
                ...personalInfo,
                fullName: `${personalInfo.firstName} ${personalInfo.lastName}`.trim(),
            };
            const response = (isRevisionMode || isEditMode)
                ? await resubmitAcademyApplicationAction({ personalInfo: enrichedPersonalInfo, education, interests })
                : await submitAcademyApplicationAction({ personalInfo: enrichedPersonalInfo, education, interests });

            if (response.success) {
                router.push("/academy/application/pending");
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

    // Payment gate: show payment screen if not yet paid
    if (paymentStatus === "unpaid") {
        return (
            <div className="min-h-screen bg-slate-50">
                {/* Header */}
                <div className="bg-linear-to-r from-blue-600 to-indigo-600 text-white py-12">
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

                {/* Payment Card */}
                <div className="max-w-lg mx-auto px-6 -mt-8">
                    <div className="bg-white rounded-3xl shadow-xl p-8">
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CreditCard className="w-8 h-8 text-blue-600" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-2">Registration Payment</h2>
                            <p className="text-slate-600">
                                A one-time registration fee is required to proceed with your Academy application.
                            </p>
                        </div>

                        <div className="bg-blue-50 rounded-2xl p-6 mb-6">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-slate-700 font-medium">Registration Fee</span>
                                <span className="text-3xl font-extrabold text-blue-700">₦5,000</span>
                            </div>
                            <ul className="space-y-2 text-sm text-slate-600">
                                <li className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-blue-500 shrink-0" />
                                    Full access to learner application portal
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-blue-500 shrink-0" />
                                    Access to free courses upon approval
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-blue-500 shrink-0" />
                                    Certificate eligibility for completed courses
                                </li>
                            </ul>
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
                                    Pay ₦5,000 to Continue
                                </>
                            )}
                        </button>

                        <p className="text-center text-xs text-slate-400 mt-4">
                            Secured by Paystack. Your payment information is encrypted.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-linear-to-r from-blue-600 to-indigo-600 text-white py-12">
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
                                fullName: `${personalInfo.firstName} ${personalInfo.lastName}`.trim(),
                            }}
                            education={education}
                            interests={interests}
                            acceptTerms={acceptTerms}
                            onAcceptTermsChange={setAcceptTerms}
                            errors={errors}
                        />
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

                        {currentStep < 4 ? (
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
                                disabled={isSubmitting}
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
