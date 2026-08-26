/**
 * Pending Payment
 * 
 * Waiting for manual payment verification
 */

"use client";

import { Suspense } from "react";
import { Clock, Upload, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { COMPANY_INFO, COOPERATIVE_CONFIG, CURRENCY_CONFIG } from "@/lib/constants";

function PendingPaymentContent() {
    const searchParams = useSearchParams();

    /**
     *   #293 THE REFERENCE WAS INVENTED IN THE BROWSER, AND THE PAGE TOLD THE
     *        MEMBER TO PUT IT ON A BANK TRANSFER.
     *
     *            searchParams.get("ref") ||
     *                "COOP-PAY-" + Math.random().toString(36)...
     *
     *        With no `?ref=` — which is how this page is reached, since nothing
     *        in the application links to it — every visit produced a fresh
     *        random string, displayed under "Reference (Use this as
     *        narration)". It matches no payment, no membership and no row: the
     *        server has never seen it and never will. Two visits produce two
     *        different "references" for the same person.
     *
     *        wallet-ledger.ts states the rule this breaks in as many words: a
     *        reference that varies per attempt is not an idempotency key. #286
     *        is the same principle on the repayment path.
     *
     *        Now: null when there is no real reference, and the page says so
     *        rather than inventing one.
     */
    const paymentReference = searchParams.get("ref");
    const amount = parseInt(searchParams.get("amount") || COOPERATIVE_CONFIG.registrationFee.toString(), 10);
    const tier = "Member";

    const isDedicatedCoop = typeof window !== "undefined" && (
        window.location.hostname.replace(/^www\./, "").toLowerCase() === "easysalescooperative.com" ||
        window.location.hostname.replace(/^www\./, "").toLowerCase().endsWith(".easysalescooperative.com")
    );
    const prefix = isDedicatedCoop ? "" : "/cooperatives";

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <Link
                    href={prefix || "/"}
                    className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 mb-8"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Cooperatives
                </Link>

                {/* Status Icon */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-24 h-24 bg-orange-100 rounded-full mb-6">
                        <Clock className="w-12 h-12 text-orange-600" />
                    </div>
                    <h1 className="text-4xl font-bold text-slate-900 mb-3">
                        Payment Pending
                    </h1>
                    <p className="text-xl text-slate-600">
                        We're waiting to verify your payment
                    </p>
                </div>

                {/* Payment Details */}
                <div className="bg-white rounded-2xl border border-slate-200 p-8 mb-6">
                    <h2 className="font-bold text-lg text-slate-900 mb-6">
                        Payment Summary
                    </h2>
                    <div className="space-y-3 mb-6">
                        <div className="flex justify-between py-2 border-b border-slate-200">
                            <span className="text-slate-600">Payment Reference:</span>
                            {/* #293. Absent rather than invented. */}
                            <span className="font-mono font-semibold text-slate-900">
                                {paymentReference || "—"}
                            </span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-slate-200">
                            <span className="text-slate-600">Membership Tier:</span>
                            <span className="font-semibold text-purple-600">{tier}</span>
                        </div>
                        <div className="flex justify-between py-2">
                            <span className="text-slate-600">Amount:</span>
                            <span className="text-2xl font-bold text-slate-900">{CURRENCY_CONFIG.symbol}{amount.toLocaleString()}</span>
                        </div>
                    </div>

                    {/*
                      *   #293 THE PAGE CONTRADICTED ITSELF ABOUT HOW TO PAY,
                      *        AND I BUILT THE CONTRADICTION.
                      *
                      *        This block used to give hardcoded bank transfer
                      *        details —
                      *
                      *            First Bank of Nigeria
                      *            2015678942
                      *            Easy Sales Export Cooperative
                      *            Reference (Use this as narration): <random>
                      *
                      *        — directly above the panel below, which says
                      *        "Verification Is Automatic ... confirmed with
                      *        Paystack directly — there is nothing you need to
                      *        send us."
                      *
                      *        Both cannot be true, and the Paystack half is the
                      *        one the product agrees with: the landing page,
                      *        the loans page, the fixed-savings page and the ID
                      *        card page all say the registration fee is paid
                      *        via Paystack, and /cooperatives/payment is the
                      *        screen that does it. Nothing anywhere else in
                      *        this repository mentions that account number —
                      *        it appears on this page and nowhere else, so it
                      *        is either a placeholder or an account no other
                      *        code can reconcile against.
                      *
                      *        MY OWN EARLIER FIX MADE IT WORSE. The Paystack
                      *        panel below is the replacement I wrote for a dead
                      *        "Upload Receipt" button. I corrected the half I
                      *        was looking at and left this half standing, which
                      *        is #283's shape — the copy somebody remembered
                      *        and the copy added later — committed by me.
                      *
                      *        Removed rather than corrected: publishing bank
                      *        details is a decision about where money goes, and
                      *        guessing the right account is not an audit's call.
                      *        If manual transfer is meant to exist, the account
                      *        belongs in configuration with the rest of the
                      *        payment settings, not in a component.
                      */}

                    {/* Upload Proof */}
                    <div className="border-2 border-dashed border-purple-300 rounded-xl p-6 text-center bg-purple-50">
                        {/*
                          * This was an "Upload Receipt" button with no onClick,
                          * under the promise "Upload your payment receipt to
                          * speed up verification". There is no receipt upload
                          * anywhere in the platform — no endpoint, no handler,
                          * no field on the membership. A member waiting on
                          * their payment was told the one thing they could do
                          * to help, given a button for it, and clicking it did
                          * nothing at all.
                          *
                          * Replaced with what actually happens. Building a
                          * receipt upload is a feature; removing a control that
                          * lies about one is the fix.
                          */}
                        <Upload className="w-12 h-12 text-purple-600 mx-auto mb-3" />
                        <h3 className="font-bold text-slate-900 mb-2">
                            Verification Is Automatic
                        </h3>
                        <p className="text-sm text-slate-600">
                            Your payment is confirmed with Paystack directly — there is nothing
                            you need to send us. If it has not cleared within a few minutes,
                            contact support with your payment reference.
                        </p>
                    </div>
                </div>

                {/* Timeline */}
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 mb-6">
                    <h3 className="font-bold text-blue-900 mb-4">
                        What Happens Next?
                    </h3>
                    <div className="space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                1
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900">Make Transfer</p>
                                <p className="text-sm text-blue-800">
                                    Transfer {CURRENCY_CONFIG.symbol}{amount.toLocaleString()} to the account above using the reference number
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                2
                            </div>
                            <div>
                                {/*
                                  * The same promise a second time — "Upload
                                  * proof of payment to speed up verification"
                                  * as step 2 of what happens next. There is no
                                  * receipt upload in the platform, so this step
                                  * described something the member could not do
                                  * and nobody was waiting for.
                                  */}
                                <p className="font-semibold text-blue-900">Automatic Confirmation</p>
                                <p className="text-sm text-blue-800">
                                    Paystack tells us the moment your payment clears — you do not
                                    need to send us anything
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                3
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900">Verification</p>
                                <p className="text-sm text-blue-800">
                                    We'll verify your payment within 24-48 hours
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 font-bold">
                                4
                            </div>
                            <div>
                                <p className="font-semibold text-blue-900">Activation</p>
                                <p className="text-sm text-blue-800">
                                    Your membership will be activated and you'll receive a confirmation email
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Support */}
                <div className="bg-slate-100 rounded-2xl p-6 text-center">
                    <p className="text-slate-600 mb-3">
                        Need help with your payment?
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-4">
                        <a href={`mailto:${COMPANY_INFO.contact.general.email}`} className="text-purple-600 hover:text-purple-700 font-semibold">
                            {COMPANY_INFO.contact.general.email}
                        </a>
                        <span className="text-slate-400">•</span>
                        <a href={`tel:${COMPANY_INFO.contact.general.phone}`} className="text-purple-600 hover:text-purple-700 font-semibold">
                            {COMPANY_INFO.contact.general.phone}
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function PendingPaymentPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            </div>
        }>
            <PendingPaymentContent />
        </Suspense>
    );
}
