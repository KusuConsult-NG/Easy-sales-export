"use client";

import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle, FileText, Clock } from "lucide-react";
import Link from "next/link";

// Force dynamic rendering - page uses useSearchParams()
export const dynamic = 'force-dynamic';


export default function LoanSuccessPage() {
    const searchParams = useSearchParams();
    const loanId = searchParams.get('id');

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="max-w-2xl w-full bg-white dark:bg-slate-800 rounded-2xl p-12 shadow-2xl text-center"
            >
                {/* Success Icon */}
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 10 }}
                    className="w-24 h-24 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-6"
                >
                    <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
                </motion.div>

                {/* Title */}
                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-3xl font-bold text-slate-900 dark:text-white mb-4"
                >
                    Application Submitted Successfully!
                </motion.h1>

                {/* Description */}
                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="text-slate-600 dark:text-slate-400 mb-8"
                >
                    Your loan application has been received and is being reviewed by our team.
                    We'll notify you once a decision has been made.
                </motion.p>

                {/* Application ID */}
                {loanId && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="bg-slate-50 dark:bg-slate-700 rounded-xl p-6 mb-8"
                    >
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Application ID</p>
                        <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                            {loanId}
                        </p>
                    </motion.div>
                )}

                {/* Next Steps */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 }}
                    className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6 mb-8"
                >
                    <h3 className="font-bold text-slate-900 dark:text-white mb-4 flex items-center justify-center gap-2">
                        <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        What Happens Next?
                    </h3>
                    <ul className="text-left space-y-3 text-sm text-slate-600 dark:text-slate-400">
                        <li className="flex items-start gap-2">
                            <span className="text-blue-600 dark:text-blue-400 font-bold">1.</span>
                            <span>Our team will review your application within 2-3 business days</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-blue-600 dark:text-blue-400 font-bold">2.</span>
                            <span>We may contact you for additional documentation if needed</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-blue-600 dark:text-blue-400 font-bold">3.</span>
                            <span>You'll receive an email notification with the decision</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="text-blue-600 dark:text-blue-400 font-bold">4.</span>
                            <span>If approved, funds will be disbursed to your account</span>
                        </li>
                    </ul>
                </motion.div>

                {/* Action Buttons */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 }}
                    className="flex gap-4 justify-center"
                >
                    <Link
                        href="/loans"
                        className="px-6 py-3 bg-[#1358ec] text-white rounded-xl font-medium hover:bg-[#1046c7] transition-colors flex items-center gap-2"
                    >
                        <FileText className="w-5 h-5" />
                        View My Applications
                    </Link>

                    <Link
                        href="/dashboard"
                        className="px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white rounded-xl font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                    >
                        Back to Dashboard
                    </Link>
                </motion.div>
            </motion.div>
        </div>
    );
}
