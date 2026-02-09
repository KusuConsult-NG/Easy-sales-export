/**
 * Onboarding Layout
 * 
 * Shared layout component for all service onboarding flows
 */

"use client";

import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface OnboardingLayoutProps {
    children: ReactNode;
    serviceName: string;
    serviceIcon?: ReactNode;
    currentStep?: number;
    totalSteps?: number;
    backUrl?: string;
}

export function OnboardingLayout({
    children,
    serviceName,
    serviceIcon,
    currentStep,
    totalSteps,
    backUrl,
}: OnboardingLayoutProps) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <div className="max-w-4xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        {/* Back Button */}
                        {backUrl && (
                            <Link
                                href={backUrl}
                                className="flex items-center gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5" />
                                <span>Back</span>
                            </Link>
                        )}

                        {/* Service Title */}
                        <div className="flex items-center gap-3">
                            {serviceIcon && (
                                <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-600">
                                    {serviceIcon}
                                </div>
                            )}
                            <div>
                                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                                    {serviceName}
                                </h1>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Onboarding</p>
                            </div>
                        </div>

                        {/* Progress Indicator */}
                        {currentStep && totalSteps && (
                            <div className="text-sm text-slate-600 dark:text-slate-400">
                                Step {currentStep} of {totalSteps}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-4xl mx-auto px-4 py-8">
                {children}
            </div>
        </div>
    );
}
