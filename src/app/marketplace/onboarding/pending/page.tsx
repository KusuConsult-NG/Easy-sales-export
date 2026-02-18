/**
 * Marketplace Pending Page
 * 
 * Shown when seller application is under review
 */

import Link from "next/link";
import { Clock, CheckCircle, Mail, Home } from "lucide-react";

export default function MarketplacePendingPage() {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full">
                {/* Card */}
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                    {/* Icon */}
                    <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Clock className="w-10 h-10 text-orange-600" />
                    </div>

                    {/* Title */}
                    <h1 className="text-3xl font-bold text-slate-900 mb-4">
                        Application Under Review
                    </h1>

                    {/* Message */}
                    <p className="text-lg text-slate-600 mb-8">
                        Thank you for registering as a seller! Your application and documents are currently being reviewed by our team.
                    </p>

                    {/* Timeline */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 mb-8">
                        <h3 className="font-semibold text-slate-900 mb-4">
                            Verification Timeline
                        </h3>
                        <div className="space-y-4">
                            <div className="flex items-start gap-4">
                                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                                    <CheckCircle className="w-5 h-5 text-white" />
                                </div>
                                <div className="text-left flex-1">
                                    <p className="font-semibold text-slate-900">Application Submitted</p>
                                    <p className="text-sm text-slate-600">Your documents have been received</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0 animate-pulse">
                                    <Clock className="w-5 h-5 text-white" />
                                </div>
                                <div className="text-left flex-1">
                                    <p className="font-semibold text-slate-900">Under Review</p>
                                    <p className="text-sm text-slate-600">Our team is verifying your information</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4 opacity-50">
                                <div className="w-8 h-8 bg-slate-300 rounded-full flex items-center justify-center flex-shrink-0">
                                    <Mail className="w-5 h-5 text-slate-500" />
                                </div>
                                <div className="text-left flex-1">
                                    <p className="font-semibold text-slate-900">Decision Notification</p>
                                    <p className="text-sm text-slate-600">You'll receive an email (1-3 days)</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Expected Time */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
                        <div className="flex items-center justify-center gap-2 text-blue-900">
                            <Clock className="w-5 h-5" />
                            <span className="font-semibold">Expected review time: 1-3 business days</span>
                        </div>
                    </div>

                    {/* What's Next */}
                    <div className="text-left bg-slate-50 border border-slate-200 rounded-lg p-6 mb-8">
                        <h3 className="font-semibold text-slate-900 mb-3">
                            What happens next?
                        </h3>
                        <ul className="space-y-2 text-sm text-slate-900">
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-1">✓</span>
                                <span>We'll verify your business documents and tax ID</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-1">✓</span>
                                <span>If approved, you'll get immediate access to your seller dashboard</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-1">✓</span>
                                <span>You can start listing products right away</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-1">✓</span>
                                <span>If we need more information, we'll contact you via email</span>
                            </li>
                        </ul>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link
                            href="/marketplace"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors font-semibold"
                        >
                            <Home className="w-5 h-5" />
                            Back to Marketplace
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-semibold"
                        >
                            Go to Dashboard
                        </Link>
                    </div>

                    {/* Support */}
                    <div className="mt-8 pt-8 border-t border-slate-200">
                        <p className="text-sm text-slate-600">
                            Need help? Contact support at{" "}
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
