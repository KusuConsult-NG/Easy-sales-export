"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
    GraduationCap, BookOpen, Target, CheckCircle,
    ArrowRight, ArrowLeft, Rocket
} from "lucide-react";

type SkillLevel = "beginner" | "intermediate" | "advanced";
type LearningPreference = "video" | "text" | "interactive" | "mixed";
type InterestArea = "export" | "farming" | "cooperative" | "business" | "general";

export default function AcademyOnboardingPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const [step, setStep] = useState(1);
    const totalSteps = 3;

    // Form state
    const [skillLevel, setSkillLevel] = useState<SkillLevel | "">("");
    const [learningPreference, setLearningPreference] = useState<LearningPreference | "">("");
    const [interests, setInterests] = useState<InterestArea[]>([]);

    const handleInterestToggle = (interest: InterestArea) => {
        setInterests(prev =>
            prev.includes(interest)
                ? prev.filter(i => i !== interest)
                : [...prev, interest]
        );
    };

    const handleComplete = async () => {
        // In a real app, save preferences to user profile
        // For now, just redirect to dashboard
        router.push("/academy/dashboard");
    };

    const isStepValid = () => {
        switch (step) {
            case 1: return skillLevel !== "";
            case 2: return learningPreference !== "";
            case 3: return interests.length > 0;
            default: return false;
        }
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-50 dark:from-slate-950 dark:to-indigo-950 py-8">
            <div className="max-w-3xl mx-auto px-4">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 mb-4">
                        <GraduationCap className="w-12 h-12 text-blue-600" />
                        <h1 className="text-4xl font-bold text-slate-900 dark:text-white">
                            Welcome to Academy
                        </h1>
                    </div>
                    <p className="text-lg text-slate-600 dark:text-slate-400">
                        Let's personalize your learning experience
                    </p>
                </div>

                {/* Progress Bar */}
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                        {[1, 2, 3].map(s => (
                            <div key={s} className="flex items-center flex-1">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${s <= step
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                                    }`}>
                                    {s < step ? <CheckCircle className="w-6 h-6" /> : s}
                                </div>
                                {s < totalSteps && (
                                    <div className={`flex-1 h-1 mx-2 ${s < step ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'
                                        }`} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                        <span>Skill Level</span>
                        <span>Preferences</span>
                        <span>Interests</span>
                    </div>
                </div>

                {/* Main Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8">
                    {/* Step 1: Skill Level */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                    What's your skill level?
                                </h2>
                                <p className="text-slate-600 dark:text-slate-400">
                                    This helps us recommend the right courses for you
                                </p>
                            </div>

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
                                            ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                                            : "border-slate-200 dark:border-slate-600 hover:border-blue-400"
                                            }`}
                                    >
                                        <div className="font-semibold text-slate-900 dark:text-white">
                                            {level.label}
                                        </div>
                                        <div className="text-sm text-slate-600 dark:text-slate-400">
                                            {level.desc}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Step 2: Learning Preference */}
                    {step === 2 && (
                        <div className="space-y-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                    How do you prefer to learn?
                                </h2>
                                <p className="text-slate-600 dark:text-slate-400">
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
                                            ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                                            : "border-slate-200 dark:border-slate-600 hover:border-blue-400"
                                            }`}
                                    >
                                        <div className="text-3xl mb-2">{pref.icon}</div>
                                        <div className="font-semibold text-slate-900 dark:text-white">
                                            {pref.label}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Step 3: Interest Areas */}
                    {step === 3 && (
                        <div className="space-y-6">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                    What areas interest you?
                                </h2>
                                <p className="text-slate-600 dark:text-slate-400">
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
                                            ? "border-blue-600 bg-blue-50 dark:bg-blue-900/20"
                                            : "border-slate-200 dark:border-slate-600 hover:border-blue-400"
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <CheckCircle className={`w-6 h-6 mt-0.5 ${interests.includes(interest.value)
                                                ? "text-blue-600"
                                                : "text-slate-300 dark:text-slate-600"
                                                }`} />
                                            <div className="flex-1">
                                                <div className="font-semibold text-slate-900 dark:text-white">
                                                    {interest.label}
                                                </div>
                                                <div className="text-sm text-slate-600 dark:text-slate-400">
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
                    <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
                        {step > 1 ? (
                            <button
                                onClick={() => setStep(s => s - 1)}
                                className="flex items-center gap-2 px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5" />
                                Back
                            </button>
                        ) : (
                            <Link
                                href="/academy"
                                className="flex items-center gap-2 px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5" />
                                Back to Academy
                            </Link>
                        )}

                        {step < totalSteps ? (
                            <button
                                onClick={() => setStep(s => s + 1)}
                                disabled={!isStepValid()}
                                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                            >
                                Next
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        ) : (
                            <button
                                onClick={handleComplete}
                                disabled={!isStepValid()}
                                className="px-8 py-4 bg-linear-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Rocket className="w-5 h-5" />
                                Start Learning
                            </button>
                        )}
                    </div>
                </div>

                {/* Skip Option */}
                <div className="text-center mt-6">
                    <button
                        onClick={() => router.push("/academy/dashboard")}
                        className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors underline"
                    >
                        Skip onboarding - I'll explore on my own
                    </button>
                </div>
            </div>
        </div>
    );
}
