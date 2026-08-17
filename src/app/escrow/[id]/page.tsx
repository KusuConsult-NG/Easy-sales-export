/**
 * A single escrow transaction.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * It did not, and eighteen notifications pointed at it.
 *
 * Every escrow lifecycle event — created, funded, release requested, released,
 * refunded, disputed, dispute resolved — sends both parties a notification whose
 * link is `/escrow/{escrowId}` with linkText "View Escrow". Across
 * _escrow_actions.ts, _escrow_disputes.ts and _escrow_lifecycle.ts that is
 * eighteen links, and `src/app/escrow/[id]/` had no page.tsx. The directory
 * existed, with `chat/` and `dispute/` children that both assume a parent.
 *
 * So every notification telling a buyer or a seller that their money had moved
 * led to a 404. A dead internal link is invisible to the type checker, to the
 * linter and to every test that does not click it, which is why a scanner now
 * looks for them (lib/testing/route-link-scan.ts).
 *
 * WHAT IT SHOWS AND WHAT IT DOES NOT
 * ----------------------------------
 * It reads. getEscrowTransactionByIdAction already existed and is already
 * guarded — participants or admins only — so this page adds no new access.
 *
 * It does NOT add release, refund or dispute-resolution controls. Those are
 * money-moving actions with their own guards, their own status claims and their
 * own audit rows, and the existing surfaces for them (the escrow dashboard, the
 * dispute page, the admin escrow screen) already work. Adding a fourth entry
 * point to a payout from a page written to fix a 404 would be building a feature
 * under cover of fixing a bug.
 *
 * The two things it does link to are the routes that already exist under this
 * one: the message thread and the dispute form.
 */

"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import {
    Shield,
    Loader2,
    MessageCircle,
    AlertTriangle,
    ArrowLeft,
    Package,
    Clock,
    Lock,
    Truck,
    CheckCircle,
    X,
    RotateCcw,
} from "lucide-react";
import { logger } from "@/lib/logger";
import { getEscrowTransactionByIdAction } from "@/app/actions/marketplace";
import { formatCurrency } from "@/lib/utils";
import { formatLocalDateTime } from "@/lib/date-utils";
import { normaliseEscrowStatus, type EscrowStatus } from "@/lib/escrow-status";

/**
 * How each status presents.
 *
 * Keyed on the shared vocabulary, so a status the application writes cannot fall
 * through to a default that misrepresents it — which is what the escrow
 * dashboard's stepper did for `released`, showing a paid-out transaction as
 * "Payment Pending".
 */
const STATUS_PRESENTATION: Record<EscrowStatus, {
    label: string;
    detail: string;
    icon: typeof Shield;
    tone: string;
}> = {
    pending: {
        label: "Awaiting payment",
        detail: "Nothing has been charged yet. The escrow holds no funds.",
        icon: Clock,
        tone: "bg-slate-100 text-slate-700 border-slate-200",
    },
    funded: {
        label: "Funds secured",
        detail: "The buyer's payment is held in escrow and has not been released.",
        icon: Lock,
        tone: "bg-blue-50 text-blue-700 border-blue-200",
    },
    in_transit: {
        label: "In transit",
        detail: "The goods are on their way. Funds remain held.",
        icon: Truck,
        tone: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
    delivered: {
        label: "Delivered",
        detail: "Receipt has been confirmed. Funds are held pending release.",
        icon: Package,
        tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    disputed: {
        label: "Under dispute",
        detail: "The funds are frozen while this is reviewed. Neither party can move them.",
        icon: AlertTriangle,
        tone: "bg-amber-50 text-amber-800 border-amber-200",
    },
    released: {
        label: "Released to seller",
        detail: "The funds have been paid out. This transaction is complete.",
        icon: CheckCircle,
        tone: "bg-green-50 text-green-700 border-green-200",
    },
    refunded: {
        label: "Refunded to buyer",
        detail: "The funds have been returned to the buyer.",
        icon: RotateCcw,
        tone: "bg-sky-50 text-sky-700 border-sky-200",
    },
    cancelled: {
        label: "Cancelled",
        detail: "This escrow was closed before it was funded.",
        icon: X,
        tone: "bg-red-50 text-red-700 border-red-200",
    },
};

interface EscrowDetail {
    id: string;
    status?: string;
    amount?: number;
    grossAmount?: number;
    productName?: string;
    productDescription?: string;
    buyerId?: string;
    sellerId?: string;
    buyerEmail?: string;
    sellerEmail?: string;
    orderId?: string;
    paymentReference?: string;
    disputeId?: string;
    createdAt?: any;
    paidAt?: any;
    releasedAt?: any;
    refundedAt?: any;
    disputedAt?: any;
}

export default function EscrowDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: escrowId } = use(params);

    const [escrow, setEscrow] = useState<EscrowDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getEscrowTransactionByIdAction(escrowId);
            if (result.success && result.data) {
                setEscrow(result.data as EscrowDetail);
            } else {
                // The action distinguishes "not found" from "not authorised", and
                // both are worth showing as themselves rather than as one message.
                setError(result.error || "This escrow could not be loaded.");
            }
        } catch (e) {
            logger.error("Failed to load escrow detail:", { escrowId, error: e });
            setError("An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    }, [escrowId]);

    useEffect(() => {
        load();
    }, [load]);

    const status = normaliseEscrowStatus(escrow?.status);
    const presentation = status ? STATUS_PRESENTATION[status] : null;
    const StatusIcon = presentation?.icon ?? Shield;

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-3xl mx-auto p-4 lg:p-8">
                <Link
                    href="/escrow"
                    className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-6"
                >
                    <ArrowLeft className="w-4 h-4" />
                    All escrow transactions
                </Link>

                {loading && (
                    <div className="flex items-center justify-center py-24 text-slate-500">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        Loading escrow...
                    </div>
                )}

                {!loading && error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-6">
                        <p className="font-semibold mb-1">Escrow unavailable</p>
                        <p className="text-sm">{error}</p>
                    </div>
                )}

                {!loading && !error && escrow && (
                    <>
                        <div className="mb-6">
                            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                                <Shield className="w-6 h-6 text-blue-600" />
                                Escrow
                            </h1>
                            <p className="text-slate-500 text-sm mt-1 font-mono">{escrow.id}</p>
                        </div>

                        <div className={`rounded-2xl border p-5 mb-6 ${presentation?.tone ?? "bg-slate-100 text-slate-700 border-slate-200"}`}>
                            <div className="flex items-start gap-3">
                                <StatusIcon className="w-6 h-6 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-semibold">
                                        {presentation?.label
                                            // A status outside the union is shown as
                                            // itself rather than mislabelled.
                                            ?? `Status: ${escrow.status ?? "unknown"}`}
                                    </p>
                                    <p className="text-sm mt-1 opacity-90">
                                        {presentation?.detail ?? "This status is not one the application recognises."}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
                            <h2 className="font-semibold text-slate-900 mb-4">What is held</h2>
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                <div>
                                    <dt className="text-slate-500">Amount in escrow</dt>
                                    <dd className="font-semibold text-slate-900 text-lg">
                                        {formatCurrency(Number(escrow.amount) || 0)}
                                    </dd>
                                </div>
                                {escrow.grossAmount != null && Number(escrow.grossAmount) !== Number(escrow.amount) && (
                                    <div>
                                        <dt className="text-slate-500">Buyer paid</dt>
                                        <dd className="font-semibold text-slate-900">
                                            {formatCurrency(Number(escrow.grossAmount) || 0)}
                                        </dd>
                                    </div>
                                )}
                                <div className="sm:col-span-2">
                                    <dt className="text-slate-500">Product</dt>
                                    <dd className="font-medium text-slate-900">{escrow.productName || "Not recorded"}</dd>
                                    {escrow.productDescription && (
                                        <dd className="text-slate-600 mt-1">{escrow.productDescription}</dd>
                                    )}
                                </div>
                                {escrow.orderId && (
                                    <div>
                                        <dt className="text-slate-500">Order</dt>
                                        <dd>
                                            <Link
                                                href={`/marketplace/orders/${escrow.orderId}`}
                                                className="text-blue-600 hover:underline font-mono text-xs"
                                            >
                                                {escrow.orderId}
                                            </Link>
                                        </dd>
                                    </div>
                                )}
                                {escrow.paymentReference && (
                                    <div>
                                        <dt className="text-slate-500">Payment reference</dt>
                                        <dd className="font-mono text-xs text-slate-700">{escrow.paymentReference}</dd>
                                    </div>
                                )}
                            </dl>
                        </div>

                        <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6">
                            <h2 className="font-semibold text-slate-900 mb-4">History</h2>
                            <ul className="space-y-2 text-sm">
                                {([
                                    ["Created", escrow.createdAt],
                                    ["Funded", escrow.paidAt],
                                    ["Disputed", escrow.disputedAt],
                                    ["Released", escrow.releasedAt],
                                    ["Refunded", escrow.refundedAt],
                                ] as Array<[string, any]>)
                                    // Only events that actually happened. An empty
                                    // row for every unreached state reads as though
                                    // something is missing.
                                    .filter(([, at]) => Boolean(at))
                                    .map(([label, at]) => (
                                        <li key={label} className="flex justify-between gap-4">
                                            <span className="text-slate-600">{label}</span>
                                            <span className="text-slate-900">{formatLocalDateTime(at)}</span>
                                        </li>
                                    ))}
                            </ul>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <Link
                                href={`/escrow/${escrow.id}/chat`}
                                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 inline-flex items-center gap-2"
                            >
                                <MessageCircle className="w-4 h-4" />
                                Messages
                            </Link>
                            {/*
                              * Offered only while a dispute could achieve something.
                              * On a released, refunded or cancelled escrow the money
                              * has gone, and the dispute form cannot claim a settled
                              * escrow — see ESCROW_FREEZABLE_STATUSES.
                              */}
                            {status && ["funded", "in_transit", "delivered"].includes(status) && (
                                <Link
                                    href={`/escrow/${escrow.id}/dispute`}
                                    className="px-4 py-2 rounded-xl bg-white border border-amber-300 text-amber-800 text-sm font-medium hover:bg-amber-50 inline-flex items-center gap-2"
                                >
                                    <AlertTriangle className="w-4 h-4" />
                                    Raise a dispute
                                </Link>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
