"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Home } from "lucide-react";

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
    serviceName,
}: OnboardingLayoutProps) {
    const backHref = serviceName ? `/${serviceName}` : "/dashboard";

    return (
        <div className="min-h-screen bg-white">
            {/* Navigation Header */}
            <div className="border-b border-slate-200 bg-white">
                <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
                    <Link
                        href={backHref}
                        className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </Link>
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm font-medium transition-colors"
                    >
                        <Home className="w-4 h-4" />
                        Hub
                    </Link>
                </div>
            </div>

            <div className="py-12 px-4">
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
        </div>
    );
}

