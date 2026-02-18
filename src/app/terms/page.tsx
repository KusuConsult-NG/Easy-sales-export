import Link from "next/link";
import { COMPANY_INFO } from "@/lib/constants";
import { FileCheck, Users, DollarSign, Shield, AlertTriangle, Scale } from "lucide-react";

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-slate-900 mb-4">
                        Terms and Conditions
                    </h1>
                    <p className="text-slate-600">
                        Last updated: February 6, 2026
                    </p>
                </div>

                {/* Content */}
                <div className="bg-white rounded-2xl shadow-lg p-8 lg:p-12 space-y-8">
                    <p className="text-slate-600 leading-relaxed">
                        These Terms & Conditions govern the use of services provided by <strong>Easy Sales Export LTD.</strong>. By accessing our website or purchasing our services, you agree to be legally bound by these Terms.
                    </p>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">1. Services</h2>
                        <p className="text-slate-600">
                            The Company provides live export training programs, recorded digital courses, educational materials, and cooperative-related services subject to separate agreements.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">2. Account Responsibility</h2>
                        <p className="text-slate-600">
                            Users are responsible for maintaining confidentiality of login credentials and for all activities conducted under their account.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">3. Payment Terms</h2>
                        <p className="text-slate-600">
                            Full payment is required prior to access. The Company reserves the right to modify pricing at any time.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">4. Intellectual Property Rights</h2>
                        <p className="text-slate-600">
                            All course materials, videos, documents, branding, and proprietary methodologies are the exclusive property of the Company. Unauthorized reproduction, recording, redistribution, resale, or public sharing is strictly prohibited.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">5. Disclaimer of Guarantees</h2>
                        <p className="text-slate-600">
                            All trainings are provided for educational purposes only. The Company does not guarantee export approvals, profitability, regulatory clearance, or business success.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">6. Limitation of Liability</h2>
                        <p className="text-slate-600">
                            To the maximum extent permitted by law, the Company shall not be liable for indirect, incidental, consequential, or financial losses arising from participation in our programs.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">7. Governing Law</h2>
                        <p className="text-slate-600">
                            These Terms shall be governed by and interpreted in accordance with the laws of the Federal Republic of Nigeria.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">8. Dispute Resolution</h2>
                        <p className="text-slate-600">
                            Any disputes shall first be resolved amicably. Where unresolved, disputes shall be submitted to arbitration in Nigeria in accordance with applicable arbitration laws.
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
