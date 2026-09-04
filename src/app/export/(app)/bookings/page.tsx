"use client";

/**
 *   #380 THE MEMBER COULD NOT SEE THEIR OWN BOOKING.
 *
 *        #311 measured export_bookings and found getUserBookingsAction — a
 *        correct, session-scoped reader of the member's own bookings — with
 *        ZERO CALLERS. So a member worked through the four-step wizard, had
 *        volume reserved in their name, and then had nowhere to see whether it
 *        was still pending.
 *
 *        That mattered more once the export team could act (this finding's
 *        other half): a confirmation or a cancellation has to land somewhere
 *        the member can look. The notification the decision sends points here,
 *        and a notification pointing at a route that does not exist is #51's
 *        defect — every escrow notification linked to a 404.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { logger } from "@/lib/logger";
import { getUserBookingsAction } from "@/app/actions/export-booking";
import { Container, Clock, CheckCircle, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type Booking = {
    id: string;
    exportWindowId: string;
    quantity: number;
    totalPrice: number;
    status: string;
    shippingTerms?: string;
    portOfOrigin?: string;
    vessel?: string;
};

export default function ExportBookingsPage() {
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        (async () => {
            try {
                const result = await getUserBookingsAction();
                if (!mounted) return;
                if (result.success && result.data) {
                    setBookings(result.data as Booking[]);
                } else {
                    // #307 — a failed list is not an empty one.
                    setError(result.error || "Could not load your bookings");
                }
            } catch (err: any) {
                logger.error("[export/bookings] load failed", err);
                if (mounted) setError("Could not reach the server. Please try again.");
            } finally {
                if (mounted) setLoading(false);
            }
        })();

        return () => { mounted = false; };
    }, []);

    return (
        <div className="p-6 space-y-6">
            <header className="flex items-center gap-3">
                <Container className="w-7 h-7 text-blue-600" />
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">My Export Bookings</h1>
                    <p className="text-sm text-slate-500">
                        A pending booking holds your slot. The export team confirms it once payment is
                        arranged &mdash; message them from Messages.
                    </p>
                </div>
            </header>

            {error && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span className="text-sm">{error}</span>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
            ) : bookings.length === 0 && !error ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                    <p className="text-slate-600 mb-4">You have not booked an export slot yet.</p>
                    <Link
                        href="/export/opportunities"
                        className="inline-flex px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl"
                    >
                        Browse opportunities
                    </Link>
                </div>
            ) : (
                <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                    {bookings.map((b) => (
                        <li key={b.id} className="px-6 py-5 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="font-semibold text-slate-900">
                                    {b.quantity}kg · {formatCurrency(Number(b.totalPrice ?? 0))}
                                </p>
                                {(b.shippingTerms || b.portOfOrigin || b.vessel) && (
                                    <p className="text-xs text-slate-400 mt-1 truncate">
                                        {[b.shippingTerms, b.portOfOrigin, b.vessel].filter(Boolean).join(" · ")}
                                    </p>
                                )}
                            </div>
                            <Status status={b.status} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function Status({ status }: { status: string }) {
    if (status === "confirmed") {
        return (
            <span className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" /> Confirmed
            </span>
        );
    }
    if (status === "cancelled") {
        return (
            <span className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> Cancelled
            </span>
        );
    }
    return (
        <span className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Pending
        </span>
    );
}
