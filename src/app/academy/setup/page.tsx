"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
    GraduationCap, BookOpen, Target, CheckCircle,
    ArrowRight, ArrowLeft, Rocket, Loader2, Clock, XCircle, Home, CreditCard, Shield
} from "lucide-react";
import { checkAcademyStatusAction, submitAcademyApplicationAction, AcademyApplicationData } from "@/app/actions/academy";
import { getUserProfileAction } from "@/app/actions/profile";
import { useToast } from "@/contexts/ToastContext";
import { logger } from "@/lib/logger";
import { NIGERIAN_LOCATIONS, STATES } from "@/lib/locations";

type SkillLevel = "beginner" | "intermediate" | "advanced";
type LearningPreference = "video" | "text" | "interactive" | "mixed";
type InterestArea = "export" | "farming" | "cooperative" | "business" | "general";

export default function AcademyOnboardingPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const { showToast } = useToast();
    const [step, setStep] = useState(1);
    const totalSteps = 4;

    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [applicationStatus, setApplicationStatus] = useState<string | null>(null);

    // Resolved structured name from Firestore (not JWT string split)
    const [resolvedFirstName, setResolvedFirstName] = useState("");
    const [resolvedLastName, setResolvedLastName] = useState("");
    const [resolvedOtherName, setResolvedOtherName] = useState("");

    // Form state
    const [phone, setPhone] = useState("");
    const [dateOfBirth, setDateOfBirth] = useState("");
    const [gender, setGender] = useState("");
    const [state, setState] = useState("");
    const [lga, setLga] = useState("");
    const [occupation, setOccupation] = useState("");

    const [skillLevel, setSkillLevel] = useState<SkillLevel | "">("");
    const [learningPreference, setLearningPreference] = useState<LearningPreference | "">("");
    const [interests, setInterests] = useState<InterestArea[]>([]);
    const [educationLevel, setEducationLevel] = useState("");
    const [fieldOfStudy, setFieldOfStudy] = useState("");
    const [currentRole, setCurrentRole] = useState("");

    useEffect(() => {
        if (sessionStatus === "loading") return;

        if (sessionStatus === "unauthenticated") {
            router.replace("/auth/login?module=academy");
            return;
        }

        const checkStatus = async () => {
            try {
                // 1. Load structured name from Firestore root (NOT from JWT split)
                const profileResult = await getUserProfileAction();
                if (profileResult.success && profileResult.data) {
                    const p = profileResult.data as any;
                    setResolvedFirstName(p.firstName || "");
                    setResolvedLastName(p.lastName || "");
                    setResolvedOtherName(p.otherName || "");
                    // Pre-fill phone if already on profile
                    if (p.phone) setPhone(p.phone);
                    if (p.stateOfOrigin) setState(p.stateOfOrigin);
                }

                // 2. Check application status
                const status = await checkAcademyStatusAction();
                setApplicationStatus(status.data || "none");

                if (status.data === "approved") {
                    router.replace("/academy/dashboard");
                } else if (status.data === "pending" || status.data === "rejected") {
                    setIsLoading(false);
                } else {
                    setIsLoading(false);
                }
            } catch (error) {
                logger.error("Failed to check Academy status:", error);
                setIsLoading(false);
            }
        };

        checkStatus();
    }, [sessionStatus, router]);

    function handleInterestToggle(interest: InterestArea) {
        setInterests(prev =>
            prev.includes(interest)
                ? prev.filter(i => i !== interest)
                : [...prev, interest]
        );
    };

    async function handleComplete() {
        if (!session?.user) return;
        setIsSubmitting(true);

        try {
            // Compute fullName from structured Firestore names — NOT from session.user.name split
            const computedFullName = [resolvedFirstName, resolvedOtherName, resolvedLastName]
                .filter(Boolean).join(" ").trim() || session.user.name || "";

            const applicationData: AcademyApplicationData = {
                personalInfo: {
                    firstName: resolvedFirstName || session.user.name?.split(" ")[0] || "",
                    lastName: resolvedLastName || "",
                    otherName: resolvedOtherName || undefined,
                    fullName: computedFullName,
                    email: session.user.email || "",
                    phone: phone,
                    dateOfBirth: dateOfBirth,
                    gender: gender,
                    state: state,
                    lga: lga,
                    occupation: occupation,
                },
                education: {
                    educationLevel: educationLevel,
                    fieldOfStudy: fieldOfStudy,
                    yearsExperience: skillLevel === "beginner" ? 0 : skillLevel === "intermediate" ? 2 : 5,
                    currentRole: currentRole || occupation,
                },
                interests: {
                    learningPaths: interests,
                    topics: learningPreference,
                    goals: `Improve skills in: ${interests.join(", ")}`,
                }
            };

            const result = await submitAcademyApplicationAction(applicationData);

            if (result.success) {
                showToast("Application submitted successfully!", "success");
                setApplicationStatus("pending");
            } else {
                showToast(result.error || "Failed to submit application", "error");
            }
        } catch (error) {
            logger.error("Error submitting Academy application:", error);
            showToast("An unexpected error occurred", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const isStepValid = () => {
        switch (step) {
            case 1: return phone !== "" && dateOfBirth !== "" && gender !== "" && state !== "" && lga !== "" && occupation !== "";
            case 2: return educationLevel !== "" && skillLevel !== "";
            case 3: return learningPreference !== "";
            case 4: return interests.length > 0;
            default: return false;
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    // PENDING STATE
    if (applicationStatus === "pending") {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Clock className="w-8 h-8 text-yellow-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                        Application Pending
                    </h2>
                    <p className="text-slate-600 mb-6">
                        Your application to join the Academy is currently under review. We will notify you once it has been approved.
                    </p>
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-slate-100 text-slate-900 rounded-xl font-medium hover:bg-slate-200 transition-colors"
                    >
                        Return to Hub
                    </Link>
                </div>
            </div>
        );
    }

    // REJECTED STATE
    if (applicationStatus === "rejected") {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <XCircle className="w-8 h-8 text-red-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                        Application Rejected
                    </h2>
                    <p className="text-slate-600 mb-6">
                        Unfortunately, your application to the Academy was not approved. Please contact support for more information.
                    </p>
                    <div className="flex flex-col gap-3">
                        <button
                            onClick={() => setApplicationStatus(null)}
                            className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
                        >
                            Try Again
                        </button>
                        <Link
                            href="/dashboard"
                            className="w-full px-6 py-3 bg-slate-100 text-slate-900 rounded-xl font-medium hover:bg-slate-200 transition-colors"
                        >
                            Return to Hub
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-50">
            {/* Navigation */}
            <div className="border-b border-slate-200 bg-white">
                <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
                    <Link
                        href="/academy"
                        className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </Link>
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium"
                    >
                        <Home className="w-4 h-4" />
                        Hub
                    </Link>
                </div>
            </div>

            <div className="py-8">
                <div className="max-w-3xl mx-auto px-4">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center gap-2 mb-4">
                            <GraduationCap className="w-12 h-12 text-blue-600" />
                            <h1 className="text-4xl font-bold text-slate-900">
                                Welcome to Academy
                            </h1>
                        </div>
                        <p className="text-lg text-slate-600">
                            Let's personalize your learning experience
                        </p>
                    </div>

                    {/* Progress Bar */}
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-2">
                            {[1, 2, 3, 4].map(s => (
                                <div key={s} className="flex items-center flex-1">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${s <= step
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-slate-200 text-slate-500'
                                        }`}>
                                        {s < step ? <CheckCircle className="w-6 h-6" /> : s}
                                    </div>
                                    {s < totalSteps && (
                                        <div className={`flex-1 h-1 mx-2 ${s < step ? 'bg-blue-600' : 'bg-slate-200'
                                            }`} />
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-between text-xs text-slate-600">
                            <span>Profile</span>
                            <span>Education</span>
                            <span>Preferences</span>
                            <span>Interests</span>
                        </div>
                    </div>

                    {/* Main Card */}
                    <div className="bg-white rounded-2xl shadow-xl p-8">
                        {/* Step 1: Personal Details */}
                        {step === 1 && (
                            <div className="space-y-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                                        Let's get to know you
                                    </h2>
                                    <p className="text-slate-600">
                                        Please provide some basic details for your Academy profile
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-900">Phone Number</label>
                                        <input
                                            type="tel"
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                            placeholder="+234 XXX XXX XXXX"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-900">Date of Birth</label>
                                        <input
                                            type="date"
                                            value={dateOfBirth}
                                            onChange={(e) => setDateOfBirth(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-900">Gender</label>
                                        <select
                                            value={gender}
                                            onChange={(e) => setGender(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        >
                                            <option value="">Select gender...</option>
                                            <option value="male">Male</option>
                                            <option value="female">Female</option>
                                            <option value="other">Other</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-900">Occupation</label>
                                        <input
                                            type="text"
                                            value={occupation}
                                            onChange={(e) => setOccupation(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                            placeholder="e.g. Farmer, Consultant"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-900">State of Residence</label>
                                        <select
                                            value={state}
                                            onChange={(e) => { setState(e.target.value); setLga(""); }}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        >
                                            <option value="">Select state...</option>
                                            {STATES.map((s) => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-900">LGA</label>
                                        <select
                                            value={lga}
                                            onChange={(e) => setLga(e.target.value)}
                                            disabled={!state}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition disabled:opacity-50"
                                        >
                                            <option value="">Select LGA...</option>
                                            {state && NIGERIAN_LOCATIONS[state]?.map((l) => (
                                                <option key={l} value={l}>{l}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Education + Skill Level */}
                        {step === 2 && (
                            <div className="space-y-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                                        Education &amp; Experience
                                    </h2>
                                    <p className="text-slate-600">
                                        Help us tailor your learning path
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-900">Education Level</label>
                                        <select
                                            value={educationLevel}
                                            onChange={(e) => setEducationLevel(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                        >
                                            <option value="">Select level...</option>
                                            <option value="primary">Primary School</option>
                                            <option value="secondary">Secondary School</option>
                                            <option value="vocational">Vocational / OND</option>
                                            <option value="bachelor">Bachelor&apos;s Degree</option>
                                            <option value="postgraduate">Postgraduate</option>
                                            <option value="none">No Formal Education</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-900">Field of Study <span className="text-slate-400 font-normal">(optional)</span></label>
                                        <input
                                            type="text"
                                            value={fieldOfStudy}
                                            onChange={(e) => setFieldOfStudy(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                            placeholder="e.g. Agriculture, Business"
                                        />
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <label className="block text-sm font-semibold text-slate-900">Current Role <span className="text-slate-400 font-normal">(optional)</span></label>
                                        <input
                                            type="text"
                                            value={currentRole}
                                            onChange={(e) => setCurrentRole(e.target.value)}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                            placeholder="e.g. Farm Manager, Entrepreneur"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <p className="text-sm font-semibold text-slate-900 mb-3">Skill Level</p>
                                    <div className="space-y-3">
                                        {[
                                            { value: "beginner" as SkillLevel, label: "Beginner", desc: "New to agricultural export and business" },
                                            { value: "intermediate" as SkillLevel, label: "Intermediate", desc: "Some experience in farming or business" },
                                            { value: "advanced" as SkillLevel, label: "Advanced", desc: "Experienced in agricultural export" }
                                        ].map(level => (
                                            <button
                                                key={level.value}
                                                onClick={() => setSkillLevel(level.value)}
                                                className={`w-full p-4 border-2 rounded-lg text-left transition-all ${skillLevel === level.value
                                                    ? "border-blue-600 bg-blue-50"
                                                    : "border-slate-200 hover:border-blue-400"
                                                    }`}
                                            >
                                                <div className="font-semibold text-slate-900">{level.label}</div>
                                                <div className="text-sm text-slate-600">{level.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 3: Learning Preference */}
                        {step === 3 && (
                            <div className="space-y-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                                        How do you prefer to learn?
                                    </h2>
                                    <p className="text-slate-600">
                                        We'll prioritize content in your preferred format
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    {[
                                        { value: "video" as LearningPreference, label: "Video Lessons", icon: "🎥" },
                                        { value: "text" as LearningPreference, label: "Reading Materials", icon: "📚" },
                                        { value: "interactive" as LearningPreference, label: "Interactive Modules", icon: "🎮" },
                                        { value: "mixed" as LearningPreference, label: "Mixed Content", icon: "🌟" }
                                    ].map(pref => (
                                        <button
                                            key={pref.value}
                                            onClick={() => setLearningPreference(pref.value)}
                                            className={`p-4 border-2 rounded-lg transition-all ${learningPreference === pref.value
                                                ? "border-blue-600 bg-blue-50"
                                                : "border-slate-200 hover:border-blue-400"
                                                }`}
                                        >
                                            <div className="text-3xl mb-2">{pref.icon}</div>
                                            <div className="font-semibold text-slate-900">
                                                {pref.label}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Step 4: Interest Areas */}
                        {step === 4 && (
                            <div className="space-y-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 mb-2">
                                        What areas interest you?
                                    </h2>
                                    <p className="text-slate-600">
                                        Select all that apply - we'll recommend relevant courses
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    {[
                                        { value: "export" as InterestArea, label: "Agricultural Export", desc: "Learn about international trade and export processes" },
                                        { value: "farming" as InterestArea, label: "Modern Farming", desc: "Advanced agricultural techniques and best practices" },
                                        { value: "cooperative" as InterestArea, label: "Cooperative Management", desc: "Running and managing agricultural cooperatives" },
                                        { value: "business" as InterestArea, label: "Agribusiness", desc: "Business skills for agricultural entrepreneurs" },
                                        { value: "general" as InterestArea, label: "General Skills", desc: "General professional development and soft skills" }
                                    ].map(interest => (
                                        <button
                                            key={interest.value}
                                            onClick={() => handleInterestToggle(interest.value)}
                                            className={`w-full p-4 border-2 rounded-lg text-left transition-all ${interests.includes(interest.value)
                                                ? "border-blue-600 bg-blue-50"
                                                : "border-slate-200 hover:border-blue-400"
                                                }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <CheckCircle className={`w-6 h-6 mt-0.5 ${interests.includes(interest.value)
                                                    ? "text-blue-600"
                                                    : "text-slate-300"
                                                    }`} />
                                                <div className="flex-1">
                                                    <div className="font-semibold text-slate-900">
                                                        {interest.label}
                                                    </div>
                                                    <div className="text-sm text-slate-600">
                                                        {interest.desc}
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Navigation */}
                        <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
                            {step > 1 ? (
                                <button
                                    onClick={() => setStep(s => s - 1)}
                                    disabled={isSubmitting}
                                    className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors"
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                    Back
                                </button>
                            ) : (
                                <Link
                                    href="/dashboard"
                                    className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors"
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                    Back to Hub
                                </Link>
                            )}

                            {step < totalSteps ? (
                                <button
                                    onClick={() => setStep(s => s + 1)}
                                    disabled={!isStepValid() || isSubmitting}
                                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                                >
                                    Next
                                    <ArrowRight className="w-5 h-5" />
                                </button>
                            ) : (
                                <button
                                    onClick={handleComplete}
                                    disabled={!isStepValid() || isSubmitting}
                                    className="px-8 py-4 bg-linear-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Rocket className="w-5 h-5" />}
                                    {isSubmitting ? "Submitting..." : "Start Learning"}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Skip Option */}
                    <div className="text-center mt-6">
                        <button
                            onClick={() => router.push("/academy/dashboard")}
                            disabled={isSubmitting}
                            className="text-sm text-slate-600 hover:text-slate-900 transition-colors underline"
                        >
                            Skip onboarding - I'll explore on my own
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
