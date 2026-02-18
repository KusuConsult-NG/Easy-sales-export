/**
 * Marketplace Rejected Page
 * 
 * Shown when seller application is rejected
 */

import Link from "next/link";
import { XCircle, Home, Mail } from "lucide-react";

export default function MarketplaceRejectedPage() {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full">
                {/* Card */}
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                    {/* Icon */}
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <XCircle className="w-10 h-10 text-red-600" />
                    </div>

                    {/* Title */}
                    <h1 className="text-3xl font-bold text-slate-900 mb-4">
                        Application Not Approved
                    </h1>

                    {/* Message */}
                    <p className="text-lg text-slate-600 mb-8">
                        Unfortunately, your seller application has not been approved at this time.
                    </p>

                    {/* Rejection Reasons */}
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8 text-left">
                        <h3 className="font-semibold text-red-900 mb-3">
                            Common reasons for rejection:
                        </h3>
                        <ul className="space-y-2 text-sm text-red-800">
                            <li className="flex items-start gap-2">
                                <span className="text-red-600 mt-1">•</span>
                                <span>Incomplete or unclear business documentation</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-600 mt-1">•</span>
                                <span>Invalid or unverifiable Tax ID (TIN)</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-600 mt-1">•</span>
                                <span>Bank account verification failed</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-600 mt-1">•</span>
                                <span>Business information does not meet marketplace standards</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-600 mt-1">•</span>
                                <span>Product categories outside our current scope</span>
                            </li>
                        </ul>
                    </div>

                    {/* Next Steps */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 mb-8 text-left">
                        <h3 className="font-semibold text-slate-900 mb-3">
                            What can you do?
                        </h3>
                        <p className="text-sm text-slate-600 mb-4">
                            You may reapply after addressing the issues mentioned in your rejection email.
                            Please check your inbox for detailed feedback on your application.
                        </p>
                        <div className="space-y-2 text-sm text-slate-900">
                            <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-slate-500" />
                                <span>Check your email for specific feedback</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-green-600">✓</span>
                                <span>Address all mentioned issues</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-green-600">✓</span>
                                <span>Gather complete and valid documents</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-green-600">✓</span>
                                <span>Reapply through the onboarding process</span>
                            </div>
                        </div>
                    </div>

                    {/* Buyer Alternative */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
                        <p className="text-sm text-blue-900">
                            <strong>Want to buy products instead?</strong><br />
                            You can still use the marketplace as a buyer with immediate access.
                            Simply register as a buyer through the onboarding process.
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link
                            href="/marketplace/onboarding"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-semibold"
                        >
                            Reapply as Seller
                        </Link>
                        <Link
                            href="/marketplace"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors font-semibold"
                        >
                            <Home className="w-5 h-5" />
                            Back to Marketplace
                        </Link>
                    </div>

                    {/* Support */}
                    <div className="mt-8 pt-8 border-t border-slate-200">
                        <p className="text-sm text-slate-600">
                            Have questions? Contact support at{" "}
                            <a
                                href="mailto:marketplace@easysalesexport.com"
                                className="text-green-600 hover:text-green-700 font-medium"
                            >
                                marketplace@easysalesexport.com
                            </a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
