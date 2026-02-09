"use client";

import Link from "next/link";
import { ArrowRight, Users, Wallet, TrendingUp, Heart, Award, CheckCircle, DollarSign } from "lucide-react";

export default function CooperativesLandingPage() {
    const tiers = [
        {
            name: "Basic",
            price: "₦5,000",
            period: "/month",
            features: [
                "5% interest on savings",
                "Access to microloans",
                "Monthly financial literacy training",
                "Community networking",
            ],
            color: "from-blue-500 to-cyan-500"
        },
        {
            name: "Premium",
            price: "₦15,000",
            period: "/month",
            features: [
                "8% interest on savings",
                "Priority loan approval",
                "Business development workshops",
                "Export opportunities access",
                "Quarterly dividends",
            ],
            color: "from-purple-500 to-pink-500",
            popular: true
        },
        {
            name: "Gold",
            price: "₦30,000",
            period: "/month",
            features: [
                "12% interest on savings",
                "Unlimited loan access",
                "One-on-one business mentorship",
                "Investment opportunities",
                "Premium networking events",
                "Annual profit sharing",
            ],
            color: "from-yellow-500 to-orange-500"
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Hero Section */}
            <div className="relative overflow-hidden bg-linear-to-br from-purple-600 via-indigo-600 to-blue-600 text-white">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-8 py-24">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-semibold mb-6">
                            <Heart className="w-4 h-4" />
                            Cooperative Society
                        </div>
                        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
                            Join Our Cooperative
                        </h1>
                        <p className="text-xl md:text-2xl mb-4 text-purple-50">
                            Save, Invest & Grow Together
                        </p>
                        <p className="text-lg mb-8 text-purple-100 max-w-2xl">
                            Access low-interest loans, earn competitive returns on savings, and build wealth through our cooperative society. Strength in unity, prosperity for all.
                        </p>
                        <Link
                            href="/cooperatives/onboarding"
                            className="group inline-flex items-center gap-3 bg-white text-purple-600 px-8 py-4 rounded-xl font-bold text-lg shadow-2xl hover:shadow-purple-500/50 transition-all hover:scale-105"
                        >
                            Join Now
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
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
                        <div className="text-4xl font-bold text-purple-600 mb-2">35,000+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Active Members</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-purple-600 mb-2">₦8.5B</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Total Savings</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-purple-600 mb-2">₦12B+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Loans Disbursed</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-purple-600 mb-2">12%</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Average ROI</div>
                    </div>
                </div>
            </div>

            {/* Benefits Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-4">
                    Member Benefits
                </h2>
                <p className="text-center text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto">
                    Experience financial empowerment through our comprehensive cooperative services
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mb-6">
                            <Wallet className="w-7 h-7 text-purple-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Competitive Savings
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Earn up to 12% interest on your savings, far better than traditional banks.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mb-6">
                            <TrendingUp className="w-7 h-7 text-purple-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Low-Interest Loans
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Access loans at competitive rates with flexible repayment terms tailored to your needs.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mb-6">
                            <Users className="w-7 h-7 text-purple-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Community Network
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Connect with fellow farmers and agripreneurs for support, partnerships, and growth.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mb-6">
                            <Award className="w-7 h-7 text-purple-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Financial Training
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Free monthly workshops on financial literacy, investment strategies, and wealth building.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mb-6">
                            <DollarSign className="w-7 h-7 text-purple-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Profit Sharing
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Share in the cooperative's annual profits based on your membership tier and contributions.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mb-6">
                            <CheckCircle className="w-7 h-7 text-purple-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Insurance Coverage
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Automatic savings insurance and optional loan protection for peace of mind.
                        </p>
                    </div>
                </div>
            </div>

            {/* Membership Tiers */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-4">
                    Membership Tiers
                </h2>
                <p className="text-center text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto">
                    Choose the membership level that fits your financial goals
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {tiers.map((tier, index) => (
                        <div
                            key={index}
                            className={`relative bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2 ${tier.popular ? 'ring-4 ring-purple-500' : ''}`}
                        >
                            {tier.popular && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                                    <span className="px-4 py-1 bg-purple-600 text-white text-sm font-bold rounded-full">
                                        Most Popular
                                    </span>
                                </div>
                            )}
                            <div className={`w-full h-2 bg-linear-to-r ${tier.color} rounded-full mb-6`}></div>
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                {tier.name}
                            </h3>
                            <div className="mb-6">
                                <span className="text-4xl font-bold text-slate-900 dark:text-white">{tier.price}</span>
                                <span className="text-slate-600 dark:text-slate-400">{tier.period}</span>
                            </div>
                            <ul className="space-y-3 mb-8">
                                {tier.features.map((feature, idx) => (
                                    <li key={idx} className="flex items-start gap-3">
                                        <CheckCircle className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                                        <span className="text-slate-600 dark:text-slate-400">{feature}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>

            {/* CTA Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="bg-linear-to-r from-purple-600 to-indigo-600 rounded-3xl p-12 text-center text-white relative overflow-hidden">
                    <div className="absolute inset-0 bg-black/10"></div>
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Ready to Build Wealth Together?
                        </h2>
                        <p className="text-xl mb-8 text-purple-100 max-w-2xl mx-auto">
                            Join thousands of farmers who are securing their financial future through our cooperative.
                        </p>
                        <Link
                            href="/cooperatives/onboarding"
                            className="group inline-flex items-center gap-3 bg-white text-purple-600 px-10 py-5 rounded-xl font-bold text-lg shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                        >
                            Become a Member
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
