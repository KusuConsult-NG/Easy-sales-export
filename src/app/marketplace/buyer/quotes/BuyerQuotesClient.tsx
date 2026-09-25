/**
 * Quote requests the signed-in buyer has raised.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * It did not, and the feature behaved as though it did. QuoteRequestModal
 * submits an RFQ, the buyer is shown "Quote request submitted successfully",
 * and _submitQuoteRequestAction called `revalidatePath("/marketplace/buyer/
 * quotes")` — a route with no page. getMyQuotesAction("buyer") existed and had
 * no caller anywhere in the app. So a quote was written to the database and the
 * buyer had no way to see that it existed, let alone what came of it.
 *
 * WHAT IT SHOWS NOW
 * -----------------
 *   #873 This header used to read "There is no seller-response flow in this
 *   codebase — nothing writes a quoted price, a rejection, or anything else onto
 *   a quote after it is created. Every quote is therefore 'pending'." That was
 *   true, and it was the finding: inventing the flow while fixing the missing
 *   page would have been building a feature under cover of fixing a bug.
 *
 *   The flow exists now, asked for directly. A seller accepts, counters or
 *   declines; a buyer answers a counter; and an agreed price is what the
 *   checkout charges — derived on the server from the quote row, never from
 *   this screen. All this page sends is the quote's id.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FileText, Loader2, Package, Clock, Container, Check, X, Tag, ShoppingCart } from "lucide-react";
import { logger } from "@/lib/logger";
import { getMyQuotesAction, settleQuoteCounterAction } from "@/app/actions/marketplace";
import { formatLocalDate } from "@/lib/date-utils";
import BackButton from "@/components/ui/BackButton";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useToast } from "@/contexts/ToastContext";

interface QuoteRow {
    id: string;
    productId?: string;
    productName?: string;
    subjectType?: "product" | "export_window";
    quantity?: number;
    unit?: string;
    notes?: string;
    preferredDeliveryDate?: string;
    status?: string;
    createdAt?: any;
    //   #873
    offeredPrice?: number;
    listedPrice?: number;
    counterPrice?: number;
    agreedPrice?: number;
    sellerMessage?: string;
    acceptedAt?: string;
    consumedByOrderId?: string;
}

const naira = (n: unknown) => `₦${Number(n || 0).toLocaleString()}`;

export default function BuyerQuotesClient({ initial = null }: {
    /**
     *   #551 The quotes the server already fetched.
     *
     *   `load` stays: this screen refreshes itself after accepting or
     *   rejecting a quote, so the read is still needed — just not first.
     */
    initial?: QuoteRow[] | null;
}) {
    const router = useRouter();
    const { data: session } = useSession();
    const { showToast } = useToast();
    const [loading, setLoading] = useState(initial === null);
    const [quotes, setQuotes] = useState<QuoteRow[]>(initial ?? []);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getMyQuotesAction("buyer");
            if (result.success && result.data?.quotes) {
                setQuotes(result.data.quotes as QuoteRow[]);
            } else {
                setError(result.error || "Failed to load your quote requests.");
            }
        } catch (e) {
            logger.error("Failed to load buyer quotes:", { error: e });
            setError("An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        //   #551 Already supplied by the server.
        if (initial !== null) return;
        load();
    }, [load, initial]);

    /** #873 Answer the seller's counter offer. */
    const settle = useCallback(async (quoteId: string, decision: "accept" | "decline") => {
        setBusy(quoteId);
        try {
            const result = await settleQuoteCounterAction(quoteId, decision);
            if (!result.success) {
                showToast(result.error || "Could not record your answer.", "error");
                return;
            }
            showToast(
                decision === "accept"
                    ? "Price agreed. You can check out at that price."
                    : "Offer declined.",
                "success",
            );
            await load();
        } catch (e) {
            logger.error("Failed to settle quote counter:", { error: e });
            showToast("An unexpected error occurred.", "error");
        } finally {
            setBusy(null);
        }
    }, [load, showToast]);

    /**
     *   #873 Put an agreed line in the cart and go and pay for it.
     *
     *   THE ONLY THING THIS WRITES IS THE QUOTE'S ID. Not the price — the cart
     *   lives in localStorage, which anybody can edit, so a price written here
     *   would be a price the buyer chose. `agreedPrice` rides along for the
     *   checkout to DISPLAY, and validateCartItems reads the quote server-side
     *   and derives the charge from the seller's own figure.
     *
     *   The quantity is the agreed one and the checkout will not let it be
     *   changed: a volume price is cheap because of the volume.
     */
    const checkout = useCallback((q: QuoteRow) => {
        try {
            const userId = (session?.user as any)?.id;
            const cartKey = userId ? `marketplace_cart_${userId}` : "marketplace_cart";
            const saved = localStorage.getItem(cartKey);
            const cart: any[] = saved ? JSON.parse(saved) : [];

            //   Replace any existing line for this product: a negotiated line
            //   and an ordinary one for the same item would be two prices for
            //   one product in one cart.
            const without = cart.filter((line) => line?.id !== q.productId);
            without.push({
                id: q.productId,
                title: q.productName || "Agreed item",
                unit: q.unit || "unit",
                quantity: Number(q.quantity) || 1,
                quoteId: q.id,
                agreedPrice: Number(q.agreedPrice) || 0,
                pricingTiers: [{ type: "retail", price: Number(q.listedPrice) || 0 }],
            });

            localStorage.setItem(cartKey, JSON.stringify(without));
            router.push("/marketplace/checkout");
        } catch (e) {
            //   Private mode, blocked storage, a full quota. The buyer is told
            //   rather than silently sent to an empty checkout.
            logger.error("Failed to put an agreed quote in the cart:", { error: e });
            showToast("Your browser would not store the cart. Check your privacy settings.", "error");
        }
    }, [router, session, showToast]);

    return (
        <div className="max-w-5xl mx-auto p-4 lg:p-8">
            <BackButton fallbackPath="/marketplace/buyer/dashboard" />

            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-6 h-6 text-green-600" />
                    My Quote Requests
                </h1>
                <p className="text-slate-600 text-sm mt-1">
                    Requests you have sent to sellers and export coordinators.
                </p>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-20 text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Loading your quote requests...
                </div>
            )}

            {!loading && error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
                    {error}
                </div>
            )}

            {!loading && !error && quotes.length === 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                    <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-700 font-medium">No quote requests yet</p>
                    <p className="text-slate-500 text-sm mt-1">
                        Ask a seller for a price from any product page.
                    </p>
                    <Link
                        href="/marketplace/buyer/products"
                        className="inline-block mt-4 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                    >
                        Browse products
                    </Link>
                </div>
            )}

            {!loading && !error && quotes.length > 0 && (
                <div className="space-y-3">
                    {quotes.map((q) => {
                        const isExport = q.subjectType === "export_window";
                        return (
                            <div
                                key={q.id}
                                className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-start gap-4"
                            >
                                <div
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                        isExport ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                                    }`}
                                >
                                    {isExport ? <Container className="w-5 h-5" /> : <Package className="w-5 h-5" />}
                                </div>

                                <div className="grow min-w-0">
                                    <p className="font-semibold text-slate-900 truncate">
                                        {q.productName || "Untitled"}
                                    </p>
                                    <p className="text-sm text-slate-600">
                                        {q.quantity ?? "?"} {q.unit || "units"}
                                        {q.preferredDeliveryDate ? ` · wanted by ${q.preferredDeliveryDate}` : ""}
                                    </p>
                                    {q.notes && (
                                        <p className="text-sm text-slate-500 mt-1 line-clamp-2">{q.notes}</p>
                                    )}
                                    <p className="text-xs text-slate-400 mt-1">
                                        Sent {q.createdAt ? formatLocalDate(q.createdAt) : "recently"}
                                    </p>

                                    {typeof q.offeredPrice === "number" && (
                                        <p className="text-sm mt-2 flex items-center gap-2">
                                            <Tag className="w-4 h-4 text-green-600" />
                                            <span className="text-slate-700">
                                                You offered {naira(q.offeredPrice)} per {q.unit || "unit"}
                                            </span>
                                            {typeof q.listedPrice === "number" && q.listedPrice > 0 && (
                                                <span className="text-slate-500">
                                                    (listed {naira(q.listedPrice)})
                                                </span>
                                            )}
                                        </p>
                                    )}

                                    {q.sellerMessage && (
                                        <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">
                                            “{q.sellerMessage}”
                                        </p>
                                    )}

                                    {/* #873 — the seller countered; the buyer answers. */}
                                    {q.status === "countered" && (
                                        <div className="mt-3 pt-3 border-t border-slate-100">
                                            <p className="text-sm text-slate-900 font-semibold mb-2">
                                                The seller offered {naira(q.counterPrice)} per {q.unit || "unit"}
                                                {" "}for {q.quantity ?? "?"} {q.unit || "units"}.
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    disabled={busy === q.id}
                                                    onClick={() => settle(q.id, "accept")}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:bg-slate-300"
                                                >
                                                    <Check className="w-4 h-4" />
                                                    Accept this price
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busy === q.id}
                                                    onClick={() => settle(q.id, "decline")}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:text-slate-300"
                                                >
                                                    <X className="w-4 h-4" />
                                                    Decline
                                                </button>
                                                {busy === q.id && (
                                                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        Saving…
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/*
                                      *   #873 AGREED — and a way to actually use it.
                                      *
                                      *   An agreed price the buyer cannot spend is the same
                                      *   shape of defect this page was created to fix: a
                                      *   record written that nothing could act on.
                                      */}
                                    {/*
                                      *   An export-window quote is never spendable in the
                                      *   cart (validateCartItems refuses one by design), so
                                      *   the button is not offered for it. The submission
                                      *   door refuses the figure in the first place; this is
                                      *   the other end of the same rule, for any row written
                                      *   before it.
                                      */}
                                    {q.status === "accepted" && !q.consumedByOrderId && !isExport && (
                                        <div className="mt-3 pt-3 border-t border-slate-100">
                                            <p className="text-sm text-green-700 font-semibold mb-2">
                                                Agreed at {naira(q.agreedPrice)} per {q.unit || "unit"}
                                                {" "}for {q.quantity ?? "?"} {q.unit || "units"}.
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => checkout(q)}
                                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700"
                                            >
                                                <ShoppingCart className="w-4 h-4" />
                                                Check out at {naira(q.agreedPrice)}
                                            </button>
                                        </div>
                                    )}

                                    {q.status === "accepted" && q.consumedByOrderId && (
                                        <p className="text-sm text-slate-500 mt-2">
                                            Used on order {q.consumedByOrderId}.
                                        </p>
                                    )}
                                </div>

                                <span className={`shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                                    q.status === "accepted" ? "bg-green-100 text-green-700"
                                        : q.status === "declined" ? "bg-slate-100 text-slate-600"
                                            : q.status === "countered" ? "bg-blue-100 text-blue-700"
                                                : "bg-amber-100 text-amber-700"
                                }`}>
                                    <Clock className="w-3 h-3" />
                                    {q.status === "accepted" ? "Agreed"
                                        : q.status === "declined" ? "Declined"
                                            : q.status === "countered" ? "Seller replied"
                                                : "Awaiting response"}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
