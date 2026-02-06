import Link from "next/link";
import { COMPANY_INFO } from "@/lib/constants";
import { FileCheck, Users, DollarSign, Shield, AlertTriangle, Scale } from "lucide-react";

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-4">
                        Terms and Conditions
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Last updated: February 6, 2026
                    </p>
                </div>

                {/* Content */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 lg:p-12 space-y-8">
                    {/* Acceptance */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <FileCheck className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Acceptance of Terms
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            By accessing and using {COMPANY_INFO.name}'s platform, you agree to be bound by these Terms and Conditions. If you do not agree with any part of these terms, please do not use our services.
                        </p>
                    </section>

                    {/* Platform Services */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <Users className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Platform Services
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 mb-4">
                            {COMPANY_INFO.name} provides the following services:
                        </p>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Agricultural export window coordination and facilitation</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Cooperative society membership and financial services</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Agricultural marketplace for produce trading</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>WAVE agricultural training program</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Agricultural education through Farm Nation LMS</span>
                            </li>
                        </ul>
                    </section>

                    {/* User Obligations */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <Scale className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                User Obligations
                            </h2>
                        </div>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Provide accurate and truthful information during registration</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Maintain the confidentiality of your account credentials</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Comply with all applicable laws and regulations</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Not engage in fraudulent activities or misuse platform services</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Respect intellectual property rights</span>
                            </li>
                        </ul>
                    </section>

                    {/* Financial Services */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <DollarSign className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Financial Services & Payments
                            </h2>
                        </div>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Cooperative contributions are processed through secure payment gateways</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Loan applications are subject to approval based on contribution history and tier</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Interest rates and terms are clearly disclosed before approval</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>All financial transactions are recorded in audit logs</span>
                            </li>
                        </ul>
                    </section>

                    {/* Liability */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <Shield className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Limitation of Liability
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            {COMPANY_INFO.name} acts as a facilitator and platform provider. We are not responsible for the quality, safety, or legality of products listed, the accuracy of user-generated content, or the ability of users to complete transactions. Our liability is limited to the extent permitted by law.
                        </p>
                    </section>

                    {/* Account Termination */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <AlertTriangle className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Account Termination
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            We reserve the right to suspend or terminate accounts that violate these terms, engage in fraudulent activities, or pose security risks to the platform. Users may also request account deletion at any time.
                        </p>
                    </section>

                    {/* Changes to Terms */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                            Changes to Terms
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            We may update these Terms and Conditions from time to time. Continued use of the platform after changes constitutes acceptance of the updated terms. We will notify users of significant changes via email or platform notifications.
                        </p>
                    </section>

                    {/* Contact */}
                    <section className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                            Questions?
                        </h2>
                        <p className="text-slate-600 dark:text-slate-400 mb-4">
                            If you have questions about these Terms and Conditions, please contact us:
                        </p>
                        <div className="space-y-2 text-slate-700 dark:text-slate-300">
                            <p><strong>Email:</strong> <a href={`mailto:${COMPANY_INFO.email}`} className="text-primary hover:underline">{COMPANY_INFO.email}</a></p>
                            <p><strong>Phone:</strong> <a href={`tel:${COMPANY_INFO.phone}`} className="text-primary hover:underline">{COMPANY_INFO.phone}</a></p>
                        </div>
                    </section>
                </div>

                {/* Back Link */}
                <div className="mt-8 text-center">
                    <Link
                        href="/"
                        className="text-primary hover:underline font-semibold"
                    >
                        ← Back to Home
                    </Link>
                </div>
            </div>
        </div>
    );
}
