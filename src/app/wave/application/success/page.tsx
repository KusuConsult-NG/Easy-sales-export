/**
 * WAVE Application Success Page
 * Shown after successful application submission
 */

"use client";

import Link from "next/link";
import { CheckCircle, ArrowRight, AlertTriangle, Flame, ShieldCheck, DoorOpen } from "lucide-react";

export default function ApplicationSuccessPage() {
    return (
        <div className="min-h-screen bg-linear-to-br from-emerald-50 via-emerald-50 to-emerald-50 flex items-center justify-center px-4 py-12">
            <div className="max-w-3xl w-full space-y-8">

                {/* 1. Header & Confirmation */}
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-24 h-24 bg-emerald-100 rounded-full mb-6 animate-pulse">
                        <CheckCircle className="w-14 h-14 text-emerald-600" />
                    </div>
                    <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-6 leading-tight">
                        Congratulations — <br className="hidden md:block" />
                        Your WAVE Registration Is Submitted
                    </h1>
                </div>

                {/* 2. The Hard Truth - Reality Check */}
                <div className="bg-white rounded-2xl shadow-xl p-8 border-l-8 border-slate-700">
                    <h2 className="text-2xl font-bold text-slate-900 mb-4">
                        Now listen carefully.
                    </h2>
                    <div className="space-y-4 text-lg text-slate-700 leading-relaxed">
                        <p>
                            Millions will register for WAVE. Only a fraction will be selected.
                        </p>
                        <p className="font-medium">
                            And here is the truth most people won’t tell you:
                        </p>
                        <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                            <p className="text-xl font-semibold text-slate-900 text-center">
                                WAVE does not reward hope.<br />
                                It rewards <span className="text-emerald-600">STRUCTURE</span>, <span className="text-emerald-600">VISIBILITY</span>, and <span className="text-emerald-600">POSITIONING</span>.
                            </p>
                        </div>
                    </div>
                </div>

                {/* 3. Important Warning */}
                <div className="bg-amber-50 rounded-2xl shadow-lg p-8 border-2 border-amber-200">
                    <div className="flex items-start gap-4">
                        <AlertTriangle className="w-8 h-8 text-amber-600 shrink-0 mt-1" />
                        <div className="space-y-4">
                            <h3 className="text-2xl font-bold text-amber-800">
                                IMPORTANT: Don’t Close This Page Yet
                            </h3>
                            <p className="text-lg text-amber-900/80">
                                Right now, you are registered. But registration alone does not guarantee success.
                            </p>
                            <div className="bg-white/50 p-4 rounded-lg">
                                <p className="font-semibold text-amber-900 mb-2">Those who move forward are those who:</p>
                                <ul className="list-disc list-inside space-y-1 text-amber-900/80 ml-2">
                                    <li>Are organized</li>
                                    <li>Are documented</li>
                                    <li>Are already inside aligned systems</li>
                                    <li>Are known to implementation partners</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 4. EasySells Value Prop */}
                <div className="bg-blue-50 rounded-2xl shadow-xl p-8 border-2 border-blue-100">
                    <div className="flex items-center gap-3 mb-6">
                        <DoorOpen className="w-8 h-8 text-blue-600" />
                        <h2 className="text-2xl font-bold text-blue-900">
                            This Is Where EasySales Cooperative Comes In
                        </h2>
                    </div>

                    <div className="space-y-6 text-lg text-slate-700">
                        <p>
                            <strong>EasySales Export is an implementing partner of WAVE.</strong>
                        </p>
                        <p>That means we:</p>
                        <ul className="grid sm:grid-cols-3 gap-4">
                            {[
                                "Understand the execution process",
                                "Know what successful candidates look like",
                                "Are also investing in the ecosystem"
                            ].map((item, i) => (
                                <li key={i} className="bg-white p-4 rounded-lg shadow-sm border border-blue-100 flex items-start gap-2 text-sm font-medium">
                                    <CheckCircle className="w-5 h-5 text-blue-600 shrink-0" />
                                    {item}
                                </li>
                            ))}
                        </ul>

                        <div className="text-center p-6 border-t-2 border-dashed border-blue-200 mt-4">
                            <p className="text-xl font-serif italic text-blue-900">
                                "We invest first in people already inside our structure.<br />
                                Our cooperative members."
                            </p>
                        </div>
                    </div>
                </div>

                {/* 5. Urgency Window */}
                <div className="bg-linear-to-r from-orange-50 to-red-50 rounded-2xl shadow-xl p-8 border border-orange-200">
                    <div className="flex items-center gap-3 mb-6">
                        <Flame className="w-8 h-8 text-orange-600 animate-pulse" />
                        <h2 className="text-2xl font-bold text-orange-900">
                            This Is an Early-Mover Window
                        </h2>
                    </div>

                    <div className="space-y-6 text-lg">
                        <p className="text-slate-700">
                            EasySales Cooperative is not open to everyone. <br />
                            And it will not stay open forever.
                        </p>

                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="bg-white p-6 rounded-xl border-l-4 border-green-500 shadow-sm">
                                <h4 className="font-bold text-green-700 mb-3 uppercase text-sm tracking-wide">Those who join now</h4>
                                <ul className="space-y-2 text-slate-600 text-sm">
                                    <li className="flex gap-2"><ArrowRight className="w-4 h-4 mt-1 text-green-500" /> Position themselves closer to WAVE execution</li>
                                    <li className="flex gap-2"><ArrowRight className="w-4 h-4 mt-1 text-green-500" /> Gain visibility within the ecosystem</li>
                                    <li className="flex gap-2"><ArrowRight className="w-4 h-4 mt-1 text-green-500" /> Align with market access, training, and investment flows</li>
                                </ul>
                            </div>

                            <div className="bg-white p-6 rounded-xl border-l-4 border-red-500 shadow-sm flex flex-col justify-center">
                                <h4 className="font-bold text-red-700 mb-2 uppercase text-sm tracking-wide">Those who wait...</h4>
                                <p className="text-xl font-bold text-red-600 italic">
                                    will watch others move ahead.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 6. Final Warning & CTA */}
                <div className="bg-slate-900 text-white rounded-3xl shadow-2xl overflow-hidden relative">
                    {/* Background Pattern */}
                    <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-emerald-500 via-blue-500 to-slate-900"></div>

                    <div className="relative p-8 md:p-12 text-center space-y-8">
                        <div className="inline-block bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest mb-2">
                            Final Warning
                        </div>

                        <div className="space-y-2">
                            <h2 className="text-3xl font-bold">
                                Don’t be part of the crowd.
                            </h2>
                            <h2 className="text-3xl font-bold text-emerald-400">
                                Be part of the structure.
                            </h2>
                        </div>

                        <p className="text-slate-300 text-lg max-w-xl mx-auto">
                            Most people will close this page and do nothing. A few will act — and those few will benefit.
                        </p>

                        <div className="pt-4">
                            <Link
                                href="/auth/register?callbackUrl=/cooperatives/onboarding"
                                className="inline-flex items-center justify-center gap-2 bg-white text-green-700 px-6 py-3 rounded-full font-bold shadow-lg hover:shadow-xl hover:scale-105 transition-all text-sm sm:text-base border border-green-100"
                            >
                                <ShieldCheck className="w-8 h-8" />
                                ACTIVATE MY MEMBERSHIP NOW
                            </Link>
                            <p className="mt-4 text-sm text-slate-400">
                                Secure your position. Move from registration to real participation.
                            </p>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
