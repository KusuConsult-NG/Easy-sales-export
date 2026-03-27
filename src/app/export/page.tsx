"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowRight, Package, Shield, TrendingUp, Clock, Globe, CheckCircle, DollarSign, Home, ShoppingBag, Truck, FileCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import BackToHub from "@/components/common/BackToHub";
import { checkExportStatusAction } from "@/app/actions/export";

export default function ExportWindowsLandingPage() {
    const { status: sessionStatus } = useSession();
    const router = useRouter();

    // ── Redirect logged-in users to their dashboard ──────────────────────
    useEffect(() => {
        if (sessionStatus === 'loading') return;
        if (sessionStatus !== 'authenticated') return;
        (async () => {
            try {
                const appStatus = await checkExportStatusAction();
                if (appStatus === 'approved') {
                    router.replace('/export/dashboard');
                } else {
                    router.replace('/export/onboarding');
                }
            } catch {
                router.replace('/export/onboarding');
            }
        })();
    }, [sessionStatus, router]);



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
        <div className="min-h-screen bg-slate-50">


            {/* Hero Section */}
            <div className="relative overflow-hidden bg-linear-to-br from-orange-600 via-amber-600 to-yellow-600 text-white">
                <BackToHub variant="dark" className="top-4 left-4 border-white/20" />
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-4 md:px-8 py-12 md:py-24">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-semibold mb-4 md:mb-6">
                            <Globe className="w-3 h-3 md:w-4 md:h-4" />
                            Export Investment Platform
                        </div>
                        <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 md:mb-6 leading-tight">
                            Export Windows
                        </h1>
                        <p className="text-lg md:text-xl lg:text-2xl mb-3 md:mb-4 text-orange-50">
                            Invest in Global Trade & Source Quality Products
                        </p>
                        <p className="text-base md:text-lg mb-6 md:mb-8 text-orange-100 max-w-2xl">
                            Fund verified agricultural export contracts and earn attractive returns — or source premium Nigerian agricultural products directly from verified suppliers.
                        </p>
                        <div className="flex flex-col sm:flex-row flex-wrap gap-3 md:gap-4">
                            <Link
                                href="/export/onboarding"
                                className="group inline-flex items-center justify-center w-full sm:w-auto gap-2 md:gap-3 bg-white text-orange-600 px-6 py-3 md:px-8 md:py-4 rounded-xl font-bold text-base md:text-lg shadow-2xl hover:shadow-orange-500/50 transition-all hover:scale-105"
                            >
                                Start Investing
                                <ArrowRight className="w-4 h-4 md:w-5 md:h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link
                                href="/export/buyer"
                                className="group inline-flex items-center justify-center w-full sm:w-auto gap-2 md:gap-3 bg-white/10 backdrop-blur-sm border-2 border-white text-white px-6 py-3 md:px-8 md:py-4 rounded-xl font-bold text-base md:text-lg hover:bg-white/20 transition-all"
                            >
                                <ShoppingBag className="w-4 h-4 md:w-5 md:h-5" />
                                Buy Nigerian Products
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

            {/* Stats Section */}
            <div className="max-w-7xl mx-auto px-8 -mt-16 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-16">
                    <div className="bg-white rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-orange-600 mb-2">250+</div>
                        <div className="text-slate-600 font-medium">Export Windows</div>
                    </div>
                    <div className="bg-white rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-orange-600 mb-2">₦15B+</div>
                        <div className="text-slate-600 font-medium">Total Invested</div>
                    </div>
                    <div className="bg-white rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-orange-600 mb-2">98%</div>
                        <div className="text-slate-600 font-medium">Success Rate</div>
                    </div>
                    <div className="bg-white rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-orange-600 mb-2">18-22%</div>
                        <div className="text-slate-600 font-medium">Average ROI</div>
                    </div>
                </div>
            </div>

            {/* Active Opportunities */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 mb-4">
                    Active Export Opportunities
                </h2>
                <p className="text-center text-slate-600 mb-12 max-w-2xl mx-auto">
                    Verified export contracts ready for funding with attractive returns
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                    {opportunities.map((opp, index) => (
                        <div key={index} className="bg-white rounded-2xl p-6 elevation-2">
                            <div className="text-5xl mb-4">{opp.icon}</div>
                            <h3 className="text-xl font-bold text-slate-900 mb-3">
                                {opp.commodity}
                            </h3>
                            <div className="space-y-3 mb-6">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600">Destination</span>
                                    <span className="font-semibold text-slate-900">{opp.destination}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600">ROI</span>
                                    <span className="font-bold text-green-600">{opp.roi}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600">Duration</span>
                                    <span className="font-semibold text-slate-900">{opp.duration}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600">Min. Investment</span>
                                    <span className="font-semibold text-slate-900">{opp.minInvestment}</span>
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
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 mb-12">
                    How Export Windows Work
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-orange-600">1</span>
                        </div>
                        <h4 className="font-bold text-slate-900 mb-2">Browse Opportunities</h4>
                        <p className="text-sm text-slate-600">Review verified export contracts with detailed documentation and ROI projections</p>
                    </div>
                    <div className="text-center">
                        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-orange-600">2</span>
                        </div>
                        <h4 className="font-bold text-slate-900 mb-2">Invest Securely</h4>
                        <p className="text-sm text-slate-600">Fund your chosen export window with automatic escrow protection</p>
                    </div>
                    <div className="text-center">
                        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-orange-600">3</span>
                        </div>
                        <h4 className="font-bold text-slate-900 mb-2">Track Progress</h4>
                        <p className="text-sm text-slate-600">Monitor shipment status and documentation in real-time</p>
                    </div>
                    <div className="text-center">
                        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <span className="text-2xl font-bold text-orange-600">4</span>
                        </div>
                        <h4 className="font-bold text-slate-900 mb-2">Earn Returns</h4>
                        <p className="text-sm text-slate-600">Receive your capital plus ROI upon successful export completion</p>
                    </div>
                </div>
            </div>

            {/* For Investors - Benefits */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 mb-4">
                    For Investors
                </h2>
                <p className="text-center text-slate-600 mb-12 max-w-2xl mx-auto">
                    Fund verified export contracts and earn attractive returns with full escrow protection
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center mb-6">
                            <Shield className="w-7 h-7 text-orange-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-3">
                            Escrow Protection
                        </h3>
                        <p className="text-slate-600">
                            Your funds are held in secure escrow until export completion and verification.
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center mb-6">
                            <CheckCircle className="w-7 h-7 text-orange-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-3">
                            Verified Contracts
                        </h3>
                        <p className="text-slate-600">
                            All export opportunities are thoroughly vetted with international buyer verification.
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-orange-100 rounded-xl flex items-center justify-center mb-6">
                            <DollarSign className="w-7 h-7 text-orange-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-3">
                            Attractive Returns
                        </h3>
                        <p className="text-slate-600">
                            Earn 18-22% ROI on verified agricultural export contracts within 4-6 months.
                        </p>
                    </div>
                </div>
            </div>

            {/* For International Buyers */}
            <div className="max-w-7xl mx-auto px-8 py-16 border-t border-slate-200">
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-semibold mb-4">
                        <Globe className="w-4 h-4" />
                        International Buyers
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
                        Source Quality Nigerian Agricultural Products
                    </h2>
                    <p className="text-lg text-slate-600 max-w-3xl mx-auto">
                        Connect directly with verified Nigerian exporters. Access premium agricultural commodities with quality certifications, competitive pricing, and reliable logistics.
                    </p>
                </div>

                {/* Product Categories */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-16">
                    {[
                        { name: "Cashew Nuts", icon: "🥜", grade: "W320, W240" },
                        { name: "Sesame Seeds", icon: "🌰", grade: "99% Purity" },
                        { name: "Hibiscus", icon: "🌺", grade: "Sun-Dried" },
                        { name: "Cocoa Beans", icon: "🫘", grade: "Grade A" },
                        { name: "Shea Butter", icon: "🧴", grade: "Unrefined" },
                        { name: "Yam Tubers", icon: "🌾", grade: "Export Grade" },
                    ].map((product, index) => (
                        <div key={index} className="bg-white rounded-xl p-5 elevation-2 hover-lift text-center">
                            <div className="text-4xl mb-3">{product.icon}</div>
                            <h4 className="font-bold text-slate-900 text-sm mb-1">{product.name}</h4>
                            <p className="text-xs text-blue-600 font-semibold">{product.grade}</p>
                        </div>
                    ))}
                </div>

                {/* How it works for buyers */}
                <h3 className="text-2xl font-bold text-center text-slate-900 mb-8">How Buying Works</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <FileCheck className="w-7 h-7 text-blue-600" />
                        </div>
                        <h4 className="font-bold text-slate-900 mb-2">Request a Quote</h4>
                        <p className="text-sm text-slate-600">Submit your product requirements, quantities, and delivery specifications</p>
                    </div>
                    <div className="text-center">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-7 h-7 text-blue-600" />
                        </div>
                        <h4 className="font-bold text-slate-900 mb-2">Quality Verification</h4>
                        <p className="text-sm text-slate-600">Products are inspected and certified to meet international export standards</p>
                    </div>
                    <div className="text-center">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Shield className="w-7 h-7 text-blue-600" />
                        </div>
                        <h4 className="font-bold text-slate-900 mb-2">Secure Payment</h4>
                        <p className="text-sm text-slate-600">Pay securely through escrow — funds released only after quality confirmation</p>
                    </div>
                    <div className="text-center">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Truck className="w-7 h-7 text-blue-600" />
                        </div>
                        <h4 className="font-bold text-slate-900 mb-2">Shipping & Delivery</h4>
                        <p className="text-sm text-slate-600">Full logistics support with real-time tracking to your destination</p>
                    </div>
                </div>

                {/* Buyer benefits */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    <div className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-slate-900 text-sm mb-1">Direct Sourcing</h4>
                            <p className="text-xs text-slate-600">Buy directly from verified Nigerian producers</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-slate-900 text-sm mb-1">Quality Certificates</h4>
                            <p className="text-xs text-slate-600">NAFDAC, SON, phytosanitary certificates included</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-slate-900 text-sm mb-1">Competitive Pricing</h4>
                            <p className="text-xs text-slate-600">Factory-gate prices with volume discounts</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-slate-900 text-sm mb-1">Logistics Support</h4>
                            <p className="text-xs text-slate-600">FOB, CIF, and door-to-door delivery options</p>
                        </div>
                    </div>
                </div>

                <div className="text-center">
                    <Link
                        href="/export/buyer"
                        className="group inline-flex items-center gap-3 bg-blue-600 text-white px-10 py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-blue-700 transition-all hover:scale-105"
                    >
                        <ShoppingBag className="w-5 h-5" />
                        Start Buying Nigerian Products
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </Link>
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
