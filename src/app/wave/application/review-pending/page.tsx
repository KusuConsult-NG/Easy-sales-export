/**
 * WAVE Application Review Pending Page
 * Shows current status while application is under review
 */

"use client";

import Link from "next/link";
import { Clock, Mail, Phone, ArrowLeft, FileText, CheckCircle } from "lucide-react";

export default function ReviewPendingPage() {
    // Mock data - in production, fetch from database
    const applicationDate = new Date();
    const expectedReviewDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now

    return (
        <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-emerald-50 to-emerald-50 dark:from-gray-900 dark:via-emerald-900/20 dark:to-gray-900 px-4 py-12">
            <div className="max-w-3xl mx-auto">
                {/* Back Link */}
                <Link
                    href="/wave"
                    className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-500 mb-8 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to WAVE Home
                </Link>

                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full mb-4">
                        <Clock className="w-8 h-8 text-amber-600" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Application Under Review
                    </h1>
                    <p className="text-lg text-slate-600 dark:text-slate-400">
                        Your WAVE program application is being reviewed by our team
                    </p>
                </div>

                {/* Status Card */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 mb-8">
                    <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-200 dark:border-slate-700">
                        <div className="flex-1">
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                Application Status
                            </p>
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-2 px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full font-semibold">
                                    <Clock className="w-4 h-4" />
                                    Pending Review
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                Submitted
                            </p>
                            <p className="font-semibold text-slate-900 dark:text-white">
                                {applicationDate.toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                })}
                            </p>
                        </div>
                    </div>

                    {/* Progress Steps */}
                    <div className="space-y-4 mb-6">
                        <div className="flex items-start gap-4">
                            <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Application Received
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Submitted on {applicationDate.toLocaleDateString()}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="w-6 h-6 border-4 border-amber-600 rounded-full shrink-0 mt-0.5 animate-pulse" />
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Under Review
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Our team is reviewing your application
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="w-6 h-6 border-2 border-slate-300 dark:border-slate-600 rounded-full shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-slate-600 dark:text-slate-400 mb-1">
                                    Decision Pending
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Expected by {expectedReviewDate.toLocaleDateString()}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Timeline Note */}
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-300 dark:border-emerald-800 rounded-xl p-4">
                        <p className="text-sm text-emerald-700 dark:text-emerald-400">
                            <strong>Estimated Review Time:</strong> 3-5 business days. We'll notify you via email once a decision has been made.
                        </p>
                    </div>
                </div>

                {/* What to Expect */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 mb-8">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-6">
                        What to Expect
                    </h2>
                    <div className="space-y-4">
                        <div className="flex items-start gap-3">
                            <FileText className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Document Verification
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    We're verifying all submitted documents and information
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <Phone className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Possible Interview
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    We may contact you for additional questions or clarification
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <Mail className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                    Email Notification
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    You'll receive an email with our decision and next steps
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Contact Support */}
                <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-6 text-center">
                    <p className="text-slate-700 dark:text-slate-300 mb-4">
                        Have questions about your application?
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <a
                            href="mailto:wave@easysalesexport.com"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-700 text-white rounded-xl font-semibold transition-all"
                        >
                            <Mail className="w-4 h-4" />
                            Email Support
                        </a>
                        <a
                            href="tel:+2348012345678"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition-all"
                        >
                            <Phone className="w-4 h-4" />
                            Call Us
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
