"use client";

import { ReactNode } from "react";

interface OnboardingLayoutProps {
    children: ReactNode;
    title: string;
    subtitle?: string;
    description?: string;
    serviceName?: string;
}

export default function OnboardingLayout({
    children,
    title,
    subtitle,
    description,
    // serviceName prop available for future use
}: OnboardingLayoutProps) {
    return (
        <div className="min-h-screen bg-linear-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-lg text-slate-900 dark:text-white mb-1">
                            {subtitle}
                        </p>
                    )}
                    {description && (
                        <p className="text-slate-600 dark:text-slate-400">
                            {description}
                        </p>
                    )}
                </div>
                {children}
            </div>
        </div>
    );
}
