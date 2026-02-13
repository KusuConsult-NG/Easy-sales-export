"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Users, ShoppingBag, GraduationCap, Globe, Tractor, ArrowRight } from "lucide-react";
import { COMPANY_INFO } from "@/lib/constants";

const REGISTRATION_PATHS = [
    {
        id: "cooperative",
        title: "Cooperative Member",
        description: "Join a cooperative to access loans, savings, and community support.",
        icon: Users,
        color: "bg-purple-600",
        href: "/cooperatives/register", // Direct specific register
        benefits: ["Access low-interest loans", "High-yield savings", "Community network"],
    },
    {
        id: "wave",
        title: "WAVE Application",
        description: "Women's Agribusiness Venture Empowerment program application.",
        icon: Globe, // or Flower/Sprout if available
        color: "bg-green-600",
        href: "/wave/application", // WAVE Official Beneficiary Application Form
        benefits: ["Business grants", "Mentorship", "Exclusive training"],
    },
    {
        id: "export-windows",
        title: "Export Windows",
        description: "Join bulk export opportunities and access international markets.",
        icon: ShoppingBag,
        color: "bg-blue-600",
        href: "/auth/register?platforms[]=export&callbackUrl=/export/opportunities",
        benefits: ["International buyers", "Volume aggregation", "Premium pricing"],
    },
    {
        id: "marketplace",
        title: "Marketplace",
        description: "Buy and sell agricultural products in our verified marketplace.",
        icon: ShoppingBag,
        color: "bg-violet-600",
        href: "/auth/register?platforms[]=marketplace&callbackUrl=/marketplace",
        benefits: ["Verified buyers & sellers", "Secure payments", "Nationwide delivery"],
    },
    {
        id: "farm-nation",
        title: "Farm Nation Investor",
        description: "Invest in agricultural land and verified farm projects.",
        icon: Tractor,
        color: "bg-emerald-600",
        href: "/auth/register?platforms[]=farm-nation&callbackUrl=/farm-nation", // Redirect to landing/dashboard
        benefits: ["Land ownership", "Passive income", "Managed farming"],
    },
    {
        id: "academy",
        title: "Academy Student",
        description: "Learn modern farming techniques and business skills.",
        icon: GraduationCap,
        color: "bg-orange-600",
        href: "/auth/register?platforms[]=academy&callbackUrl=/academy/application", // Redirect to application
        benefits: ["Certified courses", "Expert instructors", "Practical training"],
    },
];

export default function GetStartedPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <Image
                            src="/images/logo.jpg"
                            alt={COMPANY_INFO.name}
                            width={40}
                            height={40}
                            className="w-10 h-10 rounded-xl"
                        />
                        <span className="font-bold text-xl text-slate-900 dark:text-white hidden sm:block">
                            {COMPANY_INFO.name}
                        </span>
                    </Link>
                    <div className="flex items-center gap-4">
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                            Already have an account?
                        </span>
                        <Link
                            href="/auth/login"
                            className="text-sm font-semibold text-primary hover:underline"
                        >
                            Sign In
                        </Link>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 py-16">
                <div className="text-center mb-16">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-4">
                        How would you like to join?
                    </h1>
                    <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                        Choose the path that best fits your goals. You can always explore other features later.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {REGISTRATION_PATHS.map((path) => (
                        <Link
                            key={path.id}
                            href={path.href}
                            className="group bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-xl border border-slate-200 dark:border-slate-700 hover:border-primary/50 transition-all duration-300 flex flex-col h-full"
                        >
                            <div className={`w-12 h-12 rounded-xl ${path.color} text-white flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform`}>
                                <path.icon className="w-6 h-6" />
                            </div>

                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3 group-hover:text-primary transition-colors">
                                {path.title}
                            </h3>

                            <p className="text-slate-600 dark:text-slate-400 mb-6 grow">
                                {path.description}
                            </p>

                            <div className="space-y-2 mb-6">
                                {path.benefits.map((benefit, i) => (
                                    <div key={i} className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-500">
                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                                        {benefit}
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center gap-2 text-primary font-semibold mt-auto group-hover:gap-3 transition-all">
                                Get Started
                                <ArrowRight className="w-4 h-4" />
                            </div>
                        </Link>
                    ))}
                </div>

                <div className="mt-16 text-center">
                    <p className="text-slate-500 dark:text-slate-400">
                        Not sure where to start?{" "}
                        <Link href="/auth/register" className="text-primary font-semibold hover:underline">
                            Create a General Account
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
