"use client";

import { useState, useEffect } from "react";
import { X, ChevronRight, ChevronLeft, CheckCircle } from "lucide-react";

interface OnboardingTourProps {
    isOpen: boolean;
    onComplete: () => void;
    userRole: string;
}

const tourSteps = [
    {
        title: "Welcome to Easy Sales Export!",
        description: "Complete your profile to access all platform features. This quick tour will guide you through the essentials.",
        icon: "👋",
        action: "Get Started",
    },
    {
        title: "Complete Your Profile",
        description: "Add your contact information, business details, and upload a profile photo. A complete profile builds trust with other members.",
        icon: "👤",
        action: "Next",
    },
    {
        title: "Explore Platform Features",
        description: "Based on your role, you have access to: Marketplace, Export Aggregation, Cooperatives, Academy, and more. Navigate using the sidebar.",
        icon: "🚀",
        action: "Next",
    },
    {
        title: "Security & Verification",
        description: "Enable two-factor authentication, download your Digital ID, and verify your email for full platform access. Your security is our priority.",
        icon: "🔒",
        action: "Finish Tour",
    },
];

export default function OnboardingTour({ isOpen, onComplete, userRole }: OnboardingTourProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
        }
    }, [isOpen]);

    if (!isVisible) return null;

    const step = tourSteps[currentStep];
    const isLastStep = currentStep === tourSteps.length - 1;

    const handleNext = () => {
        if (isLastStep) {
            handleClose();
        } else {
            setCurrentStep((prev) => prev + 1);
        }
    };

    const handlePrevious = () => {
        if (currentStep > 0) {
            setCurrentStep((prev) => prev - 1);
        }
    };

    const handleClose = () => {
        setIsVisible(false);
        onComplete();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden">
                {/* Progress Bar */}
                <div className="h-2 bg-slate-200 dark:bg-slate-700">
                    <div
                        className="h-full bg-linear-to-r from-blue-500 to-indigo-600 transition-all duration-300"
                        style={{ width: `${((currentStep + 1) / tourSteps.length) * 100}%` }}
                    />
                </div>

                {/* Header */}
                <div className="p-8 pb-6">
                    <div className="flex items-start justify-between mb-6">
                        <div className="flex items-center space-x-4">
                            <div className="text-6xl">{step.icon}</div>
                            <div>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Step {currentStep + 1} of {tourSteps.length}
                                </p>
                                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mt-1">
                                    {step.title}
                                </h2>
                            </div>
                        </div>
                    </div>

                    <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
                        {step.description}
                    </p>
                </div>

                {/* Step Indicators */}
                <div className="px-8 pb-6">
                    <div className="flex space-x-2">
                        {tourSteps.map((_, index) => (
                            <div
                                key={index}
                                className={`h-2 rounded-full flex-1 transition-all ${index <= currentStep
                                        ? "bg-blue-600"
                                        : "bg-slate-200 dark:bg-slate-700"
                                    }`}
                            />
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-slate-50 dark:bg-slate-900/50 px-8 py-6">
                    <div className="flex items-center justify-between">
                        <button
                            onClick={handlePrevious}
                            disabled={currentStep === 0}
                            className="flex items-center space-x-2 px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft className="w-5 h-5" />
                            <span>Previous</span>
                        </button>

                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleNext}
                                className="flex items-center space-x-2 px-6 py-3 bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg font-semibold transition shadow-lg shadow-blue-500/30"
                            >
                                <span>{step.action}</span>
                                {!isLastStep && <ChevronRight className="w-5 h-5" />}
                                {isLastStep && <CheckCircle className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>

                    <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-4">
                        You can access this tour anytime from your profile settings
                    </p>
                </div>
            </div>
        </div>
    );
}
