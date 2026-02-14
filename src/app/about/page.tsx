"use client";

import Link from "next/link";
import { ArrowRight, Shield, CheckCircle, Home } from "lucide-react";

export default function AboutPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Navigation */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-slate-900 dark:text-white hover:opacity-80 transition">
                        <Home className="w-5 h-5" />
                        <span className="font-semibold">Back to Home</span>
                    </Link>
                    <Link
                        href="/auth/get-started"
                        className="px-6 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all"
                    >
                        Get Started
                    </Link>
                </div>
            </div>

            {/* Hero Section */}
            <section className="py-20 bg-linear-to-br from-green-50 via-white to-green-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <h1 className="text-5xl md:text-6xl font-bold text-slate-900 dark:text-white mb-6">
                        About Us
                    </h1>
                    <div className="w-24 h-1 bg-linear-to-r from-green-600 via-green-500 to-green-600 mx-auto rounded-full mb-8" />
                    <p className="text-xl text-slate-900 dark:text-white leading-relaxed">
                        <strong className="text-slate-900 dark:text-white">Easy Sales Export Nigeria Limited</strong> is a strategic agro-export and trade infrastructure company connecting African producers to global markets.
                    </p>
                </div>
            </section>

            {/* Main Content */}
            <section className="py-20 bg-white dark:bg-slate-900">
                <div className="max-w-6xl mx-auto px-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center mb-20">
                        <div>
                            <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-6">
                                What We Do
                            </h2>
                            <div className="space-y-6 text-lg text-slate-900 dark:text-white">
                                <p>
                                    We build structured systems that organize farmers, coordinate production, ensure quality, and deliver commodities to international buyers with reliability and scale.
                                </p>
                                <p>
                                    Our work spans commodity export, cooperative development, farm production structuring, export training, and global market access facilitation.
                                </p>
                                <p>
                                    As a strategic implementing partner in national and private agricultural initiatives, including the <strong className="text-slate-900 dark:text-white">Women Agro Value Expansion (WAVE) Program</strong>, Easy Sales Export plays a critical role in empowering producers and unlocking large-scale export opportunities.
                                </p>
                            </div>
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

                    {/* Mission Statement */}
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border-l-4 border-emerald-600 p-8 rounded-r-xl mb-20">
                        <p className="text-lg italic text-slate-900 dark:text-white mb-4">
                            We don't just export products.
                        </p>
                        <p className="text-xl font-bold text-emerald-800 dark:text-emerald-300">
                            We build the systems that turn production into predictable wealth, empower communities, and position Africa as a global trade force.
                        </p>
                    </div>

                    {/* Our Services */}
                    <div className="mb-20">
                        <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-8 text-center">
                            Our Services
                        </h2>
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {[
                                "Commodity Export",
                                "Cooperative Development",
                                "Farm Production Structuring",
                                "Export Training",
                                "Global Market Access",
                                "Quality Assurance Systems"
                            ].map((service, index) => (
                                <div key={index} className="flex items-start gap-3 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                                    <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
                                    <span className="text-slate-800 dark:text-slate-200 font-medium">{service}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* WAVE Partnership */}
                    <div className="bg-linear-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-3xl p-10 border border-green-200 dark:border-green-800">
                        <div className="flex items-start gap-4 mb-6">
                            <Shield className="w-8 h-8 text-green-600 shrink-0 mt-1" />
                            <div>
                                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                    Strategic Partner: WAVE Program
                                </h3>
                                <p className="text-lg text-slate-900 dark:text-white mb-4">
                                    As the lead implementing partner for the <strong>Women Agro Value Expansion (WAVE) Program</strong>, we are proud to support the Federal Ministry of Women Affairs in empowering 10 million Nigerian women through structured agricultural value chains.
                                </p>
                                <div className="space-y-2">
                                    {[
                                        "Agribusiness structuring and governance",
                                        "Cooperative systems design",
                                        "Market access and export pathways",
                                        "Operational execution excellence",
                                        "Monitoring, reporting, and impact delivery"
                                    ].map((item, index) => (
                                        <div key={index} className="flex items-start gap-2">
                                            <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                                            <span className="text-slate-900 dark:text-white">{item}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Tagline Section */}
            <section className="py-20 bg-linear-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-6">
                        Easy Sales Export Nigeria Limited
                    </h2>
                    <p className="text-xl text-slate-900 dark:text-white mb-3">
                        Connecting African production to global markets.
                    </p>
                    <p className="text-2xl font-bold bg-linear-to-r from-green-700 via-green-600 to-green-500 bg-clip-text text-transparent">
                        Structuring trade. Empowering producers. Creating prosperity.
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-6">
                        RC: 763845
                    </p>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-20 bg-linear-to-br from-green-700 via-green-600 to-green-500 text-white">
                <div className="max-w-4xl mx-auto px-6 text-center">
                    <h2 className="text-4xl md:text-5xl font-bold mb-6">
                        Ready to Transform Your Agricultural Business?
                    </h2>
                    <p className="text-xl mb-8 opacity-90">
                        Join thousands of Nigerian farmers and exporters growing their business with Easy Sales Export
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link
                            href="/auth/get-started"
                            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-green-700 font-bold rounded-xl hover:bg-slate-50 transition-all shadow-lg hover:shadow-xl hover:scale-105"
                        >
                            Get Started
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
                <div className="max-w-7xl mx-auto px-6 text-center">
                    <p className="text-sm">
                        © 2024 Easy Sales Export Nigeria Limited. All rights reserved.
                    </p>
                </div>
            </footer>
        </div>
    );
}
