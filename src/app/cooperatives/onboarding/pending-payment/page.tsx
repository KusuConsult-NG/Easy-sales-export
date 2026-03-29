/**
 * Pending Payment
 * 
 * Waiting for manual payment verification
 */

"use client";

import { useState, useEffect, Suspense } from "react";
import { Clock, Building2, Upload, CheckCircle, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { COMPANY_INFO } from "@/lib/constants";

function PendingPaymentContent() {
    const searchParams = useSearchParams();
    const [paymentReference] = useState(() => {
        // Use ref from URL params if available (set during checkout)
        return searchParams.get("ref") || "COOP-PAY-" + Math.random().toString(36).substr(2, 9).toUpperCase();
    });
    const amount = parseInt(searchParams.get("amount") || "15000", 10);
    const tier = searchParams.get("tier") || "Standard";

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <Link
                    href="/cooperatives"
                    className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 mb-8"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Cooperatives
                </Link>

                {/* Status Icon */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-24 h-24 bg-orange-100 rounded-full mb-6">
                        <Clock className="w-12 h-12 text-orange-600" />
                    </div>
                    <h1 className="text-4xl font-bold text-slate-900 mb-3">
                        Payment Pending
                    </h1>
                    <p className="text-xl text-slate-600">
                        We're waiting to verify your payment
                    </p>
                </div>

                {/* Payment Details */}
                <div className="bg-white rounded-2xl border border-slate-200 p-8 mb-6">
                    <h2 className="font-bold text-lg text-slate-900 mb-6">
                        Payment Summary
                    </h2>
                    <div className="space-y-3 mb-6">
                        <div className="flex justify-between py-2 border-b border-slate-200">
                            <span className="text-slate-600">Payment Reference:</span>
                            <span className="font-mono font-semibold text-slate-900">{paymentReference}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-200">
                            <span className="text-slate-600">Membership Tier:</span>
                            <span className="font-semibold text-purple-600">{tier}</span>
                        </div>
                        <div className="flex justify-between py-2">
                            <span className="text-slate-600">Amount:</span>
                            <span className="text-2xl font-bold text-slate-900">₦{amount.toLocaleString()}</span>
                        </div>
                    </div>

                    {/* Bank Details */}
                    <div className="bg-slate-50 rounded-xl p-6 mb-6">
                        <div className="flex items-center gap-3 mb-4">
                            <Building2 className="w-6 h-6 text-purple-600" />
                            <h3 className="font-bold text-slate-900">
                                Bank Transfer Details
                            </h3>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <p className="text-sm text-slate-600 mb-1">Bank Name:</p>
                                <p className="font-semibold text-slate-900">First Bank of Nigeria</p>
                            </div>
                            <div>
                                <p className="text-sm text-slate-600 mb-1">Account Number:</p>
                                <p className="font-mono font-semibold text-slate-900 text-lg">2015678942</p>
                            </div>
                            <div>
                                <p className="text-sm text-slate-600 mb-1">Account Name:</p>
                                <p className="font-semibold text-slate-900">Easy Sales Export Cooperative</p>
                            </div>
                            <div className="pt-3 border-t border-slate-200">
                                <p className="text-sm text-slate-600 mb-1">Reference (Use this as narration):</p>
                                <p className="font-mono font-bold text-purple-600 text-lg">{paymentReference}</p>
                            </div>
                        </div>
                    </div>

                    {/* Upload Proof */}
                    <div className="border-2 border-dashed border-purple-300 rounded-xl p-6 text-center bg-purple-50">
                        <Upload className="w-12 h-12 text-purple-600 mx-auto mb-3" />
                        <h3 className="font-bold text-slate-900 mb-2">
                            Upload Proof of Payment
                        </h3>
                        <p className="text-sm text-slate-600 mb-4">
                            Upload your payment receipt to speed up verification
                        </p>
                        <button className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all">
                            Upload Receipt
                        </button>
                    </div>
                </div>

                {/* Timeline */}
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 mb-6">
                    <h3 className="font-bold text-blue-900 mb-4">
                        What Happens Next?
                    </h3>
                    <div className="space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                1
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900">Make Transfer</p>
                                <p className="text-sm text-blue-800">
                                    Transfer ₦{amount.toLocaleString()} to the account above using the reference number
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                2
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900">Upload Receipt (Optional)</p>
                                <p className="text-sm text-blue-800">
                                    Upload proof of payment to speed up verification (optional)
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                3
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900">Verification</p>
                                <p className="text-sm text-blue-800">
                                    We'll verify your payment within 24-48 hours
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                4
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900">Activation</p>
                                <p className="text-sm text-blue-800">
                                    Your membership will be activated and you'll receive a confirmation email
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Support */}
                <div className="bg-slate-100 rounded-2xl p-6 text-center">
                    <p className="text-slate-600 mb-3">
                        Need help with your payment?
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-4">
                        <a href={`mailto:${COMPANY_INFO.contact.general.email}`} className="text-purple-600 hover:text-purple-700 font-semibold">
                            {COMPANY_INFO.contact.general.email}
                        </a>
                        <span className="text-slate-400">•</span>
                        <a href={`tel:${COMPANY_INFO.contact.general.phone}`} className="text-purple-600 hover:text-purple-700 font-semibold">
                            {COMPANY_INFO.contact.general.phone}
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function PendingPaymentPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            </div>
        }>
            <PendingPaymentContent />
        </Suspense>
    );
}
