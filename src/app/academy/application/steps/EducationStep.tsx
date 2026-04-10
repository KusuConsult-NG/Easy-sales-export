"use client";

import { GraduationCap, BookOpen, TrendingUp, Briefcase } from "lucide-react";

interface EducationData {
    educationLevel: string;
    fieldOfStudy: string;
    yearsExperience: number;
    currentRole: string;
}

interface EducationStepProps {
    data: EducationData;
    onChange: (data: EducationData) => void;
    errors: Record<string, string>;
}

const EDUCATION_LEVELS = [
    "No Formal Education",
    "Primary Education",
    "Secondary Education (SSCE/WAEC/NECO)",
    "National Diploma (ND)",
    "Higher National Diploma (HND)",
    "Bachelor's Degree (BSc/BA/BTech)",
    "Master's Degree (MSc/MA/MBA)",
    "Doctorate (PhD)",
    "Other"
];

const CURRENT_ROLES = [
    "Farmer",
    "Student",
    "Agricultural Professional",
    "Business Owner",
    "Entrepreneur",
    "Extension Worker",
    "Researcher",
    "Government Employee",
    "NGO Worker",
    "Unemployed",
    "Other"
];

export default function EducationStep({ data, onChange, errors }: EducationStepProps) {
    const handleChange = (field: keyof EducationData, value: string | number) => {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="max-w-xl mx-auto space-y-4">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    Educational Background
                </h2>
                <p className="text-slate-600">
                    Help us understand your educational and professional background.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Highest Education Level *
                    </label>
                    <div className="relative">
                        <GraduationCap className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            value={data.educationLevel}
                            onChange={(e) => handleChange("educationLevel", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.educationLevel ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                        >
                            <option value="">Select education level</option>
                            {EDUCATION_LEVELS.map((level) => (
                                <option key={level} value={level}>
                                    {level}
                                </option>
                            ))}
                        </select>
                    </div>
                    {errors.educationLevel && (
                        <p className="mt-1 text-sm text-red-600">{errors.educationLevel}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Field of Study
                    </label>
                    <div className="relative">
                        <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={data.fieldOfStudy}
                            onChange={(e) => handleChange("fieldOfStudy", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.fieldOfStudy ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="e.g., Agricultural Science, Business, Engineering"
                        />
                    </div>
                    {errors.fieldOfStudy && (
                        <p className="mt-1 text-sm text-red-600">{errors.fieldOfStudy}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Years of Experience in Agriculture *
                    </label>
                    <div className="relative">
                        <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="number"
                            min="0"
                            max="50"
                            value={data.yearsExperience}
                            onChange={(e) => handleChange("yearsExperience", parseInt(e.target.value) || 0)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.yearsExperience ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="0"
                        />
                    </div>
                    {errors.yearsExperience && (
                        <p className="mt-1 text-sm text-red-600">{errors.yearsExperience}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                        Enter 0 if you're just starting out
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Current Role *
                    </label>
                    <div className="relative">
                        <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            value={data.currentRole}
                            onChange={(e) => handleChange("currentRole", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.currentRole ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                        >
                            <option value="">Select your current role</option>
                            {CURRENT_ROLES.map((role) => (
                                <option key={role} value={role}>
                                    {role}
                                </option>
                            ))}
                        </select>
                    </div>
                    {errors.currentRole && (
                        <p className="mt-1 text-sm text-red-600">{errors.currentRole}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
