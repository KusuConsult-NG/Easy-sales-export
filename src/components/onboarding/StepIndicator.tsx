/**
 * Step Indicator Component
 * 
 * Visual indicator showing progress through multi-step forms
 */

"use client";

import { Check } from "lucide-react";
import { OnboardingStep } from "@/types/service-registration";

interface StepIndicatorProps {
    steps: OnboardingStep[];
    currentStepId: string;
}

export function StepIndicator({ steps, currentStepId }: StepIndicatorProps) {
    const currentIndex = steps.findIndex(step => step.id === currentStepId);

    return (
        <div className="w-full">
            {/* Steps Navigation */}
            <div className="flex items-center justify-between mb-8">
                {steps.map((step, index) => {
                    const isCompleted = step.completed;
                    const isCurrent = step.id === currentStepId;
                    const isPast = index < currentIndex;
                    const isLast = index === steps.length - 1;

                    return (
                        <div key={step.id} className="flex items-center flex-1">
                            {/* Step Circle */}
                            <div className="flex flex-col items-center">
                                <div
                                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isCompleted || isPast
                                            ? "bg-green-500 text-white"
                                            : isCurrent
                                                ? "bg-orange-500 text-white ring-4 ring-orange-100"
                                                : "bg-slate-200 text-slate-500"
                                        }`}
                                >
                                    {isCompleted || isPast ? (
                                        <Check className="w-5 h-5" />
                                    ) : (
                                        <span className="text-sm font-semibold">{index + 1}</span>
                                    )}
                                </div>

                                {/* Step Label */}
                                <div className="mt-2 text-center max-w-[100px]">
                                    <p
                                        className={`text-xs font-medium ${isCurrent
                                                ? "text-orange-600"
                                                : isCompleted || isPast
                                                    ? "text-green-600"
                                                    : "text-slate-500"
                                            }`}
                                    >
                                        {step.title}
                                    </p>
                                </div>
                            </div>

                            {/* Connector Line */}
                            {!isLast && (
                                <div
                                    className={`flex-1 h-1 mx-2 transition-all ${isPast || isCompleted
                                            ? "bg-green-500"
                                            : "bg-slate-200"
                                        }`}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Current Step Description */}
            {steps[currentIndex] && (
                <div className="bg-white rounded-lg p-4 border border-slate-200 mb-6">
                    <h3 className="font-semibold text-slate-900 mb-1">
                        {steps[currentIndex].title}
                    </h3>
                    <p className="text-sm text-slate-600">
                        {steps[currentIndex].description}
                    </p>
                </div>
            )}
        </div>
    );
}
