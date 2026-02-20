import Link from "next/link";
import { COMPANY_INFO } from "@/lib/constants";
import { Shield, Lock, Eye, Users, FileText, Bell } from "lucide-react";

export default function PrivacyPolicyPage() {
    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-slate-900 mb-4">
                        Privacy Policy
                    </h1>
                    <p className="text-slate-600">
                        Last updated: February 6, 2026
                    </p>
                </div>

                {/* Content */}
                <div className="bg-white rounded-2xl shadow-lg p-8 lg:p-12 space-y-8">
                    <p className="text-slate-600 leading-relaxed">
                        <strong>Easy Sales Export LTD. ('Company', 'we', 'us', 'our')</strong> is committed to protecting and respecting your privacy. This Privacy Policy explains how we collect, use, disclose, process, and safeguard personal data when you access our website, enroll in our export training programs, create an account, or participate in our cooperative services.
                    </p>
                    <p className="text-slate-600 leading-relaxed">
                        This Policy complies with applicable data protection laws including the Nigeria Data Protection Act (2023) and, where applicable, international data protection regulations.
                    </p>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">1. Categories of Personal Data Collected</h2>
                        <ul className="list-disc pl-5 space-y-2 text-slate-600">
                            <li>Identification data (full name, identification details where required)</li>
                            <li>Contact data (email address, phone number, residential or business address)</li>
                            <li>Account credentials (username and encrypted password)</li>
                            <li>Payment and transaction data (processed securely via third-party providers)</li>
                            <li>Cooperative membership and financial contribution records</li>
                            <li>Training participation and certification records</li>
                            <li>Technical data (IP address, browser type, device information, usage logs)</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">2. Lawful Basis for Processing</h2>
                        <p className="text-slate-600">
                            We process personal data based on consent, contractual necessity, compliance with legal obligations, and legitimate business interests.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">3. Data Sharing</h2>
                        <p className="text-slate-600">
                            We do not sell personal data. Information may be shared with payment processors, IT providers, email marketing providers, professional advisers, and regulatory authorities where required by law.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">4. Data Retention</h2>
                        <p className="text-slate-600">
                            Personal data is retained only for as long as necessary to fulfill contractual obligations, comply with regulatory requirements, resolve disputes, and enforce agreements.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">5. Data Security</h2>
                        <p className="text-slate-600">
                            We implement appropriate administrative, technical, and physical safeguards to protect personal data. However, no system is entirely secure.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">6. International Transfers</h2>
                        <p className="text-slate-600">
                            Where personal data is transferred outside Nigeria, appropriate safeguards are implemented in accordance with applicable laws.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">7. Data Subject Rights</h2>
                        <p className="text-slate-600">
                            Depending on your jurisdiction, you may have the right to access, rectify, erase, restrict processing, object to processing, and lodge complaints with a supervisory authority.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">8. Contact Information</h2>
                        <p className="text-slate-600">
                            <strong>Easy Sales Export LTD.</strong><br />
                            No. 68 Murtala Mohammed Way, Jos, Plateau State, Nigeria<br />
                            Email: <a href={`mailto:${COMPANY_INFO.contact.general.email}`} className="text-primary hover:underline">{COMPANY_INFO.contact.general.email}</a><br />
                            Phone: <a href={`tel:${COMPANY_INFO.contact.general.phone}`} className="text-primary hover:underline">{COMPANY_INFO.contact.general.phone}</a><br />
                            WhatsApp: <a href={`https://wa.me/${COMPANY_INFO.contact.general.whatsapp}`} className="text-primary hover:underline">{COMPANY_INFO.contact.general.whatsapp}</a>
                        </p>
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
