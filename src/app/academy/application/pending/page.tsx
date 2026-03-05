/**
 * Academy Application - Pending Status
 *
 * Shown after submitting Academy application.
 * Real-time listener auto-redirects on revision_required or approval.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { Clock, CheckCircle2, ArrowLeft, GraduationCap, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";

export default function AcademyPendingPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const unsubRef = useRef<() => void>(undefined as any);

    const [applicationStatus, setApplicationStatus] = useState<string>("pending");

    useEffect(() => {
        if (!session?.user?.id) return;

        const q = query(
            collection(db, "academy_applications"),
            where("userId", "==", session.user.id),
            limit(1)
        );

        const unsub = onSnapshot(q, (snap) => {
            if (snap.empty) return;
            const status = snap.docs[0].data().status;
            setApplicationStatus(status);

            if (status === "approved") {
                router.replace("/academy/dashboard");
            } else if (status === "revision_required") {
                // Redirect back to the application form — it will pre-populate
                router.replace("/academy/application");
            }
        }, () => { /* silently ignore listener errors */ });

        unsubRef.current = unsub;
        return () => { unsubRef.current?.(); };
    }, [session?.user?.id, router]);

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-xl w-full">
                <div className="bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100">
                    <div className="w-20 h-20 mx-auto mb-6 bg-blue-100 rounded-full flex items-center justify-center">
                        <Clock className="w-10 h-10 text-blue-600" />
                    </div>

                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        Application Under Review
                    </h1>

                    {applicationStatus === "pending" && (
                        <div className="my-4">
                            <Link
                                href="/academy/application?edit=true"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full text-sm font-semibold text-blue-700 transition-all shadow-sm mx-auto"
                            >
                                <FileText className="w-4 h-4" />
                                Edit Application
                            </Link>
                        </div>
                    )}

                    <p className="text-slate-600 mb-8">
                        Your Academy learner application has been received. We are verifying your profile.
                    </p>

                    <div className="bg-slate-50 rounded-xl p-6 mb-8 text-left">
                        <h3 className="font-semibold text-slate-900 mb-4">What happens next?</h3>
                        <ul className="space-y-4">
                            <li className="flex gap-3">
                                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                <span className="text-sm text-slate-600">
                                    Profile verification (24-48 hours)
                                </span>
                            </li>
                            <li className="flex gap-3">
                                <CheckCircle2 className="w-5 h-5 text-slate-300 shrink-0" />
                                <span className="text-sm text-slate-600">
                                    You receive an email notification upon approval
                                </span>
                            </li>
                            <li className="flex gap-3">
                                <GraduationCap className="w-5 h-5 text-slate-300 shrink-0" />
                                <span className="text-sm text-slate-600">
                                    Full access to start your learning journey
                                </span>
                            </li>
                        </ul>
                    </div>

                    <div className="flex flex-col gap-3">
                        <Link
                            href="/academy"
                            className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
                        >
                            Return to Academy
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 text-slate-600 hover:text-slate-900 transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Return to Main Dashboard
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
