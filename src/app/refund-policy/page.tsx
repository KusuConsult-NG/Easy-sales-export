import Link from "next/link";
import { RefreshCcw } from "lucide-react";

export default function RefundPolicyPage() {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 py-12 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="inline-flex justify-center items-center w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full mb-6">
                        <RefreshCcw className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-4">
                        Refund Policy
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Last updated: February 6, 2026
                    </p>
                </div>

                {/* Content */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-8 lg:p-12 space-y-8">
                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">1. Recorded Digital Trainings</h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            All purchases of recorded or on-demand training programs are final and non-refundable once access is granted.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">2. Live Trainings</h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Refund requests must be submitted at least 14 days before the scheduled training date. No refunds will be granted after this period. Failure to attend does not qualify for a refund.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">3. Cooperative Membership Fees</h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Membership fees and cooperative contributions are governed by separate Cooperative Membership Terms and are non-refundable except where expressly provided.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">4. Chargebacks</h2>
                        <p className="text-slate-600 dark:text-slate-400">
                            Unauthorized chargebacks constitute a breach of contract. The Company reserves the right to dispute chargebacks and suspend accounts.
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
