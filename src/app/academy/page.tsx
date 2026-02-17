"use client";

import { ArrowRight, BookOpen, Users, Award, Clock, TrendingUp, GraduationCap, CheckCircle, Home, Zap, Star } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function AcademyLandingPage() {
    const programTiers = [
        {
            title: "Foundation Program",
            price: "₦25,000",
            description: "Essential knowledge for starting your agro-export journey correctly.",
            features: ["Export fundamentals", "Agro-business structure", "Basic market access strategy"],
            highlight: false
        },
        {
            title: "Advanced Program",
            price: "₦50,000",
            description: "Deep dive into strategies, compliance, and scaling your operations.",
            features: ["Advanced export strategies", "Comprehensive compliance training", "Cooperative opportunity positioning"],
            highlight: true
        },
        {
            title: "Elite Program",
            price: "₦100,000",
            description: "The complete playbook for high-level execution and dominance.",
            features: ["Full ecosystem mastery", "Direct market linkages", "Priority positioning strategy"],
            highlight: false
        }
    ];

    const learningObjectives = [
        {
            title: "Export Fundamentals",
            description: "Understand the core principles of international trade and documentation.",
            icon: BookOpen
        },
        {
            title: "Market Access Strategy",
            description: "Learn how to identify, approach, and secure international buyers.",
            icon: GlobeIcon // Defined below or imported? Globe is better. I'll import Globe.
        },
        {
            title: "Cooperative Positioning",
            description: "How to leverage the cooperative structure for funding and opportunities.",
            icon: Users
        },
        {
            title: "Agro-business Structure",
            description: "Building a legally sound and investable agricultural business.",
            icon: TrendingUp
        }
    ];

    const bonuses = [
        "Speed Selling 101",
        "Export Intelligence Guide"
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">


            {/* Hero Section */}
            <div className="relative overflow-hidden bg-linear-to-br from-blue-700 via-indigo-700 to-purple-800 text-white">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-4 md:px-8 py-20 md:py-32 text-center">
                    <div className="max-w-4xl mx-auto">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-semibold mb-8">
                            <GraduationCap className="w-5 h-5" />
                            <span>Easy Sales Export Academy</span>
                        </div>
                        <h1 className="text-4xl md:text-6xl font-bold mb-8 leading-tight">
                            Learn How to Position Yourself for <span className="text-blue-300">Agro and Export Opportunities</span>
                        </h1>
                        <p className="text-xl md:text-2xl mb-10 text-blue-100 max-w-3xl mx-auto leading-relaxed">
                            This program provides structured education designed to help Nigerians understand agricultural and export systems and position themselves properly.
                        </p>

                        <div className="flex flex-col sm:flex-row justify-center gap-4">
                            <Link
                                href="#programs"
                                className="inline-flex items-center justify-center gap-3 bg-white text-blue-700 px-8 py-4 rounded-xl font-bold text-lg shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                            >
                                Enroll in the Academy Now
                                <ArrowRight className="w-5 h-5" />
                            </Link>
                        </div>
                    </div>
                </div>
                {/* Wave SVG */}
                <div className="absolute bottom-0 left-0 right-0">
                    <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
                        <path d="M0 0L60 10C120 20 240 40 360 46.7C480 53 600 47 720 43.3C840 40 960 40 1080 46.7C1200 53 1320 67 1380 73.3L1440 80V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0V0Z" fill="rgb(248 250 252)" className="dark:fill-slate-950" />
                    </svg>
                </div>
            </div>

            {/* What You Will Learn Section */}
            <div className="max-w-7xl mx-auto px-8 py-20">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-5xl font-bold text-slate-900 dark:text-white mb-6">
                        What You Will Learn
                    </h2>
                    <p className="text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                        A curriculum built for execution, not just theory.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    {learningObjectives.map((obj, idx) => {
                        const Icon = obj.icon;
                        return (
                            <div key={idx} className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2 hover:shadow-lg transition border border-slate-100 dark:border-slate-700">
                                <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mb-6">
                                    <Icon className="w-7 h-7 text-blue-600" />
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                                    {obj.title}
                                </h3>
                                <p className="text-slate-600 dark:text-slate-400">
                                    {obj.description}
                                </p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Programs & Pricing Section */}
            <div id="programs" className="bg-slate-100 dark:bg-slate-900 py-20">
                <div className="max-w-7xl mx-auto px-8">
                    <h2 className="text-3xl md:text-5xl font-bold text-center text-slate-900 dark:text-white mb-16">
                        Our Programs
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        {programTiers.map((tier, index) => (
                            <div
                                key={index}
                                className={`relative bg-white dark:bg-slate-800 rounded-2xl overflow-hidden transition-all duration-300 ${tier.highlight
                                    ? 'shadow-2xl scale-105 border-2 border-blue-600 z-10'
                                    : 'shadow-lg border border-slate-200 dark:border-slate-700 hover:shadow-xl'
                                    }`}
                            >
                                {tier.highlight && (
                                    <div className="bg-blue-600 text-white text-center py-2 font-bold text-sm uppercase tracking-wider">
                                        Most Popular
                                    </div>
                                )}
                                <div className="p-8">
                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                        {tier.title}
                                    </h3>
                                    <div className="flex items-baseline mb-6">
                                        <span className="text-4xl font-bold text-blue-600">{tier.price}</span>
                                    </div>
                                    <p className="text-slate-600 dark:text-slate-400 mb-8 pb-8 border-b border-slate-100 dark:border-slate-700">
                                        {tier.description}
                                    </p>
                                    <ul className="space-y-4 mb-8">
                                        {tier.features.map((feature, fIdx) => (
                                            <li key={fIdx} className="flex items-start gap-3">
                                                <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                                                <span className="text-slate-700 dark:text-slate-300 font-medium">{feature}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="text-center">
                                        <Link
                                            href={`/auth/register?callbackUrl=/academy/application&plan=${tier.title.toLowerCase().replace(' ', '-')}`}
                                            className={`block w-full py-3 rounded-xl font-bold text-center transition ${tier.highlight
                                                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'
                                                : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                                                }`}
                                        >
                                            Choose {tier.title}
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Bonus Section */}
            <div className="max-w-4xl mx-auto px-8 py-20">
                <div className="bg-linear-to-br from-yellow-500 to-orange-500 rounded-3xl p-12 text-center text-white relative shadow-2xl overflow-hidden">
                    <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-white/20 rounded-full blur-3xl"></div>
                    <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-40 h-40 bg-white/20 rounded-full blur-3xl"></div>

                    <div className="relative z-10">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-bold mb-6">
                            <Star className="w-5 h-5 text-yellow-100" />
                            <span>Exclusive Bonuses</span>
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold mb-8">
                            Sign Up Now and Get These Bonuses Free
                        </h2>

                        <div className="grid md:grid-cols-2 gap-6 mb-10 text-left">
                            {bonuses.map((bonus, idx) => (
                                <div key={idx} className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 flex items-center gap-4">
                                    <div className="bg-white/20 p-3 rounded-lg">
                                        <Zap className="w-6 h-6 text-yellow-100" />
                                    </div>
                                    <span className="text-xl font-bold">{bonus}</span>
                                </div>
                            ))}
                        </div>

                        <Link
                            href="#programs"
                            className="inline-flex items-center gap-3 bg-white text-orange-600 px-10 py-5 rounded-xl font-bold text-lg shadow-xl hover:shadow-white/50 transition-all hover:scale-105"
                        >
                            Claim Your Bonuses Now
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                    </div>
                </div>
            </div>

            {/* Final CTA Section */}
            <div className="max-w-7xl mx-auto px-8 pb-20">
                <div className="text-center">
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-6">
                        Stop Guessing. Start Positioning.
                    </h2>
                    <Link
                        href="#programs"
                        className="inline-flex items-center gap-2 text-blue-600 font-bold hover:text-blue-700 transition"
                    >
                        View Program Options Again
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </div>

            {/* Disclaimer Section */}
            <div className="bg-slate-100 dark:bg-slate-900 py-12 border-t border-slate-200 dark:border-slate-800">
                <div className="max-w-4xl mx-auto px-8 text-center">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Disclaimer</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-4">
                        All export training services provided by Easy Sales Export LTD. are for informational and educational purposes only. Participants are solely responsible for complying with all applicable export regulations, customs laws, and international trade requirements.
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                        The Company makes no representations or warranties regarding specific financial outcomes or regulatory approvals.
                    </p>
                </div>
            </div>
        </div>
    );
}

// Helper component for Globe icon since it wasn't in the original imports but I used it
function GlobeIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" x2="22" y1="12" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
    )
}
