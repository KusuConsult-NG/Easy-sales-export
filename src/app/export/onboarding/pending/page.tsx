/**
 * Export Windows Onboarding - Pending Review
 *
 * Shown after onboarding submission while account is under review.
 * Real-time listener auto-redirects on revision_required or approval.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { Clock, Mail, CheckCircle2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";

export default function ExportOnboardingPendingPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const unsubRef = useRef<() => void>(undefined as any);

    const [applicationStatus, setApplicationStatus] = useState<string>("pending_approval");

    useEffect(() => {
        if (!session?.user?.id) return;

        // Listen on the user doc for export status changes
        const q = query(
            collection(db, "export_applications"),
            where("userId", "==", session.user.id)
        );

        const unsub = onSnapshot(q, (snap) => {
            if (snap.empty) return;
            
            // Sort to find the latest application in case of resubmissions
            const sortedDocs = snap.docs.sort((a, b) => {
                const aTime = a.data().createdAt?.toMillis?.() || 0;
                const bTime = b.data().createdAt?.toMillis?.() || 0;
                return bTime - aTime;
            });
            
            const status = sortedDocs[0].data().status;
            setApplicationStatus(status);

            if (status === "approved") {
                router.replace("/export/dashboard");
            } else if (status === "revision_required") {
                // Redirect back to the onboarding form — it will pre-populate
                router.replace("/export/onboarding");
            }
        }, () => { /* silently ignore listener errors */ });

        unsubRef.current = unsub;
        return () => { unsubRef.current?.(); };
    }, [session?.user?.id, router]);

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full">
                {/* Status Card */}
                <div className="bg-white rounded-2xl shadow-xl p-8 md:p-12 text-center">
                    {/* Icon */}
                    <div className="w-20 h-20 mx-auto mb-6 bg-orange-100 rounded-full flex items-center justify-center">
                        <Clock className="w-10 h-10 text-orange-600" />
                    </div>

                    {/* Title & Edit Button */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-4">
                        <h1 className="text-3xl font-bold text-slate-900">
                            Application Under Review
                        </h1>
                        {applicationStatus === "pending_approval" && (
                            <Link
                                href="/export/onboarding?edit=true"
                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200 rounded-full text-sm font-semibold transition-all"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" x2="8" y1="13" y2="13" /><line x1="16" x2="8" y1="17" y2="17" /><line x1="10" x2="8" y1="9" y2="9" /></svg>
                                Edit Application
                            </Link>
                        )}
                    </div>

                    {/* Description */}
                    <p className="text-lg text-slate-600 mb-8">
                        Thank you for completing your Export Windows onboarding! Your application is
                        currently being reviewed by our team.
                    </p>

                    {/* Timeline */}
                    <div className="bg-slate-50 rounded-lg p-6 mb-8">
                        <h3 className="font-semibold text-slate-900 mb-4">
                            What happens next?
                        </h3>
                        <div className="space-y-4 text-left">
                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shrink-0 mt-0.5">
                                    <CheckCircle2 className="w-4 h-4 text-white" />
                                </div>
                                <div>
                                    <p className="font-medium text-slate-900">Application Submitted</p>
                                    <p className="text-sm text-slate-600">Your documents and information have been received</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center shrink-0 mt-0.5">
                                    <Clock className="w-4 h-4 text-white" />
                                </div>
                                <div>
                                    <p className="font-medium text-slate-900">Verification in Progress</p>
                                    <p className="text-sm text-slate-600">Our team is reviewing your KYC documents (1-2 business days)</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="w-6 h-6 rounded-full bg-slate-300 flex items-center justify-center shrink-0 mt-0.5">
                                    <Mail className="w-4 h-4 text-white" />
                                </div>
                                <div>
                                    <p className="font-medium text-slate-600">Approval Notification</p>
                                    <p className="text-sm text-slate-600">You&apos;ll receive an email once your account is verified</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Info Banner */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
                        <p className="text-sm text-blue-900">
                            <strong>Estimated review time:</strong> 1-2 business days
                            <br />
                            You&apos;ll receive an email notification at your registered email address once
                            the review is complete.
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold"
                        >
                            Return to Dashboard
                        </Link>
                        <Link
                            href="/export"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 border-2 border-slate-300 text-slate-900 rounded-lg hover:bg-slate-100 transition-colors font-semibold"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Export Windows
                        </Link>
                    </div>
                </div>

                {/* Help Section */}
                <div className="mt-6 text-center text-slate-600 text-sm">
                    <p>
                        Need help?{" "}
                        <Link href="/support" className="text-orange-600 hover:underline">
                            Contact Support
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
