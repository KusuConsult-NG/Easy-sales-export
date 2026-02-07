"use client";

import HubHero from "@/components/hub/HubHero";
import ModuleCard from "@/components/hub/ModuleCard";
import PlatformStats from "@/components/hub/PlatformStats";
import Link from "next/link";
import {
    Package,
    ShoppingCart,
    Map,
    GraduationCap,
    Users,
    Building2,
    Wallet,
    ArrowRight
} from "lucide-react";

export default function HubPage() {
    const modules = [
        {
            title: "Export Windows",
            description: "Manage international agricultural exports with escrow protection and collective opportunities",
            icon: Package,
            href: "/export",
            gradient: "from-blue-500 to-cyan-500",
            stats: "1,247 Active Exports",
        },
        {
            title: "Marketplace",
            description: "Buy and sell agricultural products directly from verified farmers and traders",
            icon: ShoppingCart,
            href: "/marketplace",
            gradient: "from-orange-500 to-amber-500",
            stats: "3,856 Products Listed",
        },
        {
            title: "Farm Nation",
            description: "Invest in premium farmland and earn guaranteed returns on agricultural real estate",
            icon: Map,
            href: "/farm-nation",
            gradient: "from-green-500 to-emerald-500",
            stats: "156 Land Parcels",
        },
        {
            title: "Academy LMS",
            description: "Learn modern farming techniques and earn certifications from industry experts",
            icon: GraduationCap,
            href: "/academy",
            gradient: "from-purple-500 to-pink-500",
            stats: "8,932 Courses Completed",
            isNew: true,
        },
        {
            title: "WAVE Program",
            description: "Women in Agriculture Venture Excellence - Empowerment loans and training",
            icon: Users,
            href: "/wave",
            gradient: "from-pink-500 to-rose-500",
            stats: "₦850M+ Disbursed",
        },
        {
            title: "Cooperatives",
            description: "Join farming communities for shared resources, knowledge, and collective bargaining",
            icon: Building2,
            href: "/cooperatives",
            gradient: "from-indigo-500 to-blue-500",
            stats: "89 Active Groups",
        },
        {
            title: "Savings",
            description: "Flexible and fixed savings plans with competitive returns for financial growth",
            icon: Wallet,
            href: "/cooperatives/my-savings",
            gradient: "from-teal-500 to-green-500",
            stats: "Up to 18% Annual Returns",
        },
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Hero Section */}
            <HubHero />

            {/* Platform Statistics */}
            <PlatformStats />

            {/* Modules Showcase */}
            <section className="py-20">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="text-center mb-12">
                        <h2 className="text-4xl font-bold text-slate-900 dark:text-white mb-4">
                            Explore Our Platform
                        </h2>
                        <p className="text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                            Comprehensive solutions for modern agricultural business -
                            from exports to education
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {modules.map((module, index) => (
                            <div
                                key={module.title}
                                className="animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <ModuleCard {...module} />
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* About Section */}
            <section className="py-20 bg-white dark:bg-slate-900">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                        <div>
                            <h2 className="text-4xl font-bold text-slate-900 dark:text-white mb-6">
                                Empowering Nigerian Agriculture
                            </h2>
                            <p className="text-lg text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
                                We are Nigeria's premier agricultural platform, dedicated to
                                connecting farmers with global markets through innovative technology
                                and secure financial systems.
                            </p>
                            <p className="text-lg text-slate-600 dark:text-slate-400 mb-8 leading-relaxed">
                                Our mission is to empower Nigerian farmers to achieve financial
                                independence through sustainable agricultural practices, quality
                                education, and access to global trade opportunities.
                            </p>
                            <Link
                                href="/auth/register"
                                className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all shadow-lg hover:shadow-xl hover:scale-105"
                            >
                                Get Started Free
                                <ArrowRight className="w-5 h-5" />
                            </Link>
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-6 text-center">
                                <div className="text-4xl font-bold text-primary mb-2">15,420+</div>
                                <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                    Registered Users
                                </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-6 text-center">
                                <div className="text-4xl font-bold text-primary mb-2">₦2.5B+</div>
                                <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                    Total Exports
                                </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-6 text-center">
                                <div className="text-4xl font-bold text-primary mb-2">24</div>
                                <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                    States Covered
                                </div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-6 text-center">
                                <div className="text-4xl font-bold text-primary mb-2">98%</div>
                                <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                                    Success Rate
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-20 bg-linear-to-br from-primary via-primary/90 to-green-600">
                <div className="max-w-4xl mx-auto px-4 text-center">
                    <h2 className="text-4xl font-bold text-white mb-6">
                        Ready to Transform Your Agricultural Business?
                    </h2>
                    <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto">
                        Join thousands of Nigerian farmers and exporters growing their
                        business with Easy Sales Export. Start your journey today!
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link
                            href="/auth/register"
                            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-primary font-bold rounded-xl hover:bg-slate-50 transition-all shadow-lg hover:shadow-xl hover:scale-105"
                        >
                            Create Free Account
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                        <Link
                            href="/marketplace"
                            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-bold rounded-xl hover:bg-white/20 transition-all border-2 border-white/30"
                        >
                            Explore Marketplace
                        </Link>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="bg-slate-900 text-slate-400 py-12">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
                        <div>
                            <h3 className="text-white font-bold mb-4 text-lg">
                                Easy Sales Export
                            </h3>
                            <p className="text-sm mb-2">
                                Kusu Consult NG Limited
                            </p>
                            <p className="text-sm">
                                RC: 1234567
                            </p>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4">Platform</h4>
                            <ul className="space-y-2 text-sm">
                                <li>
                                    <Link href="/marketplace" className="hover:text-white transition-colors">
                                        Marketplace
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/export" className="hover:text-white transition-colors">
                                        Export Windows
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/cooperatives" className="hover:text-white transition-colors">
                                        Cooperatives
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/cooperatives/my-savings" className="hover:text-white transition-colors">
                                        Savings
                                    </Link>
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4">Programs</h4>
                            <ul className="space-y-2 text-sm">
                                <li>
                                    <Link href="/wave" className="hover:text-white transition-colors">
                                        WAVE Program
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/farm-nation" className="hover:text-white transition-colors">
                                        Farm Nation
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/academy" className="hover:text-white transition-colors">
                                        Academy
                                    </Link>
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4">Legal</h4>
                            <ul className="space-y-2 text-sm">
                                <li>
                                    <Link href="/terms" className="hover:text-white transition-colors">
                                        Terms & Conditions
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/privacy" className="hover:text-white transition-colors">
                                        Privacy Policy
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/auth/register" className="hover:text-white transition-colors">
                                        Create Account
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/auth/login" className="hover:text-white transition-colors">
                                        Login
                                    </Link>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className="border-t border-slate-800 pt-8 text-center text-sm">
                        <p>© 2024 Easy Sales Export. All rights reserved.</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
