"use client";

import { CheckCircle } from "lucide-react";

interface Step {
    id: number;
    title: string;
    description?: string;
}

interface StepIndicatorProps {
    steps: Step[];
    currentStep: number;
}

export default function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
    return (
        <div className="flex items-center justify-between mb-8">
            {steps.map((step, index) => (
                <div key={step.id} className="flex-1">
                    <div className="flex items-center">
                        <div className="flex flex-col items-center flex-1">
                            <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${currentStep > step.id
                                        ? "bg-green-600 text-white"
                                        : currentStep === step.id
                                            ? "bg-green-600 text-white"
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
                                {step.description && (
                                    <p className="text-xs text-slate-500 hidden md:block">
                                        {step.description}
                                    </p>
                                )}
                            </div>
                        </div>
                        {index < steps.length - 1 && (
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
    );
}
