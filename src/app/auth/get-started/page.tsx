"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";
import type { UserRole } from "@/lib/types/roles";
import {
    Waves,
    Wheat,
    ShoppingCart,
    Users,
    GraduationCap,
    TrendingUp,
    Home
} from "lucide-react";

/**
 * Module Selection Page
 * 
 * New users must select which platform module they want to join.
 * Each module has its own onboarding flow and admin approval process.
 */

const modules = [
    {
        id: "wave",
        name: "WAVE",
        description: "Women Agro-processors Venture Empowerment",
        icon: Waves,
        color: "from-pink-500 to-rose-600",
        onboardingUrl: "/wave/application",
        eligibility: "Female agro-processors"
    },
    {
        id: "export",
        name: "Export Windows",
        description: "Agricultural Export Crowdfunding",
        icon: TrendingUp,
        color: "from-green-500 to-emerald-600",
        onboardingUrl: "/export/onboarding",
        eligibility: "Investors and exporters"
    },
    {
        id: "marketplace",
        name: "Marketplace",
        description: "Buy and sell agricultural products",
        icon: ShoppingCart,
        color: "from-blue-500 to-indigo-600",
        onboardingUrl: "/marketplace/onboarding",
        eligibility: "Buyers and sellers"
    },
    {
        id: "cooperatives",
        name: "Cooperatives",
        description: "Farmer cooperative savings and loans",
        icon: Users,
        color: "from-purple-500 to-violet-600",
        onboardingUrl: "/cooperatives/onboarding",
        eligibility: "Cooperative members"
    },
    {
        id: "farm-nation",
        name: "Farm Nation",
        description: "Agricultural land marketplace",
        icon: Wheat,
        color: "from-amber-500 to-orange-600",
        onboardingUrl: "/farm-nation/onboarding",
        eligibility: "Farmers, land owners, investors"
    },
    {
        id: "academy",
        name: "Academy",
        description: "Agricultural education and training",
        icon: GraduationCap,
        color: "from-teal-500 to-cyan-600",
        onboardingUrl: "/academy/setup",
        eligibility: "Learners and instructors"
    },
];

export default function GetStartedPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    // Redirect to login if not authenticated
    useEffect(() => {
        if (status === "unauthenticated") {
            router.replace("/auth/login");
        }
    }, [status, router]);

    // Covers "unauthenticated" as well as "loading".
    //
    // It used to return only for "loading", so an unauthenticated visitor fell
    // straight through to the body below with `session` null. Every block down
    // there is driven by session data, so nothing rendered: a signed-out
    // visitor to /auth/get-started got a COMPLETELY BLANK PAGE until the
    // redirect in the effect above landed — and if that redirect is slow or
    // does not fire, a blank page is all they ever get.
    //
    // Found by the page smoke suite, which asserts each route puts something
    // on screen. This was the only route in the application that did not.
    if (status !== "authenticated") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-slate-900 via-blue-900 to-slate-900">
                <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-white"></div>
            </div>
        );
    }

    const isMale = session?.user?.gender?.toLowerCase() === "male";
    const userCreatedAt = session?.user?.createdAt;
    
    // Define cutoff date: June 17, 2026
    const CUTOFF_DATE = new Date("2026-06-17T00:00:00.000Z");
    const registeredOnOrAfterCutoff = !!userCreatedAt && new Date(userCreatedAt) >= CUTOFF_DATE;
    const isNewMaleUser = isMale && registeredOnOrAfterCutoff;

    const roles = (session?.user?.roles as UserRole[]) || [];
    const serviceRegistrations = session?.user?.serviceRegistrations || {};
    const waveRegStatus = serviceRegistrations.wave?.status;
    const hasWaveAccess = roles.includes("wave_participant") || 
                          waveRegStatus === "approved" || 
                          waveRegStatus === "active" || 
                          waveRegStatus === "pending" || 
                          waveRegStatus === "under_review" ||
                          waveRegStatus === "revision_required";

    const isWaveBlocked = isMale && (isNewMaleUser || !hasWaveAccess);

    const filteredModules = modules.filter(m => !(m.id === "wave" && isWaveBlocked));

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 relative">
            {/* Back to Hub Navigation */}
            <div className="absolute top-4 left-4 z-50 md:top-8 md:left-8">
                <Link
                    href="/"
                    className="flex items-center gap-2 p-2 px-4 text-sm font-medium text-slate-600 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-full hover:text-slate-900 hover:border-slate-300 transition-all shadow-sm group"
                >
                    <Home className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span>Back to Hub</span>
                </Link>
            </div>

            <div className="max-w-6xl mx-auto pt-8">
                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-slate-900 mb-4">
                        Choose Your Module
                    </h1>
                    <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                        Select which platform you'd like to join. You'll need to complete an onboarding
                        application and wait for admin approval before accessing your dashboard.
                    </p>
                </div>

                {/* Module Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredModules.map((module) => {
                        const Icon = module.icon;
                        return (
                            <button
                                key={module.id}
                                onClick={() => router.push(module.onboardingUrl)}
                                className="group relative bg-white rounded-2xl p-6 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 text-left border border-slate-200"
                            >
                                {/* Icon */}
                                <div className={`w-16 h-16 rounded-xl bg-linear-to-br ${module.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                                    <Icon className="w-8 h-8 text-white" />
                                </div>

                                {/* Content */}
                                <h3 className="text-xl font-bold text-slate-900 mb-2">
                                    {module.name}
                                </h3>
                                <p className="text-slate-600 mb-4">
                                    {module.description}
                                </p>

                                {/* Eligibility */}
                                <div className="flex items-center gap-2 text-sm text-slate-500">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>{module.eligibility}</span>
                                </div>

                                {/* Arrow indicator */}
                                <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Help text */}
                <div className="mt-12 text-center">
                    <p className="text-sm text-slate-500">
                        Need help deciding?{" "}
                        <a href="/help" className="text-blue-600 hover:underline">
                            Learn more about each module
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
}
