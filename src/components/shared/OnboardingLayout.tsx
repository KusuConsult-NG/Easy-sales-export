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
        <div className="min-h-screen bg-white py-12 px-4">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-lg text-slate-900 mb-1">
                            {subtitle}
                        </p>
                    )}
                    {description && (
                        <p className="text-slate-600">
                            {description}
                        </p>
                    )}
                </div>
                {children}
            </div>
        </div>
    );
}
