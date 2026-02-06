import Link from "next/link";
import { COMPANY_INFO } from "@/lib/constants";
import { Shield, Lock, Eye, Users, FileText, Bell } from "lucide-react";

export default function PrivacyPolicyPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-4">
                        Privacy Policy
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Last updated: February 6, 2026
                    </p>
                </div>

                {/* Content */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 lg:p-12 space-y-8">
                    {/* Introduction */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <Shield className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Our Commitment to Privacy
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            {COMPANY_INFO.name} is committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, and safeguard your data.
                        </p>
                    </section>

                    {/* Information We Collect */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <FileText className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Information We Collect
                            </h2>
                        </div>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span><strong>Personal Information:</strong> Name, email address, phone number, and gender during registration</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span><strong>Business Information:</strong> Export documentation, cooperative contributions, and transaction history</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span><strong>Usage Data:</strong> Platform activity, session information, and preferences</span>
                            </li>
                        </ul>
                    </section>

                    {/* How We Use Your Information */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <Users className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                How We Use Your Information
                            </h2>
                        </div>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Provide and improve our export facilitation services</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Process cooperative contributions and loan applications</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Communicate important updates and notifications</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Ensure platform security and prevent fraud</span>
                            </li>
                        </ul>
                    </section>

                    {/* Data Security */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <Lock className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Data Security
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            We implement industry-standard security measures including encryption, secure authentication, and regular security audits to protect your information. All payment processing is handled through certified payment gateways (Paystack) with PCI DSS compliance.
                        </p>
                    </section>

                    {/* Your Rights */}
                    <section>
                        <div className="flex items-center gap-3 mb-4">
                            <Eye className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Your Rights
                            </h2>
                        </div>
                        <ul className="space-y-3 text-slate-600 dark:text-slate-400">
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Access and review your personal data</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Request correction of inaccurate information</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Request deletion of your account and data</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <span>Opt-out of marketing communications</span>
                            </li>
                        </ul>
                    </section>

                    {/* Contact */}
                    <section className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center gap-3 mb-4">
                            <Bell className="w-6 h-6 text-primary" />
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Contact Us
                            </h2>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 mb-4">
                            For questions about this Privacy Policy or to exercise your rights, contact us at:
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
