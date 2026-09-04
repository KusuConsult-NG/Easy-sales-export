"use client";

/**
 *   #380 THE SCREEN THE EXPORT TEAM DID NOT HAVE.
 *
 *        A booking reserves volume against a window and is created `pending`.
 *        Nothing ever wrote that status again, so the capacity was consumed by
 *        bookings nobody could confirm or cancel, and the next member was
 *        refused "Only 0kg available" for slots that were never taken up.
 *
 *        The wizard tells the member to message the export team to arrange
 *        payment (#311 corrected that copy from a promise of an email nothing
 *        sends). This is where the team acts on the answer.
 *
 *        Cancelling RELEASES the reserved volume — see decideExportBookingAction
 *        in actions/export-booking.ts, where the release deliberately sits
 *        beside the reserve.
 */

import { useEffect, useState } from "react";
import { logger } from "@/lib/logger";
import {
    getExportBookingsForAdminAction,
    decideExportBookingAction,
} from "@/app/actions/export-booking";
import { Container, CheckCircle, XCircle, Clock, AlertCircle, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type Booking = {
    id: string;
    userId: string;
    exportWindowId: string;
    quantity: number;
    totalPrice: number;
    status: string;
    windowTitle: string;
    windowCommodity: string;
    memberName: string;
    memberEmail: string;
    memberPhone: string;
    shippingTerms?: string;
    portOfOrigin?: string;
    vessel?: string;
    moisturePercent?: number;
    foreignMatterPercent?: number;
    hasPhytosanitaryCertificate?: boolean;
};

export default function AdminExportBookingsPage() {
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deciding, setDeciding] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, []);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const result = await getExportBookingsForAdminAction();
            if (result.success && result.data) {
                setBookings(result.data as Booking[]);
            } else {
                // #307's class: a failed list must not render as an empty one.
                setError(result.error || "Could not load export bookings");
            }
        } catch (err: any) {
            logger.error("[admin/export/bookings] load failed", err);
            setError("Could not reach the server. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    async function decide(bookingId: string, decision: "confirmed" | "cancelled") {
        setDeciding(bookingId);
        setNotice(null);
        try {
            const result = await decideExportBookingAction(bookingId, decision);
            if (result.success) {
                setNotice(
                    decision === "confirmed"
                        ? "Booking confirmed. The member has been notified."
                        : "Booking cancelled and the slot released back to the window.",
                );
                await load();
            } else {
                // Shown verbatim: the cancelled-but-not-released case names the
                // window an operator has to correct, and summarising it away
                // would lose the only instruction that matters.
                setError(result.error || "Could not update this booking");
            }
        } catch (err: any) {
            logger.error("[admin/export/bookings] decision failed", err);
            setError("Could not reach the server. Please try again.");
        } finally {
            setDeciding(null);
        }
    }

    const pending = bookings.filter((b) => b.status === "pending");
    const decided = bookings.filter((b) => b.status !== "pending");

    return (
        <div className="p-6 space-y-6">
            <header className="flex items-center gap-3">
                <Container className="w-7 h-7 text-blue-600" />
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Export Bookings</h1>
                    <p className="text-sm text-slate-500">
                        A pending booking holds its volume against the window. Confirm it once payment
                        is arranged, or cancel it to give the slot back.
                    </p>
                </div>
            </header>

            {error && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span className="text-sm">{error}</span>
                </div>
            )}

            {notice && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm">
                    {notice}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
            ) : (
                <>
                    <Section
                        title={`Awaiting a decision (${pending.length})`}
                        empty="No bookings are waiting."
                        bookings={pending}
                        deciding={deciding}
                        onDecide={decide}
                    />
                    <Section
                        title={`Decided (${decided.length})`}
                        empty="Nothing decided yet."
                        bookings={decided}
                        deciding={deciding}
                        onDecide={decide}
                    />
                </>
            )}
        </div>
    );
}

function Section({
    title, empty, bookings, deciding, onDecide,
}: {
    title: string;
    empty: string;
    bookings: Booking[];
    deciding: string | null;
    onDecide: (id: string, decision: "confirmed" | "cancelled") => void;
}) {
    return (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <h2 className="px-6 py-4 font-semibold text-slate-900 border-b border-slate-200">{title}</h2>
            {bookings.length === 0 ? (
                <p className="px-6 py-8 text-sm text-slate-500">{empty}</p>
            ) : (
                <ul className="divide-y divide-slate-100">
                    {bookings.map((b) => (
                        <li key={b.id} className="px-6 py-5 flex flex-col lg:flex-row lg:items-center gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <StatusPill status={b.status} />
                                    <span className="font-semibold text-slate-900 truncate">
                                        {b.windowTitle}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-600">
                                    {b.quantity}kg · {formatCurrency(Number(b.totalPrice ?? 0))}
                                    {b.windowCommodity ? ` · ${b.windowCommodity}` : ""}
                                </p>
                                <p className="text-sm text-slate-500 mt-1">
                                    {b.memberName || "(no name recorded)"}
                                    {b.memberEmail ? ` · ${b.memberEmail}` : ""}
                                    {b.memberPhone ? ` · ${b.memberPhone}` : ""}
                                </p>
                                {(b.portOfOrigin || b.vessel || b.shippingTerms) && (
                                    <p className="text-xs text-slate-400 mt-1">
                                        {[b.shippingTerms, b.portOfOrigin, b.vessel].filter(Boolean).join(" · ")}
                                    </p>
                                )}
                            </div>

                            {b.status === "pending" && (
                                <div className="flex gap-2 shrink-0">
                                    <button
                                        onClick={() => onDecide(b.id, "confirmed")}
                                        disabled={deciding === b.id}
                                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-semibold rounded-xl flex items-center gap-2"
                                    >
                                        <CheckCircle className="w-4 h-4" /> Confirm
                                    </button>
                                    <button
                                        onClick={() => onDecide(b.id, "cancelled")}
                                        disabled={deciding === b.id}
                                        className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-semibold rounded-xl flex items-center gap-2"
                                    >
                                        <XCircle className="w-4 h-4" /> Cancel &amp; release
                                    </button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function StatusPill({ status }: { status: string }) {
    const style = status === "confirmed"
        ? "bg-emerald-100 text-emerald-800"
        : status === "cancelled"
            ? "bg-slate-100 text-slate-600"
            : "bg-amber-100 text-amber-800";

    return (
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${style}`}>
            {status === "pending" && <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />}
            {status}
        </span>
    );
}
