"use client";

import Link from "next/link";
import { ShieldAlert, ArrowLeft, Users, GraduationCap, Sprout } from "lucide-react";

export default function WaveAccessDeniedPage() {
    return (
        <div className="min-h-screen bg-linear-to-br from-slate-900 via-rose-900 to-slate-900 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

            <div className="relative w-full max-w-2xl">
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 elevation-3">
                    {/* Icon Header */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 bg-rose-500/20 rounded-full mb-4">
                            <ShieldAlert className="w-10 h-10 text-rose-300" />
                        </div>
                        <h1 className="text-3xl font-bold text-white mb-2">
                            WAVE Program - Female Exlusive
                        </h1>
                        <p className="text-rose-200">
                            Access Restricted
                        </p>
                    </div>

                    {/* Explanation */}
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-6 mb-6">
                        <h2 className="text-lg font-semibold text-white mb-2">
                            Women in Agri-Ventures Excellence (WAVE)
                        </h2>
                        <p className="text-rose-100 leading-relaxed">
                            The WAVE program is exclusively designed for female participants to empower women in agricultural exports.
                            This program provides specialized resources, training, and support tailored to the unique needs and challenges  faced by women entrepreneurs in Nigeria's agricultural sector.
                        </p>
                    </div>

                    {/* Alternative Programs */}
                    <div className="mb-8">
                        <h3 className="text-white font-semibold mb-4">
                            Explore Other Programs Available to You:
                        </h3>
                        <div className="space-y-3">
                            <Link
                                href="/farm-nation"
                                className="block bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl p-4 transition group"
                            >
                                <div className="flex items-start space-x-4">
                                    <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center shrink-0">
                                        <Sprout className="w-5 h-5 text-green-300" />
                                    </div>
                                    <div>
                                        <h4 className="text-white font-medium mb-1 group-hover:text-green-300 transition">
                                            Farm Nation
                                        </h4>
                                        <p className="text-sm text-blue-200">
                                            Connect with verified landowners and access farmland across Nigeria
                                        </p>
                                    </div>
                                </div>
                            </Link>

                            <Link
                                href="/academy"
                                className="block bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl p-4 transition group"
                            >
                                <div className="flex items-start space-x-4">
                                    <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center shrink-0">
                                        <GraduationCap className="w-5 h-5 text-blue-300" />
                                    </div>
                                    <div>
                                        <h4 className="text-white font-medium mb-1 group-hover:text-blue-300 transition">
                                            Academy
                                        </h4>
                                        <p className="text-sm text-blue-200">
                                            Learn best practices for agricultural exports and commodity trading
                                        </p>
                                    </div>
                                </div>
                            </Link>

                            <Link
                                href="/cooperatives"
                                className="block bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl p-4 transition group"
                            >
                                <div className="flex items-start space-x-4">
                                    <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center shrink-0">
                                        <Users className="w-5 h-5 text-purple-300" />
                                    </div>
                                    <div>
                                        <h4 className="text-white font-medium mb-1 group-hover:text-purple-300 transition">
                                            Cooperatives
                                        </h4>
                                        <p className="text-sm text-blue-200">
                                            Join cooperative societies and access group financing opportunities
                                        </p>
                                    </div>
                                </div>
                            </Link>
                        </div>
                    </div>

                    {/* Contact Information */}
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-6">
                        <p className="text-sm text-blue-100">
                            <strong>Have questions?</strong> Contact our support team at{" "}
                            <a href="mailto:support@easysales.ng" className="text-blue-300 hover:underline">
                                support@easysales.ng
                            </a>
                        </p>
                    </div>

                    {/* Back Button */}
                    <Link
                        href="/dashboard"
                        className="flex items-center justify-center space-x-2 w-full px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium transition"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Return to Dashboard</span>
                    </Link>
                </div>
            </div>
        </div>
    );
}
