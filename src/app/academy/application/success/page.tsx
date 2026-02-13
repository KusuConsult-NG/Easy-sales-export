import { CheckCircle, ArrowRight, GraduationCap } from "lucide-react";
import Link from "next/link";

export default function AcademyApplicationSuccessPage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 flex items-center justify-center p-6">
            <div className="max-w-2xl w-full">
                <div className="bg-white dark:bg-slate-800 rounded-3xl p-12 shadow-2xl text-center">
                    {/* Success Icon */}
                    <div className="w-24 h-24 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-16 h-16 text-green-600" />
                    </div>

                    {/* Title */}
                    <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
                        Application Submitted Successfully!
                    </h1>

                    {/* Message */}
                    <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
                        Thank you for applying to Easy Sales Academy. Your learner application has been received and is being processed.
                    </p>

                    {/* Next Steps */}
                    <div className="bg-blue-50 dark:bg-blue-950/30 rounded-2xl p-6 mb-8 text-left">
                        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white mb-4">
                            <GraduationCap className="w-6 h-6 text-blue-600" />
                            What Happens Next?
                        </h2>
                        <ol className="space-y-3 text-slate-900 dark:text-white">
                            <li className="flex items-start gap-3">
                                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                                    1
                                </span>
                                <span>You'll receive a confirmation email at your registered email address</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                                    2
                                </span>
                                <span>Our team will review your application (usually within 24-48 hours)</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                                    3
                                </span>
                                <span>You'll receive login credentials and instructions to access the Academy portal</span>
                            </li>
                        </ol>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link
                            href="/academy"
                            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg hover:shadow-blue-500/50"
                        >
                            Back to Academy Home
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white font-bold rounded-xl hover:bg-slate-300 dark:hover:bg-slate-600 transition"
                        >
                            Go to Dashboard
                        </Link>
                    </div>

                    {/* Help Text */}
                    <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
                        Questions? Contact us at{" "}
                        <a href="mailto:academy@easysalesexport.com" className="text-blue-600 hover:underline font-semibold">
                            academy@easysalesexport.com
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
}
