/**
 * Cooperative Onboarding - Application Submitted
 *
 * Shown after the member submits their completed application.
 * Displays congratulations + under-review notice.
 */
"use client";

import { useEffect } from "react";
import { CheckCircle2, Clock, Mail, ShieldCheck, PartyPopper, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { usePendingApplicationStatus } from "@/hooks/usePendingApplicationStatus";
import { COLLECTIONS } from "@/lib/client-collections";

export default function CooperativePendingPage() {
    const { data: session } = useSession();
    const router = useRouter();

    const isDedicatedCoop = typeof window !== "undefined" && (
        window.location.hostname.replace(/^www\./, "").toLowerCase() === "easysalescooperative.com" ||
        window.location.hostname.replace(/^www\./, "").toLowerCase().endsWith(".easysalescooperative.com")
    );
    const prefix = isDedicatedCoop ? "" : "/cooperatives";
    const hubUrl = isDedicatedCoop ? "https://www.easysalesexport.com/dashboard" : "/dashboard";

    const { status: applicationStatus } = usePendingApplicationStatus({
        collectionName: COLLECTIONS.COOPERATIVE_MEMBERS,
        userId: session?.user?.id,
        statusField: "membershipStatus",
    });

    useEffect(() => {
        if (applicationStatus === "approved" || applicationStatus === "active") {
            router.replace(`${prefix}/dashboard`);
        } else if (applicationStatus === "rejected" || applicationStatus === "revision_required") {
            router.replace(`${prefix}/onboarding`);
        }
    }, [applicationStatus, router, prefix]);



    return (
        <div
            className="min-h-screen flex items-center justify-center p-4"
            style={{ background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 50%, #ddd6fe 100%)" }}
        >
            <div className="max-w-xl w-full">
                <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">

                    {/* Top banner */}
                    <div className="bg-linear-to-r from-purple-600 to-violet-600 px-8 py-12 text-center text-white relative overflow-hidden">
                        {/* Decorative circles */}
                        <div className="absolute -top-6 -right-6 w-32 h-32 bg-white/10 rounded-full" />
                        <div className="absolute -bottom-8 -left-8 w-40 h-40 bg-white/10 rounded-full" />

                        <div className="relative flex flex-col items-center">
                            <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-5">
                                <PartyPopper className="w-12 h-12 text-white" />
                            </div>

                            <div className="flex flex-col sm:flex-row items-center gap-4 mb-2">
                                <h1 className="text-3xl font-extrabold">
                                    Application Submitted! 🎉
                                </h1>
                            </div>

                            {applicationStatus === "pending" && (
                                <Link
                                    href={`${prefix}/onboarding?edit=true`}
                                    className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 border border-white/40 rounded-full text-sm font-semibold text-white backdrop-blur-sm transition-all shadow-md"
                                >
                                    <FileText className="w-4 h-4" />
                                    Edit Application
                                </Link>
                            )}

                            <p className="text-purple-100 text-lg mt-4">
                                Welcome to the Easy Sales Export Cooperative
                            </p>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="px-8 py-8">

                        {/* Under review notice */}
                        <div className="flex items-start gap-4 bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-8">
                            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
                                <Clock className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <p className="font-bold text-amber-900 mb-1">Your application is under review</p>
                                <p className="text-sm text-amber-700">
                                    Our team is reviewing your documents and membership details. This typically takes <strong>24–48 hours</strong>. You will be notified by email once a decision is made.
                                </p>
                            </div>
                        </div>

                        {/* Steps */}
                        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Review Process</h2>
                        <div className="space-y-4 mb-8">
                            <div className="flex items-start gap-4">
                                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-800">Application received</p>
                                    <p className="text-xs text-slate-500">Your membership form and documents have been submitted.</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4">
                                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                                    <ShieldCheck className="w-5 h-5 text-amber-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-800">Identity & document verification</p>
                                    <p className="text-xs text-slate-500">Our team verifies your ID, passport photo, and proof of address.</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4">
                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                    <Mail className="w-5 h-5 text-slate-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-500">Email notification</p>
                                    <p className="text-xs text-slate-400">You'll receive an approval email with your membership details.</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4">
                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                    <CheckCircle2 className="w-5 h-5 text-slate-300" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-slate-400">Full dashboard access granted</p>
                                    <p className="text-xs text-slate-400">Access savings, loans, and all cooperative benefits.</p>
                                </div>
                            </div>
                        </div>

                        {/* CTA */}
                        <div className="flex flex-col gap-3">
                            <Link
                                href={hubUrl}
                                className="w-full inline-flex items-center justify-center px-6 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-base transition-all shadow-lg shadow-purple-200"
                            >
                                Go to Dashboard
                            </Link>
                            <Link
                                href={prefix || "/"}
                                className="w-full inline-flex items-center justify-center px-6 py-3 text-slate-500 hover:text-slate-700 text-sm transition-colors"
                            >
                                Back to Cooperatives
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Footer note */}
                <p className="text-center text-xs text-purple-700/60 mt-4">
                    Questions? Contact us at{" "}
                    <a href="mailto:info@easysalesexport.com" className="underline">
                        info@easysalesexport.com
                    </a>
                </p>
            </div>
        </div>
    );
}
