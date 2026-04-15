"use client";

import { Target, Lightbulb, MessageSquare, CheckCircle2 } from "lucide-react";

interface InterestsData {
    learningPaths: string[];
    topics: string;
    goals: string;
}

interface InterestsStepProps {
    data: InterestsData;
    onChange: (data: InterestsData) => void;
    errors: Record<string, string>;
}

const LEARNING_PATHS = [
    {
        id: "farming",
        title: "Farming Excellence",
        description: "Modern farming techniques, crop management, and yield optimization",
        icon: "🌱"
    },
    {
        id: "export",
        title: "Export Mastery",
        description: "Documentation, compliance, and international trade regulations",
        icon: "📦"
    },
    {
        id: "agribusiness",
        title: "Agribusiness",
        description: "Business planning, financial management, and market strategy",
        icon: "💼"
    },
    {
        id: "technology",
        title: "Technology & Innovation",
        description: "AgTech, precision farming, and digital agriculture",
        icon: "🚀"
    }
];

export default function InterestsStep({ data, onChange, errors }: InterestsStepProps) {
    function handlePathToggle(pathId: string) {
        const updatedPaths = data.learningPaths.includes(pathId)
            ? data.learningPaths.filter((p) => p !== pathId)
            : [...data.learningPaths, pathId];
        onChange({ ...data, learningPaths: updatedPaths });
    };

    function handleChange(field: keyof InterestsData, value: string) {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    Learning Interests
                </h2>
                <p className="text-slate-600">
                    Tell us about your learning interests and goals so we can personalize your experience.
                </p>
            </div>

            <div>
                <label className="block text-sm font-semibold text-slate-900 mb-3">
                    Select Learning Paths (Choose at least one) *
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {LEARNING_PATHS.map((path) => (
                        <button
                            key={path.id}
                            type="button"
                            onClick={() => handlePathToggle(path.id)}
                            className={`relative p-4 rounded-lg border-2 text-left transition-all ${data.learningPaths.includes(path.id)
                                    ? "border-blue-600 bg-blue-50"
                                    : "border-slate-300 hover:border-blue-400"
                                }`}
                        >
                            {data.learningPaths.includes(path.id) && (
                                <div className="absolute top-3 right-3">
                                    <CheckCircle2 className="w-5 h-5 text-blue-600" />
                                </div>
                            )}
                            <div className="text-2xl mb-2">{path.icon}</div>
                            <h3 className="font-bold text-slate-900 mb-1">
                                {path.title}
                            </h3>
                            <p className="text-sm text-slate-600">
                                {path.description}
                            </p>
                        </button>
                    ))}
                </div>
                {errors.learningPaths && (
                    <p className="mt-2 text-sm text-red-600">{errors.learningPaths}</p>
                )}
            </div>

            <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                    Specific Topics of Interest
                </label>
                <div className="relative">
                    <Lightbulb className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                    <textarea
                        value={data.topics}
                        onChange={(e) => handleChange("topics", e.target.value)}
                        rows={4}
                        className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.topics ? "border-red-500" : "border-slate-300"
                            } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition resize-none`}
                        placeholder="e.g., Yam farming, Export documentation, Organic farming, Poultry management..."
                    />
                </div>
                {errors.topics && (
                    <p className="mt-1 text-sm text-red-600">{errors.topics}</p>
                )}
            </div>

            <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                    Learning Goals *
                </label>
                <div className="relative">
                    <Target className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                    <textarea
                        value={data.goals}
                        onChange={(e) => handleChange("goals", e.target.value)}
                        rows={4}
                        className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.goals ? "border-red-500" : "border-slate-300"
                            } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition resize-none`}
                        placeholder="What do you hope to achieve through the Academy? Be specific..."
                    />
                </div>
                {errors.goals && (
                    <p className="mt-1 text-sm text-red-600">{errors.goals}</p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                    Share your career aspirations, business plans, or personal development goals
                </p>
            </div>
        </div>
    );
}
