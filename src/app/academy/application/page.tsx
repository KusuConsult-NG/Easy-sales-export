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
    fullName: string;
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
    const { data: session } = useSession();
    const { showToast } = useToast();

    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await checkAcademyStatusAction();
                if (status === "pending" || status === "under_review") {
                    router.replace("/academy/application/pending");
                } else if (status === "approved" || status === "active") {
                    router.replace("/academy/dashboard");
                } else if (status === "revision_required") {
                    // Pre-populate form with existing data
                    const result = await getAcademyApplicationAction();
                    if (result.success && result.data) {
                        const d = result.data;
                        if (d.personalInfo) setPersonalInfo((prev: any) => ({ ...prev, ...d.personalInfo }));
                        if (d.education) setEducation((prev: any) => ({ ...prev, ...d.education }));
                        if (d.interests) setInterests((prev: any) => ({ ...prev, ...d.interests }));
                    }
                    if (result.revisionNote) setRevisionNote(result.revisionNote);
                    setIsRevisionMode(true);
                    // Check payment status — user already paid previously
                    const payStatus = await checkAcademyPaymentStatusAction();
                    setPaymentStatus(payStatus);
                    setIsLoading(false);
                } else {
                    // Check payment status
                    const payStatus = await checkAcademyPaymentStatusAction();
                    setPaymentStatus(payStatus);
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
        fullName: "",
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
        if (personalInfo.fullName) clearFieldError('fullName');
    }, [personalInfo.fullName]);

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
            if (!personalInfo.fullName.trim()) newErrors.fullName = "Full name is required";
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
            if (result.success && result.paymentUrl) {
                window.location.href = result.paymentUrl;
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
            const response = await submitAcademyApplicationAction({
                personalInfo,
                education,
                interests
            });

            if (response.success) {
                router.push("/academy/application/success");
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

            {/* Progress Steps */}
            <div className="max-w-4xl mx-auto px-6 -mt-8">
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
                            personalInfo={personalInfo}
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
