"use client";

import Link from "next/link";
import { ArrowRight, Users, TrendingUp, Award, Star, CheckCircle } from "lucide-react";

export default function WAVELandingPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Hero Section */}
            <div className="relative overflow-hidden bg-linear-to-br from-pink-500 via-rose-500 to-red-500 text-white">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-8 py-24">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-semibold mb-6">
                            <Star className="w-4 h-4" />
                            Women Empowerment Program
                        </div>
                        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
                            WAVE Program
                        </h1>
                        <p className="text-xl md:text-2xl mb-4 text-pink-50">
                            Women's Agribusiness Venture Empowerment
                        </p>
                        <p className="text-lg mb-8 text-pink-100 max-w-2xl">
                            Get access to funding, training, and mentorship to grow your agricultural business.
                            Join thousands of women farmers transforming Nigerian agriculture.
                        </p>
                        <Link
                            href="/wave/application"
                            className="group inline-flex items-center gap-3 bg-white text-rose-600 px-8 py-4 rounded-xl font-bold text-lg shadow-2xl hover:shadow-pink-500/50 transition-all hover:scale-105"
                        >
                            Apply Now
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </div>
                {/* Wave SVG Background */}
                <div className="absolute bottom-0 left-0 right-0">
                    <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
                        <path d="M0 0L60 10C120 20 240 40 360 46.7C480 53 600 47 720 43.3C840 40 960 40 1080 46.7C1200 53 1320 67 1380 73.3L1440 80V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0V0Z" fill="rgb(248 250 252)" className="dark:fill-slate-950" />
                    </svg>
                </div>
            </div>

            {/* Stats Section */}
            <div className="max-w-7xl mx-auto px-8 -mt-16 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-rose-600 mb-2">15,000+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Women Empowered</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-rose-600 mb-2">₦500M+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Total Funding Disbursed</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-rose-600 mb-2">92%</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Success Rate</div>
                    </div>
                </div>
            </div>

            {/* Benefits Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-4">
                    What You Get
                </h2>
                <p className="text-center text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto">
                    WAVE provides comprehensive support to help women farmers succeed in agriculture
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-rose-100 dark:bg-rose-900/30 rounded-xl flex items-center justify-center mb-6">
                            <TrendingUp className="w-7 h-7 text-rose-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Funding Access
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Get up to ₦2M in grants and low-interest loans to scale your agribusiness operations.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-rose-100 dark:bg-rose-900/30 rounded-xl flex items-center justify-center mb-6">
                            <Award className="w-7 h-7 text-rose-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Training & Certification
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Access world-class training programs and earn certifications recognized across Nigeria.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-rose-100 dark:bg-rose-900/30 rounded-xl flex items-center justify-center mb-6">
                            <Users className="w-7 h-7 text-rose-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Mentorship Network
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Connect with successful women farmers and business mentors for guidance and support.
                        </p>
                    </div>
                </div>
            </div>

            {/* Eligibility Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="bg-linear-to-br from-rose-50 to-pink-50 dark:from-slate-800 dark:to-slate-800 rounded-3xl p-12">
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
                        Who Can Apply?
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex items-start gap-4">
                            <CheckCircle className="w-6 h-6 text-rose-600 shrink-0 mt-1" />
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Female Farmers</h4>
                                <p className="text-slate-600 dark:text-slate-400">Women actively involved in agricultural production or processing</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <CheckCircle className="w-6 h-6 text-rose-600 shrink-0 mt-1" />
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Nigerian Citizen</h4>
                                <p className="text-slate-600 dark:text-slate-400">Must be a Nigerian citizen or permanent resident</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <CheckCircle className="w-6 h-6 text-rose-600 shrink-0 mt-1" />
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Age 18-55</h4>
                                <p className="text-slate-600 dark:text-slate-400">Applicants must be between 18 and 55 years old</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <CheckCircle className="w-6 h-6 text-rose-600 shrink-0 mt-1" />
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Business Plan</h4>
                                <p className="text-slate-600 dark:text-slate-400">Have a clear agricultural business idea or existing venture</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* CTA Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="bg-linear-to-r from-pink-600 to-rose-600 rounded-3xl p-12 text-center text-white relative overflow-hidden">
                    <div className="absolute inset-0 bg-black/10"></div>
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Ready to Transform Your Farming Business?
                        </h2>
                        <p className="text-xl mb-8 text-pink-100 max-w-2xl mx-auto">
                            Join thousands of successful women farmers already benefiting from the WAVE program.
                        </p>
                        <Link
                            href="/wave/application"
                            className="group inline-flex items-center gap-3 bg-white text-rose-600 px-10 py-5 rounded-xl font-bold text-lg shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                        >
                            Start Your Application
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
