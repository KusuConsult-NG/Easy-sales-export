"use client";

import Link from "next/link";
import { ArrowRight, Package, Shield, TrendingUp, Clock, Globe, CheckCircle, DollarSign } from "lucide-react";
import { useRouter } from "next/navigation";

export default function ExportWindowsLandingPage() {
    const router = useRouter();



    const opportunities = [
        {
            commodity: "Yam Tubers Export - Phase 2",
            destination: "🇬🇧 United Kingdom",
            roi: "22%",
            duration: "6 months",
            minInvestment: "₦100,000",
            icon: "🌾"
        },
        {
            commodity: "Sesame Seeds Export",
            destination: "🇦🇪 Dubai, UAE",
            roi: "20%",
            duration: "4 months",
            minInvestment: "₦50,000",
            icon: "🌰"
        },
        {
            commodity: "Hibiscus Export",
            destination: "🇺🇸 United States",
            roi: "18%",
            duration: "5 months",
            minInvestment: "₦75,000",
            icon: "🌺"
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Hero Section */}
            <div className="relative overflow-hidden bg-linear-to-br from-orange-600 via-amber-600 to-yellow-600 text-white">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-8 py-24">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-semibold mb-6">
                            <Globe className="w-4 h-4" />
                            Export Investment Platform
                        </div>
                        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
                            Export Windows
                        </h1>
                        <p className="text-xl md:text-2xl mb-4 text-orange-50">
                            Invest in Global Trade Opportunities
                        </p>
                        <p className="text-lg mb-8 text-orange-100 max-w-2xl">
                            Fund verified agricultural export contracts and earn attractive returns. Secure escrow protection, transparent tracking, and professional management.
                        </p>
                        <button
                            onClick={() => router.push('/export/onboarding')}
                            className="group inline-flex items-center gap-3 bg-white text-orange-600 px-8 py-4 rounded-xl font-bold text-lg shadow-2xl hover:shadow-orange-500/50 transition-all hover:scale-105"
                        >
                            Get Started
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>
                {/* Wave SVG */}
                <div className="absolute bottom-0 left-0 right-0">
                    <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
                        <path d="M0 0L60 10C120 20 240 40 360 46.7C480 53 600 47 720 43.3C840 40 960 40 1080 46.7C1200 53 1320 67 1380 73.3L1440 80V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0V0Z" fill="rgb(248 250 252)" className="dark:fill-slate-950" />
                    </svg>
                </div>
            </div>

            {/* Stats Section */}
            <div className="max-w-7xl mx-auto px-8 -mt-16 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-16">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-orange-600 mb-2">250+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Export Windows</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-orange-600 mb-2">₦15B+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Total Invested</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-orange-600 mb-2">98%</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Success Rate</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-orange-600 mb-2">18-22%</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Average ROI</div>
                    </div>
                </div>
            </div>

            {/* Active Opportunities */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-4">
                    Active Export Opportunities
                </h2>
                <p className="text-center text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto">
                    Verified export contracts ready for funding with attractive returns
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                    {opportunities.map((opp, index) => (
                        <div key={index} className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                            <div className="text-5xl mb-4">{opp.icon}</div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                                {opp.commodity}
                            </h3>
                            <div className="space-y-3 mb-6">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Destination</span>
                                    <span className="font-semibold text-slate-900 dark:text-white">{opp.destination}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">ROI</span>
                                    <span className="font-bold text-green-600">{opp.roi}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Duration</span>
                                    <span className="font-semibold text-slate-900 dark:text-white">{opp.duration}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600 dark:text-slate-400">Min. Investment</span>
                                    <span className="font-semibold text-slate-900 dark:text-white">{opp.minInvestment}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="text-center">
                    <Link
                        href="/export/windows"
                        className="inline-flex items-center gap-2 px-8 py-3 bg-orange-600 text-white font-bold rounded-xl hover:bg-orange-700 transition"
                    >
                        View All Opportunities
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </div>

            {/* How It Works */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-12">
                    How Export Windows Work
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-orange-600">1</span>
                        </div>
                        <h4 className="font-bold text-slate-900 dark:text-white mb-2">Browse Opportunities</h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Review verified export contracts with detailed documentation and ROI projections</p>
                    </div>
                    <div className="text-center">
                        <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-orange-600">2</span>
                        </div>
                        <h4 className="font-bold text-slate-900 dark:text-white mb-2">Invest Securely</h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Fund your chosen export window with automatic escrow protection</p>
                    </div>
                    <div className="text-center">
                        <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-orange-600">3</span>
                        </div>
                        <h4 className="font-bold text-slate-900 dark:text-white mb-2">Track Progress</h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Monitor shipment status and documentation in real-time</p>
                    </div>
                    <div className="text-center">
                        <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-orange-600">4</span>
                        </div>
                        <h4 className="font-bold text-slate-900 dark:text-white mb-2">Earn Returns</h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Receive your capital plus ROI upon successful export completion</p>
                    </div>
                </div>
            </div>

            {/* Benefits Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center mb-6">
                            <Shield className="w-7 h-7 text-orange-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Escrow Protection
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Your funds are held in secure escrow until export completion and verification.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center mb-6">
                            <CheckCircle className="w-7 h-7 text-orange-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Verified Contracts
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            All export opportunities are thoroughly vetted with international buyer verification.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center mb-6">
                            <DollarSign className="w-7 h-7 text-orange-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Attractive Returns
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Earn 18-22% ROI on verified agricultural export contracts within 4-6 months.
                        </p>
                    </div>
                </div>
            </div>

            {/* CTA Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="bg-linear-to-r from-orange-600 to-amber-600 rounded-3xl p-12 text-center text-white relative overflow-hidden">
                    <div className="absolute inset-0 bg-black/10"></div>
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Start Investing in Global Trade
                        </h2>
                        <p className="text-xl mb-8 text-orange-100 max-w-2xl mx-auto">
                            Join thousands of investors earning consistent returns through verified agricultural exports.
                        </p>
                        <Link
                            href="/export/windows"
                            className="group inline-flex items-center gap-3 bg-white text-orange-600 px-10 py-5 rounded-xl font-bold text-lg shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                        >
                            Explore Export Windows
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
