/**
 * Export Windows Rejected Page
 * 
 * Shown when user's application is rejected
 */

import Link from "next/link";
import { XCircle, Home, Mail } from "lucide-react";

export default function ExportRejectedPage() {
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
                        Unfortunately, your Export Windows application has not been approved at this time.
                    </p>

                    {/* Rejection Reasons */}
                    <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8 text-left">
                        <h3 className="font-semibold text-red-900 mb-3">
                            Common reasons for rejection:
                        </h3>
                        <ul className="space-y-2 text-sm text-red-800">
                            <li className="flex items-start gap-2">
                                <span className="text-red-600 mt-1">•</span>
                                <span>Incomplete or unclear KYC documentation</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-600 mt-1">•</span>
                                <span>Bank account verification failed</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-600 mt-1">•</span>
                                <span>Mismatched identity information</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-red-600 mt-1">•</span>
                                <span>Investment profile does not meet minimum requirements</span>
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
                            Please check your inbox for detailed feedback.
                        </p>
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Mail className="w-4 h-4" />
                            <span>Check your email for more details</span>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link
                            href="/export"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors font-semibold"
                        >
                            <Home className="w-5 h-5" />
                            Back to Export Windows
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold"
                        >
                            Go to Dashboard
                        </Link>
                    </div>

                    {/* Support */}
                    <div className="mt-8 pt-8 border-t border-slate-200">
                        <p className="text-sm text-slate-600">
                            Need help? Contact support at{" "}
                            <a
                                href="mailto:support@easysalesexport.com"
                                className="text-orange-600 hover:text-orange-700 font-medium"
                            >
                                support@easysalesexport.com
                            </a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
