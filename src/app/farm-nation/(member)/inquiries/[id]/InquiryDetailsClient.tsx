"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    ArrowLeft, Loader2, User, Phone, Mail, MessageSquare, ExternalLink, Calendar
} from "lucide-react";
import { getLandInquiryByIdAction, replyToLandInquiryAction } from "@/app/actions/land-listings";
import { useToast } from "@/contexts/ToastContext";
import { logger } from "@/lib/logger";
import Link from "next/link";
import { formatDateTimeOrDash } from "@/lib/date-utils";

export default function InquiryDetailsClient({ initial = null }: {
    /**  #548 The inquiry the server already fetched. */
    initial?: any | null;
}) {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    const inquiryId = params.id as string;

    const [inquiry, setInquiry] = useState<any>(initial);
    const [loading, setLoading] = useState(initial === null);
    const [error, setError] = useState<string | null>(null);

    /**
     *   #872 THE REPLY THIS SCREEN NEVER HAD.
     *
     *   THE OWNER: "how does my inquiries work because i believe its not well
     *   wired." It was a list she could read and nothing else — no reply, no
     *   status change, no record that she had answered. Every inquiry sat at
     *   "pending" for ever and the only way to respond was to copy an address
     *   out of the page and leave the platform.
     */
    const { showToast } = useToast();
    const [reply, setReply] = useState("");
    const [sending, setSending] = useState(false);

    async function handleReply() {
        if (!reply.trim()) return;
        setSending(true);

        /*
         *   THE try/finally IS NOT DECORATION, and two ratchets caught its
         *   absence in the first version of this handler.
         *
         *   #407 counts an `await` with no try at all: a server action that
         *   THROWS rather than returning a refusal — a dropped connection is
         *   enough — would skip `setSending(false)` and leave the button
         *   disabled on "Sending…" for ever, with nothing on screen to say why.
         *
         *   #512's D1 counts a result whose `error` is never read. The refresh
         *   below had `if (fresh?.success && fresh.data)` and discarded the
         *   reason when it did not, which is how "the reply sent but the page
         *   did not update" becomes unexplainable.
         */
        try {
            const result = await replyToLandInquiryAction(inquiryId, reply.trim());

            if (!result?.success) {
                //   The action's own message, not a generic one: it
                //   distinguishes "no email address on this inquiry" from "the
                //   send failed", and only the first is something she can act
                //   on.
                showToast(result?.error || "The reply could not be sent", "error");
                return;
            }

            showToast("Reply sent", "success");
            setReply("");

            //   Re-read rather than patch locally, so the recorded reply and
            //   the status come from the server that wrote them. A failure here
            //   is NOT a failed reply — the reply is sent and recorded — so it
            //   says exactly that rather than implying the send went wrong.
            const fresh = await getLandInquiryByIdAction(inquiryId);
            if (fresh?.success && fresh.data) {
                setInquiry(fresh.data);
            } else if (fresh?.error) {
                showToast(`Reply sent. The page could not refresh: ${fresh.error}`, "error");
            }
        } catch (err) {
            logger.error("[InquiryDetails] reply failed", err);
            showToast("The reply could not be sent. Please try again.", "error");
        } finally {
            setSending(false);
        }
    }

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login?callbackUrl=/farm-nation");
            return;
        }

        //   #548 Already supplied by the server. A refusal passes null and
        //   this still runs, so "Inquiry not found" keeps saying itself.
        if (initial !== null) return;

        async function loadInquiry() {
            if (session?.user?.id) {
                const result = await getLandInquiryByIdAction(inquiryId);
                if (result.success && result.data) {
                    setInquiry(result.data);
                } else {
                    setError(result.error || "Inquiry not found");
                }
                setLoading(false);
            }
        }

        if (status === "authenticated") {
            loadInquiry();
        }
    }, [status, session?.user?.id, inquiryId, router, initial]);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-green-600" />
            </div>
        );
    }

    if (error || !inquiry) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
                <div className="max-w-md text-center">
                    <p className="text-red-500 mb-4">{error || "Inquiry not found"}</p>
                    <button
                        onClick={() => router.push("/farm-nation/inquiries")}
                        className="px-6 py-2 bg-slate-200 rounded-lg hover:bg-slate-300 transition"
                    >
                        Back to Inquiries
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <button
                        onClick={() => router.push("/farm-nation/inquiries")}
                        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition mb-4"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        Back to Inquiries
                    </button>
                    <h1 className="text-3xl font-bold text-slate-900">
                        Inquiry Details
                    </h1>
                </div>

                {/* Content Card */}
                <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
                    <div className="p-8 space-y-8">
                        {/* Listing Info */}
                        <div className="flex items-start justify-between border-b border-slate-200 pb-6">
                            <div>
                                <p className="text-sm text-slate-500 mb-1">Inquiry for Property</p>
                                <h2 className="text-xl font-bold text-slate-900">
                                    {inquiry.listingTitle}
                                </h2>
                            </div>
                            <Link
                                href={`/farm-nation/property/${inquiry.listingId}`}
                                className="flex items-center gap-2 text-green-600 hover:text-green-700 font-medium"
                                target="_blank"
                            >
                                View Listing <ExternalLink className="w-4 h-4" />
                            </Link>
                        </div>

                        {/* Buyer Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-50 rounded-full">
                                    <User className="w-6 h-6 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">Buyer Name</p>
                                    <p className="font-semibold text-slate-900">{inquiry.buyerName}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-purple-50 rounded-full">
                                    <Calendar className="w-6 h-6 text-purple-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">Date Received</p>
                                    <p className="font-semibold text-slate-900">
                                        {/*
                                          *   #605 — THIS ALWAYS SAID "N/A".
                                          *
                                          *   `getLandInquiryByIdAction` returns
                                          *   `serializeValue(doc.data())`, which converts
                                          *   every Timestamp to an ISO STRING before it
                                          *   crosses to the client. An ISO string has no
                                          *   `.seconds`, so the test above was false for
                                          *   every inquiry that has ever loaded, and the
                                          *   date received — which the buyer and the
                                          *   landowner both quote at each other — was
                                          *   never shown at all.
                                          *
                                          *   The identical wrong assumption is already
                                          *   commented as fixed in
                                          *   SellerDashboardClient's comparator: "orders
                                          *   arrive from a server action, so createdAt is
                                          *   already an ISO string — reading .seconds off
                                          *   it gave NaN". THE FIX REACHED ONE OF THE
                                          *   DOORS.
                                          */}
                                        {formatDateTimeOrDash(inquiry.createdAt, 'N/A')}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-emerald-50 rounded-full">
                                    <Mail className="w-6 h-6 text-emerald-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">Email Address</p>
                                    <a href={`mailto:${inquiry.buyerEmail}`} className="font-semibold text-green-600 hover:text-green-700">
                                        {inquiry.buyerEmail}
                                    </a>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-amber-50 rounded-full">
                                    <Phone className="w-6 h-6 text-amber-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-slate-500">Phone Number</p>
                                    <a href={`tel:${inquiry.buyerPhone}`} className="font-semibold text-slate-900 hover:text-blue-600">
                                        {inquiry.buyerPhone}
                                    </a>
                                </div>
                            </div>
                        </div>

                        {/* Message */}
                        <div className="bg-slate-50 rounded-xl p-6">
                            <div className="flex items-center gap-2 mb-4 text-slate-900 font-semibold">
                                <MessageSquare className="w-5 h-5 text-slate-500" />
                                Message
                            </div>
                            <p className="text-slate-600 whitespace-pre-line leading-relaxed">
                                {inquiry.message}
                            </p>
                        </div>

                        {/*
                          *   #872 WHAT SHE HAS ALREADY SAID.
                          *
                          *   An owner who answers and cannot see that she answered
                          *   will answer again. The whole exchange, not just the
                          *   last line.
                          */}
                        {Array.isArray(inquiry.replies) && inquiry.replies.length > 0 && (
                            <div className="bg-green-50 rounded-xl p-6 mt-6">
                                <div className="flex items-center gap-2 mb-4 text-slate-900 font-semibold">
                                    <MessageSquare className="w-5 h-5 text-green-600" />
                                    Your replies
                                </div>
                                <div className="space-y-4">
                                    {inquiry.replies.map((r: any, i: number) => (
                                        <div key={i}>
                                            <p className="text-slate-700 whitespace-pre-line leading-relaxed">
                                                {r.message}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-1">
                                                {formatDateTimeOrDash(r.repliedAt)}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/*
                          *   The reply itself. It goes by EMAIL, and the screen says
                          *   so — the intake is public, so an enquirer may have no
                          *   account here at all and there is no in-app thread to
                          *   open with them.
                          */}
                        <div className="bg-white border border-slate-200 rounded-xl p-6 mt-6">
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Reply to {inquiry.buyerName || "this enquirer"}
                            </label>
                            <textarea
                                value={reply}
                                onChange={(e) => setReply(e.target.value)}
                                rows={4}
                                placeholder="Answer their question, or tell them when you can show the land…"
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                            />
                            <p className="text-xs text-slate-500 mt-2">
                                Sent to {inquiry.buyerEmail || "their email address"}. They can reply
                                to you directly.
                            </p>
                            <button
                                type="button"
                                onClick={handleReply}
                                disabled={sending || !reply.trim()}
                                className="mt-3 w-full px-6 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
                            >
                                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mail className="w-5 h-5" />}
                                {sending ? "Sending…" : "Send reply"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
