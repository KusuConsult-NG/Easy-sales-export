/**
 * Farm Nation Onboarding - Pending Status
 * 
 * Shown after submitting Farm Nation application
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { Clock, CheckCircle2, ArrowLeft, Home, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, limit, doc } from "firebase/firestore";

export default function FarmNationPendingPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const unsubRef = useRef<() => void>(undefined as any);

    const [applicationStatus, setApplicationStatus] = useState<string>("pending");

    useEffect(() => {
        if (!session?.user?.id) return;

        // Listen on the user doc for farmNation status changes
        const docRef = doc(db, "users", session.user.id);
        const unsub = onSnapshot(docRef, (snap) => {
            if (!snap.exists()) return;
            const userData = snap.data();
            const status = userData?.serviceRegistrations?.farmNation?.status;

            if (status) {
                setApplicationStatus(status);

                if (status === "approved" || status === "active") {
                    router.replace("/farm-nation"); // Or dashboard
                } else if (status === "rejected" || status === "revision_required") {
                    router.replace("/farm-nation/onboarding");
                }
            }
        }, () => { /* silently ignore listener errors */ });

        unsubRef.current = unsub;
        return () => { unsubRef.current?.(); };
    }, [session?.user?.id, router]);

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-xl w-full">
                <div className="bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100">
                    <div className="w-20 h-20 mx-auto mb-6 bg-teal-100 rounded-full flex items-center justify-center">
                        <Clock className="w-10 h-10 text-teal-600" />
                    </div>

                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        Application Under Review
                    </h1>

                    {applicationStatus === "pending" && (
                        <div className="my-4">
                            <Link
                                href="/farm-nation/onboarding?edit=true"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-full text-sm font-semibold text-teal-700 transition-all shadow-sm mx-auto"
                            >
                                <FileText className="w-4 h-4" />
                                Edit Application
                            </Link>
                        </div>
                    )}

                    <p className="text-slate-600 mb-8">
                        Your Farm Nation onboarding application has been received. Our team is verifying your profile details.
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
                                <Home className="w-5 h-5 text-slate-300 shrink-0" />
                                <span className="text-sm text-slate-600">
                                    Full access to browse or list properties is granted
                                </span>
                            </li>
                        </ul>
                    </div>

                    <div className="flex flex-col gap-3">
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center justify-center px-6 py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors font-semibold"
                        >
                            Return to Dashboard
                        </Link>
                        <Link
                            href="/farm-nation"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 text-slate-600 hover:text-slate-900 transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Farm Nation
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
