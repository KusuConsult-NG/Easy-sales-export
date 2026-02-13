/**
 * WAVE Application Success Page
 * Shown after successful application submission
 */

"use client";

import Link from "next/link";
import { CheckCircle, ArrowRight, Calendar, Mail, Bell } from "lucide-react";

export default function ApplicationSuccessPage() {
    return (
        <div className="min-h-screen bg-linear-to-br from-emerald-50 via-emerald-50 to-emerald-50 dark:from-gray-900 dark:via-emerald-900/20 dark:to-gray-900 flex items-center justify-center px-4 py-12">
            <div className="max-w-2xl w-full">
                {/* Success Icon */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full mb-6">
                        <CheckCircle className="w-12 h-12 text-green-600" />
                    </div>
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-4">
                        Application Submitted!
                    </h1>
                    <p className="text-lg text-slate-600 dark:text-slate-400">
                        Your WAVE program application has been successfully received
                    </p>
                </div>

                {/* Application Info */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 mb-8">
                    <div className="border-l-4 border-emerald-700 pl-4 mb-6">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                            Application ID
                        </p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            WAVE-{new Date().getFullYear()}-{Math.random().toString(36).substr(2, 9).toUpperCase()}
                        </p>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-start gap-3">
                            <Mail className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Confirmation Email Sent
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Check your inbox for application details and next steps
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <Bell className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Stay Updated
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    We'll notify you via email about your application status
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* What Happens Next */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 mb-8">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                        What Happens Next?                    </h2>
                    <div className="space-y-6">
                        <div className="flex gap-4">
                            <div className="shrink-0">
                                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-700 font-bold">
                                    1
                                </div>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Application Received
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Your application is in our system and queued for review
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="shrink-0">
                                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-700 font-bold">
                                    2
                                </div>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Review by Team (3-5 business days)
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Our team will carefully review your application and documents
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="shrink-0">
                                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-700 font-bold">
                                    3
                                </div>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Interview/Verification (if needed)
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    We may contact you for additional information or a brief interview
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="shrink-0">
                                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-700 font-bold">
                                    4
                                </div>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Approval Decision
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    You'll receive an email with the decision on your application
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <div className="shrink-0">
                                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center text-emerald-700 font-bold">
                                    5
                                </div>
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Onboarding & Training
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    If approved, you'll begin orientation and access program resources
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Next Step: Cooperative Registration */}
                <div className="bg-linear-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl shadow-xl p-8 mb-8 border-2 border-blue-200 dark:border-blue-800">
                    <div className="flex items-start gap-4 mb-4">
                        <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center shrink-0">
                            <ArrowRight className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                Ready for the Next Step?
                            </h2>
                            <p className="text-slate-900 dark:text-white mb-4">
                                As a WAVE participant, you're eligible to join our Cooperative program! Get access to:
                            </p>
                            <ul className="space-y-2 mb-6">
                                <li className="flex items-center gap-2 text-slate-900 dark:text-white">
                                    <CheckCircle className="w-5 h-5 text-blue-600" />
                                    Cooperative savings and loan products
                                </li>
                                <li className="flex items-center gap-2 text-slate-900 dark:text-white">
                                    <CheckCircle className="w-5 h-5 text-blue-600" />
                                    Access to member dividends and shares
                                </li>
                                <li className="flex items-center gap-2 text-slate-900 dark:text-white">
                                    <CheckCircle className="w-5 h-5 text-blue-600" />
                                    Financial literacy training and support
                                </li>
                                <li className="flex items-center gap-2 text-slate-900 dark:text-white">
                                    <CheckCircle className="w-5 h-5 text-blue-600" />
                                    Community of women entrepreneurs
                                </li>
                            </ul>
                            <Link
                                href="/cooperatives/register"
                                className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-bold text-lg transition-all shadow-lg hover:shadow-xl hover:scale-105"
                            >
                                Continue to Cooperative Registration
                                <ArrowRight className="w-5 h-5" />
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-4">
                    <Link
                        href="/wave"
                        className="flex-1 flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-900 dark:text-white px-6 py-3 rounded-xl font-semibold transition-all"
                    >
                        Back to WAVE Home
                    </Link>
                    <Link
                        href="/wave/application/review-pending"
                        className="flex-1 flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-900 dark:text-white px-6 py-3 rounded-xl font-semibold transition-all"
                    >
                        <Calendar className="w-4 h-4" />
                        Check Application Status
                    </Link>
                </div>
            </div>
        </div>
    );
}
