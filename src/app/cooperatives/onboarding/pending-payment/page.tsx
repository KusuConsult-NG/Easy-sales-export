/**
 * Pending Payment
 * 
 * Waiting for manual payment verification
 */

"use client";

import { useState } from "react";
import { Clock, Building2, Upload, CheckCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function PendingPaymentPage() {
    // In production, get from URL params or Firestore
    const [paymentReference] = useState(() => "COOP-PAY-" + Math.random().toString(36).substr(2, 9).toUpperCase());
    const amount = 15000;
    const tier = "Premium";

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <Link
                    href="/cooperatives"
                    className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-purple-600 mb-8"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Cooperatives
                </Link>

                {/* Status Icon */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-24 h-24 bg-orange-100 dark:bg-orange-900/30 rounded-full mb-6">
                        <Clock className="w-12 h-12 text-orange-600" />
                    </div>
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-3">
                        Payment Pending
                    </h1>
                    <p className="text-xl text-slate-600 dark:text-slate-400">
                        We're waiting to verify your payment
                    </p>
                </div>

                {/* Payment Details */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 mb-6">
                    <h2 className="font-bold text-lg text-slate-900 dark:text-white mb-6">
                        Payment Summary
                    </h2>
                    <div className="space-y-3 mb-6">
                        <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-700">
                            <span className="text-slate-600 dark:text-slate-400">Payment Reference:</span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-white">{paymentReference}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-700">
                            <span className="text-slate-600 dark:text-slate-400">Membership Tier:</span>
                            <span className="font-semibold text-purple-600">{tier}</span>
                        </div>
                        <div className="flex justify-between py-2">
                            <span className="text-slate-600 dark:text-slate-400">Amount:</span>
                            <span className="text-2xl font-bold text-slate-900 dark:text-white">₦{amount.toLocaleString()}</span>
                        </div>
                    </div>

                    {/* Bank Details */}
                    <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-6 mb-6">
                        <div className="flex items-center gap-3 mb-4">
                            <Building2 className="w-6 h-6 text-purple-600" />
                            <h3 className="font-bold text-slate-900 dark:text-white">
                                Bank Transfer Details
                            </h3>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Bank Name:</p>
                                <p className="font-semibold text-slate-900 dark:text-white">First Bank of Nigeria</p>
                            </div>
                            <div>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Account Number:</p>
                                <p className="font-mono font-semibold text-slate-900 dark:text-white text-lg">2015678942</p>
                            </div>
                            <div>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Account Name:</p>
                                <p className="font-semibold text-slate-900 dark:text-white">Easy Sales Export Cooperative</p>
                            </div>
                            <div className="pt-3 border-t border-slate-200 dark:border-slate-700">
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Reference (Use this as narration):</p>
                                <p className="font-mono font-bold text-purple-600 text-lg">{paymentReference}</p>
                            </div>
                        </div>
                    </div>

                    {/* Upload Proof */}
                    <div className="border-2 border-dashed border-purple-300 dark:border-purple-700 rounded-xl p-6 text-center bg-purple-50 dark:bg-purple-900/10">
                        <Upload className="w-12 h-12 text-purple-600 mx-auto mb-3" />
                        <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                            Upload Proof of Payment
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                            Upload your payment receipt to speed up verification
                        </p>
                        <button className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all">
                            Upload Receipt
                        </button>
                    </div>
                </div>

                {/* Timeline */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6 mb-6">
                    <h3 className="font-bold text-blue-900 dark:text-blue-200 mb-4">
                        What Happens Next?
                    </h3>
                    <div className="space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                1
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900 dark:text-blue-200">Make Transfer</p>
                                <p className="text-sm text-blue-800 dark:text-blue-300">
                                    Transfer ₦{amount.toLocaleString()} to the account above using the reference number
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                2
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900 dark:text-blue-200">Upload Receipt (Optional)</p>
                                <p className="text-sm text-blue-800 dark:text-blue-300">
                                    Upload proof of payment to speed up verification (optional)
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                3
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900 dark:text-blue-200">Verification</p>
                                <p className="text-sm text-blue-800 dark:text-blue-300">
                                    We'll verify your payment within 24-48 hours
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                4
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900 dark:text-blue-200">Activation</p>
                                <p className="text-sm text-blue-800 dark:text-blue-300">
                                    Your membership will be activated and you'll receive a confirmation email
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Support */}
                <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-6 text-center">
                    <p className="text-slate-600 dark:text-slate-400 mb-3">
                        Need help with your payment?
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-4">
                        <a href="mailto:support@easysales.ng" className="text-purple-600 hover:text-purple-700 font-semibold">
                            support@easysales.ng
                        </a>
                        <span className="text-slate-400">•</span>
                        <a href="tel:+2348012345678" className="text-purple-600 hover:text-purple-700 font-semibold">
                            +234 801 234 5678
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}
