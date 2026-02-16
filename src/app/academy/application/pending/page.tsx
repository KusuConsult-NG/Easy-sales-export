/**
 * Academy Application - Pending Status
 * 
 * Shown after submitting Academy application
 */

"use client";

import { Clock, CheckCircle2, ArrowLeft, GraduationCap } from "lucide-react";
import Link from "next/link";

export default function AcademyPendingPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="max-w-xl w-full">
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-8 text-center border border-slate-100 dark:border-slate-800">
                    <div className="w-20 h-20 mx-auto mb-6 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                        <Clock className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                    </div>

                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                        Application Under Review
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400 mb-8">
                        Your Academy learner application has been received. We are verifying your profile.
                    </p>

                    <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-6 mb-8 text-left">
                        <h3 className="font-semibold text-slate-900 dark:text-white mb-4">What happens next?</h3>
                        <ul className="space-y-4">
                            <li className="flex gap-3">
                                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                <span className="text-sm text-slate-600 dark:text-slate-400">
                                    Profile verification (24-48 hours)
                                </span>
                            </li>
                            <li className="flex gap-3">
                                <CheckCircle2 className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0" />
                                <span className="text-sm text-slate-600 dark:text-slate-400">
                                    You receive an email notification upon approval
                                </span>
                            </li>
                            <li className="flex gap-3">
                                <GraduationCap className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0" />
                                <span className="text-sm text-slate-600 dark:text-slate-400">
                                    Full access to start your learning journey
                                </span>
                            </li>
                        </ul>
                    </div>

                    <div className="flex flex-col gap-3">
                        <Link
                            href="/academy"
                            className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
                        >
                            Return to Academy
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Return to Main Dashboard
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
