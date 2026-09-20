/**
 * Cooperative Onboarding — Pending Status
 *
 *   THE DASHBOARD HAS LINKED HERE ALL ALONG AND THE ROUTE DID NOT EXIST.
 *
 *   dashboard/page.tsx builds a `pendingUrl` per module. Three of the four
 *   resolve; this one 404'd:
 *
 *       /export/onboarding/pending        exists
 *       /marketplace/onboarding/pending   exists
 *       /cooperatives/onboarding/pending  ← 404, the directory has
 *                                           `pending-payment` instead
 *       /farm-nation/onboarding/pending   exists
 *
 *   Observed in the production log, twice in thirty-two seconds from one
 *   phone, referred from /dashboard. Three of four is the one-of-N shape this
 *   codebase keeps producing.
 *
 *   IT IS NOT `pending-payment`, WHICH IS WHY THE DASHBOARD IS NOT SIMPLY
 *   REPOINTED. That screen tells a member they owe the registration fee. This
 *   state is "application submitted, awaiting review" — the same thing the
 *   other three `pending` screens mean. Sending a member who has already paid
 *   to a payment screen is the #715 shape: a page confidently telling somebody
 *   the wrong thing about their own money.
 *
 *   AND THE ALLOWLIST ENTRY IS HALF THE FIX — see my-data.ts.
 *
 *   #799 records what a pending screen does without one: every poll returns
 *   UNKNOWN, usePendingApplicationStatus sets `checkFailed` and returns early
 *   so a non-answer cannot overwrite a real status, `status` never leaves its
 *   initial "pending", and the effect that redirects on approval NEVER FIRES.
 *   An approved applicant then sits on "Application Under Review" for ever.
 *   That is what happened to export for the whole life of #415. Adding this
 *   page without the entry would have reproduced it for cooperatives.
 */

"use client";

import { useEffect } from "react";
import { Clock, CheckCircle2, ArrowLeft, Home } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { usePendingApplicationStatus } from "@/hooks/usePendingApplicationStatus";
import { StatusCheckNotice } from "@/components/application/StatusCheckNotice";
import { isDecidedAgainst } from "@/lib/registration-progress";
import { COLLECTIONS } from "@/lib/client-collections";
import { RegisterAnotherUserButton, FormHomeButton } from "@/components/forms/FormNavButtons";

export default function CooperativePendingPage() {
    const { data: session } = useSession();
    const router = useRouter();

    const { status: applicationStatus, checkFailed, sessionExpired } = usePendingApplicationStatus({
        collectionName: COLLECTIONS.USERS,
        userId: session?.user?.id,
        //   `cooperatives`, plural. Both spellings exist on this platform —
        //   schema-normalizer mirrors them as a pair — but every status
        //   transition writes the plural, so that is the one to read.
        statusField: "cooperatives",
    });

    useEffect(() => {
        if (applicationStatus === "approved" || applicationStatus === "active") {
            router.replace("/cooperatives/dashboard");
        } else if (applicationStatus === "revision_required") {
            /*
             *   ONLY revision_required RETURNS SOMEBODY TO THE FORM, and the
             *   difference from the sibling screens is deliberate.
             *
             *   They redirect on `rejected || revision_required`. Cooperative
             *   status carries `suspended` too, and registration-progress puts
             *   suspended in DECIDED_AGAINST alongside rejected. Sending a
             *   SUSPENDED member to /cooperatives/onboarding would offer them
             *   a fresh application — the reversal-for-the-price-of-the-fee
             *   shape this platform has met repeatedly, most recently in the
             *   module access layer.
             *
             *   revision_required is the one status that is an explicit
             *   invitation to resubmit. Everything else decided-against stays
             *   on this page and is told to contact support, which refuses
             *   more rather than less.
             */
            router.replace("/cooperatives/onboarding");
        }
    }, [applicationStatus, router]);

    const decidedAgainst = isDecidedAgainst(applicationStatus);

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="max-w-xl w-full">
                {/* #415 — the newest poll could not answer; say so. */}
                <StatusCheckNotice checkFailed={checkFailed} sessionExpired={sessionExpired} />
                <div className="bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100">
                    <div className="w-20 h-20 mx-auto mb-6 bg-emerald-100 rounded-full flex items-center justify-center">
                        <Clock className="w-10 h-10 text-emerald-600" />
                    </div>

                    <h1 className="text-2xl font-bold text-slate-900 mb-2">
                        {decidedAgainst ? "Membership Not Active" : "Application Under Review"}
                    </h1>

                    <p className="text-slate-600 mb-8">
                        {decidedAgainst
                            ? "Your cooperative membership is not currently active. Please contact the cooperative administrator if you believe this is a mistake."
                            : "Your cooperative membership application has been received. Our team is verifying your details."}
                    </p>

                    {!decidedAgainst && (
                        <div className="bg-slate-50 rounded-xl p-6 mb-8 text-left">
                            <h3 className="font-semibold text-slate-900 mb-4">What happens next?</h3>
                            <ul className="space-y-4">
                                <li className="flex gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                                    <span className="text-sm text-slate-600">
                                        Membership verification (24-48 hours)
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
                                        Savings, contributions and loans become available
                                    </span>
                                </li>
                            </ul>
                        </div>
                    )}

                    <div className="flex flex-col gap-3">
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center justify-center px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-semibold"
                        >
                            Return to Dashboard
                        </Link>
                        <Link
                            href="/cooperatives/landing"
                            className="inline-flex items-center justify-center gap-2 px-6 py-3 text-slate-600 hover:text-slate-900 transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Cooperatives
                        </Link>
                        {/*   #777 "Apply to another programme" — see
                          *   FormNavButtons for why it is not a second
                          *   application to the SAME programme. */}
                        <RegisterAnotherUserButton />
                        {/*   #781 A way home from the waiting screen. */}
                        <FormHomeButton />
                    </div>
                </div>
            </div>
        </div>
    );
}
