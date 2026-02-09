/**
 * Membership Activation Success
 * 
 * Confirmation page after successful payment
 */

"use client";

import { useState } from "react";
import { CheckCircle, ArrowRight, Home, Wallet, TrendingUp, Users } from "lucide-react";
import Link from "next/link";

export default function CooperativeSuccessPage() {
    // In production, get membership details from URL params or Firestore
    const [membershipId] = useState(() => "COOP-2026-" + Math.random().toString(36).substr(2, 6).toUpperCase());
    const tier = "Premium"; // Would come from onboarding data

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full">
                {/* Success Icon */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-24 h-24 bg-green-100 dark:bg-green-900/30 rounded-full mb-6">
                        <CheckCircle className="w-12 h-12 text-green-600" />
                    </div>
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-3">
                        Welcome to the Cooperative!
                    </h1>
                    <p className="text-xl text-slate-600 dark:text-slate-400">
                        Your membership has been activated successfully
                    </p>
                </div>

                {/* Membership Details */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 mb-6">
                    <h2 className="font-bold text-lg text-slate-900 dark:text-white mb-4">
                        Membership Details
                    </h2>
                    <div className="space-y-3">
                        <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-700">
                            <span className="text-slate-600 dark:text-slate-400">Membership ID:</span>
                            <span className="font-semibold text-slate-900 dark:text-white">{membershipId}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-700">
                            <span className="text-slate-600 dark:text-slate-400">Membership Tier:</span>
                            <span className="font-semibold text-purple-600">{tier}</span>
                        </div>
                        <div className="flex justify-between py-2">
                            <span className="text-slate-600 dark:text-slate-400">Status:</span>
                            <span className="inline-flex items-center gap-2 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-sm font-semibold">
                                <CheckCircle className="w-4 h-4" />
                                Active
                            </span>
                        </div>
                    </div>
                </div>

                {/* Next Steps */}
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-2xl p-6 mb-6">
                    <h3 className="font-bold text-purple-900 dark:text-purple-200 mb-4">
                        What's Next?
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Link
                            href="/cooperatives/my-savings"
                            className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 rounded-xl hover:shadow-md transition-all"
                        >
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 roundedfull flex items-center justify-center">
                                <Wallet className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="font-semibold text-slate-900 dark:text-white">Start Saving</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Make your first deposit</p>
                            </div>
                        </Link>

                        <Link
                            href="/cooperatives/loans"
                            className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 rounded-xl hover:shadow-md transition-all"
                        >
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="font-semibold text-slate-900 dark:text-white">Apply for Loans</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Access low-interest loans</p>
                            </div>
                        </Link>

                        <Link
                            href="/cooperatives/directory"
                            className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 rounded-xl hover:shadow-md transition-all"
                        >
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                                <Users className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="font-semibold text-slate-900 dark:text-white">Member Directory</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Connect with members</p>
                            </div>
                        </Link>

                        <Link
                            href="/"
                            className="flex items-center gap-3 p-4 bg-white dark:bg-slate-800 rounded-xl hover:shadow-md transition-all"
                        >
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                                <Home className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="font-semibold text-slate-900 dark:text-white">Return Home</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Explore other services</p>
                            </div>
                        </Link>
                    </div>
                </div>

                {/* CTA */}
                <div className="text-center">
                    <Link
                        href="/cooperatives/my-savings"
                        className="inline-flex items-center gap-3 px-8 py-4 bg-purple-600 text-white rounded-xl font-bold text-lg hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all"
                    >
                        Go to Dashboard
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
