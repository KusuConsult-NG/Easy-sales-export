"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { motion } from "framer-motion";
import { CheckCircle, FileText, Clock } from "lucide-react";
import Link from "next/link";

// Force dynamic rendering - page uses useSearchParams()
export const dynamic = 'force-dynamic';

function LoanSuccessContent() {
    const searchParams = useSearchParams();
    const loanId = searchParams.get('id');

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="max-w-2xl w-full"
            >
                {/* Success Card */}
                <div className="relative overflow-hidden rounded-2xl">
                    {/* Animated gradient background */}
                    <div className="absolute inset-0 bg-linear-to-br from-green-500 via-emerald-500 to-teal-500 opacity-90"></div>
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMC41IiBvcGFjaXR5PSIwLjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-30"></div>

                    <div className="relative p-12 text-white">
                        {/* Success Icon */}
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                            className="w-24 h-24 mx-auto mb-6 bg-white rounded-full flex items-center justify-center shadow-2xl"
                        >
                            <CheckCircle className="w-16 h-16 text-green-500" strokeWidth={2.5} />
                        </motion.div>

                        {/* Main Message */}
                        <motion.h1
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3 }}
                            className="text-4xl font-bold text-center mb-4"
                        >
                            Loan Application Submitted!
                        </motion.h1>

                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 }}
                            className="text-lg text-center text-green-50 mb-8"
                        >
                            Your application has been successfully submitted and is now under review.
                        </motion.p>

                        {loanId && (
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.5 }}
                                className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-8 border border-white/20"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-3">
                                        <FileText className="w-5 h-5 text-white" />
                                        <span className="text-sm font-medium">Application ID</span>
                                    </div>
                                    <code className="text-sm font-mono bg-white/20 px-3 py-1 rounded">
                                        {loanId.substring(0, 8)}...
                                    </code>
                                </div>
                            </motion.div>
                        )}

                        {/* Info Cards */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.6 }}
                            className="grid gap-4 mb-8"
                        >
                            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5 border border-white/20">
                                <div className="flex items-start space-x-3">
                                    <Clock className="w-5 h-5 text-white mt-0.5" />
                                    <div>
                                        <h3 className="font-semibold mb-1">What Happens Next?</h3>
                                        <p className="text-sm text-green-50">
                                            Our team will review your application within 2-3 business days.
                                            You'll receive an email notification once a decision has been made.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </motion.div>

                        {/* Action Buttons */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.7 }}
                            className="flex flex-col sm:flex-row gap-4"
                        >
                            <Link
                                href="/dashboard"
                                className="flex-1 bg-white text-green-600 hover:bg-green-50 px-6 py-3 rounded-lg font-semibold text-center transition-colors shadow-lg hover:shadow-xl"
                            >
                                Go to Dashboard
                            </Link>
                            <Link
                                href="/loans"
                                className="flex-1 bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 px-6 py-3 rounded-lg font-semibold text-center transition-colors"
                            >
                                View All Loans
                            </Link>
                        </motion.div>
                    </div>
                </div>

                {/* Additional Info */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    className="mt-8 text-center text-slate-600 dark:text-slate-400"
                >
                    <p className="text-sm">
                        Need help? <Link href="/support" className="text-green-600 hover:text-green-700 font-medium underline">Contact Support</Link>
                    </p>
                </motion.div>
            </motion.div>
        </div>
    );
}

function LoanSuccessPageContent() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="mt-4 text-slate-600 dark:text-slate-400">Loading...</p>
                </div>
            </div>
        }>
            <LoanSuccessContent />
        </Suspense>
    );
}

export default function LoanSuccessPagePage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
            </div>
        }>
            <LoanSuccessPageContent />
        </Suspense>
    );
}
