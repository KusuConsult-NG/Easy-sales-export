"use client";

import { Check, User, GraduationCap, Target, Calendar, MapPin, Briefcase, Phone, BookOpen, TrendingUp, Lightbulb } from "lucide-react";

interface ReviewStepProps {
    personalInfo: {
        fullName: string;
        email: string;
        phone: string;
        dateOfBirth: string;
        state: string;
        occupation: string;
    };
    education: {
        educationLevel: string;
        fieldOfStudy: string;
        yearsExperience: number;
        currentRole: string;
    };
    interests: {
        learningPaths: string[];
        topics: string;
        goals: string;
    };
    acceptTerms: boolean;
    onAcceptTermsChange: (accepted: boolean) => void;
    errors: Record<string, string>;
}

const LEARNING_PATH_NAMES: Record<string, string> = {
    farming: "Farming Excellence",
    export: "Export Mastery",
    agribusiness: "Agribusiness",
    technology: "Technology & Innovation"
};

export default function ReviewStep({
    personalInfo,
    education,
    interests,
    acceptTerms,
    onAcceptTermsChange,
    errors
}: ReviewStepProps) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                    Review Your Application
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Please review your information before submitting your learner application.
                </p>
            </div>

            {/* Personal Information */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                        <User className="w-5 h-5 text-blue-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Personal Information</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Full Name</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{personalInfo.fullName}</p>
                    </div>
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Email</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{personalInfo.email}</p>
                    </div>
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Phone</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{personalInfo.phone}</p>
                    </div>
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Date of Birth</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{personalInfo.dateOfBirth}</p>
                    </div>
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">State</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{personalInfo.state}</p>
                    </div>
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Occupation</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{personalInfo.occupation}</p>
                    </div>
                </div>
            </div>

            {/* Educational Background */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                        <GraduationCap className="w-5 h-5 text-blue-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Educational Background</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Education Level</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{education.educationLevel}</p>
                    </div>
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Field of Study</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{education.fieldOfStudy || "Not specified"}</p>
                    </div>
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Years of Experience</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{education.yearsExperience} years</p>
                    </div>
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Current Role</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{education.currentRole}</p>
                    </div>
                </div>
            </div>

            {/* Learning Interests */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                        <Target className="w-5 h-5 text-blue-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Learning Interests</h3>
                </div>
                <div className="space-y-4 text-sm">
                    <div>
                        <p className="text-slate-500 dark:text-slate-400 mb-2">Selected Learning Paths</p>
                        <div className="flex flex-wrap gap-2">
                            {interests.learningPaths.map((pathId) => (
                                <span
                                    key={pathId}
                                    className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-semibold"
                                >
                                    <Check className="w-3 h-3" />
                                    {LEARNING_PATH_NAMES[pathId]}
                                </span>
                            ))}
                        </div>
                    </div>
                    {interests.topics && (
                        <div>
                            <p className="text-slate-500 dark:text-slate-400">Topics of Interest</p>
                            <p className="font-semibold text-slate-900 dark:text-white">{interests.topics}</p>
                        </div>
                    )}
                    <div>
                        <p className="text-slate-500 dark:text-slate-400">Learning Goals</p>
                        <p className="font-semibold text-slate-900 dark:text-white">{interests.goals}</p>
                    </div>
                </div>
            </div>

            {/* Terms and Conditions */}
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-3">
                    <input
                        type="checkbox"
                        id="acceptTerms"
                        checked={acceptTerms}
                        onChange={(e) => onAcceptTermsChange(e.target.checked)}
                        className="mt-1 w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-2 focus:ring-blue-500"
                    />
                    <label htmlFor="acceptTerms" className="text-sm text-slate-700 dark:text-slate-300">
                        I confirm that all the information provided is accurate and complete. I accept the{" "}
                        <a href="#" className="text-blue-600 hover:underline font-semibold">
                            Terms and Conditions
                        </a>{" "}
                        and{" "}
                        <a href="#" className="text-blue-600 hover:underline font-semibold">
                            Privacy Policy
                        </a>{" "}
                        of Easy Sales Academy.
                    </label>
                </div>
                {errors.acceptTerms && (
                    <p className="mt-2 text-sm text-red-600">{errors.acceptTerms}</p>
                )}
            </div>

            <div className="bg-slate-100 dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                    <strong>Note:</strong> Upon submission, your application will be reviewed. You'll receive a confirmation email with next steps for accessing the Academy courses.
                </p>
            </div>
        </div>
    );
}
