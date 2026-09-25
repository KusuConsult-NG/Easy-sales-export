/**
 * Quote requests addressed to the signed-in seller.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * _submitQuoteRequestAction notified the seller with a link to
 * `/marketplace/seller/quotes/{id}` — a route that did not exist, under a
 * directory that did not exist. Every RFQ notification a seller has ever
 * received led to a 404, and getMyQuotesAction("seller") had no caller, so
 * there was no other way in either.
 *
 * The notification now links to this list.
 *
 *   #873 AND THERE IS A RESPONSE FLOW NOW. The header used to end here with
 *   "there is no seller-response flow for one to show", and that was true when
 *   it was written: nothing in the codebase wrote a price, a rejection or
 *   anything else onto a quote after it was created, so every quote sat at
 *   "pending" for ever and this screen's only advice was to send an email.
 *
 *   A seller answers here. Accepting the buyer's figure, or sending one back,
 *   is what makes the price the checkout will charge — see
 *   lib/quote-negotiation.ts. A per-quote detail route is still not created:
 *   the reply is three controls, and they fit on the row.
 *
 * BUYER CONTACT IS SHOWN, DELIBERATELY
 * ------------------------------------
 * buyerEmail is written onto the quote by the action, from the session — not
 * from the request. Without it a seller can see that someone wants 400kg of
 * something and has no way to answer, which is the state this feature has been
 * in since it was built. It is the buyer's own address, disclosed to the one
 * seller they chose to contact.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FileText, Loader2, Package, Clock, Container, Mail, Check, X, Tag } from "lucide-react";
import { logger } from "@/lib/logger";
import { getMyQuotesAction, respondToQuoteAction } from "@/app/actions/marketplace";
import { formatLocalDate } from "@/lib/date-utils";
import BackButton from "@/components/ui/BackButton";
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
    buyerName?: string;
    buyerEmail?: string;
    status?: string;
    createdAt?: any;
    //   #873
    offeredPrice?: number;
    listedPrice?: number;
    counterPrice?: number;
    agreedPrice?: number;
}

const naira = (n: unknown) => `₦${Number(n || 0).toLocaleString()}`;

export default function SellerQuotesClient({ initial = null }: {
    /**
     *   #551 The quotes the server already fetched.
     *
     *   `load` stays: this screen refreshes itself after accepting or
     *   rejecting a quote, so the read is still needed — just not first.
     */
    initial?: QuoteRow[] | null;
}) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(initial === null);
    const [quotes, setQuotes] = useState<QuoteRow[]>(initial ?? []);
    const [error, setError] = useState<string | null>(null);

    //   #873 Which row is being answered, and what is typed into it. Keyed by
    //   quote id rather than held as "the selected quote", so answering one row
    //   never clears what is half-typed into another.
    const [sending, setSending] = useState<string | null>(null);
    const [counter, setCounter] = useState<Record<string, string>>({});
    const [note, setNote] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getMyQuotesAction("seller");
            if (result.success && result.data?.quotes) {
                setQuotes(result.data.quotes as QuoteRow[]);
            } else {
                setError(result.error || "Failed to load quote requests.");
            }
        } catch (e) {
            logger.error("Failed to load seller quotes:", { error: e });
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

    /**
     *   #873 Answer a quote.
     *
     *   try/catch/finally around the await, and the refresh's own failure read.
     *   Without the finally a thrown action leaves the row stuck on "Sending…"
     *   with no way back but a reload — the same defect #872's reply box had,
     *   and the ratchets in this repo exist because it keeps recurring.
     */
    const respond = useCallback(async (
        quoteId: string,
        decision: "accept" | "counter" | "decline",
    ) => {
        setSending(quoteId);
        try {
            const priceText = (counter[quoteId] ?? "").trim();
            const result = await respondToQuoteAction(quoteId, {
                decision,
                price: priceText === "" ? undefined : Number(priceText),
                message: note[quoteId] ?? "",
            });

            if (!result.success) {
                showToast(result.error || "Could not send your response.", "error");
                return;
            }

            showToast(
                decision === "accept" ? "Offer accepted. The buyer can check out at that price."
                    : decision === "counter" ? "Your price was sent to the buyer."
                        : "Offer declined.",
                "success",
            );
            setCounter((prev) => ({ ...prev, [quoteId]: "" }));
            setNote((prev) => ({ ...prev, [quoteId]: "" }));
            await load();
        } catch (e) {
            logger.error("Failed to respond to quote:", { error: e });
            showToast("An unexpected error occurred.", "error");
        } finally {
            setSending(null);
        }
    }, [counter, note, load, showToast]);

    return (
        <div className="max-w-5xl mx-auto">
            <BackButton fallbackPath="/marketplace/seller/dashboard" />

            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-6 h-6 text-green-600" />
                    Quote Requests
                </h1>
                <p className="text-slate-600 text-sm mt-1">
                    Buyers asking you for a price. Answer them here — an accepted
                    price is the price they check out at.
                </p>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-20 text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Loading quote requests...
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
                        Buyers can request a quote from any of your product pages.
                    </p>
                    <Link
                        href="/marketplace/seller/products"
                        className="inline-block mt-4 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                    >
                        My products
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
                                        <p className="text-sm text-slate-500 mt-1 whitespace-pre-line">{q.notes}</p>
                                    )}
                                    <p className="text-sm text-slate-700 mt-2">
                                        From {q.buyerName || "a buyer"}
                                        {q.buyerEmail && (
                                            <>
                                                {" · "}
                                                <a
                                                    href={`mailto:${q.buyerEmail}?subject=${encodeURIComponent(
                                                        `Quote for ${q.productName || "your request"}`,
                                                    )}`}
                                                    className="text-green-700 hover:underline inline-flex items-center gap-1"
                                                >
                                                    <Mail className="w-3 h-3" />
                                                    {q.buyerEmail}
                                                </a>
                                            </>
                                        )}
                                    </p>
                                    <p className="text-xs text-slate-400 mt-1">
                                        Received {q.createdAt ? formatLocalDate(q.createdAt) : "recently"}
                                    </p>

                                    {/* #873 — the figure, and what it is a discount from. */}
                                    {typeof q.offeredPrice === "number" && (
                                        <p className="text-sm mt-2 flex items-center gap-2">
                                            <Tag className="w-4 h-4 text-green-600" />
                                            <span className="font-semibold text-slate-900">
                                                Offers {naira(q.offeredPrice)} per {q.unit || "unit"}
                                            </span>
                                            {typeof q.listedPrice === "number" && q.listedPrice > 0 && (
                                                <span className="text-slate-500">
                                                    (listed {naira(q.listedPrice)})
                                                </span>
                                            )}
                                        </p>
                                    )}

                                    {q.status === "accepted" && typeof q.agreedPrice === "number" && (
                                        <p className="text-sm mt-2 text-green-700 font-semibold">
                                            Agreed at {naira(q.agreedPrice)} per {q.unit || "unit"}
                                        </p>
                                    )}
                                    {q.status === "countered" && typeof q.counterPrice === "number" && (
                                        <p className="text-sm mt-2 text-blue-700">
                                            You offered {naira(q.counterPrice)} — waiting for the buyer.
                                        </p>
                                    )}

                                    {/*
                                      *   THE REPLY, and only while there is one to give.
                                      *
                                      *   An already-answered quote shows what was said and no
                                      *   controls: the server refuses a second response, and a
                                      *   button that always fails is worse than no button.
                                      */}
                                    {q.status === "pending" && (
                                        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                                            <div className="flex flex-col sm:flex-row gap-2">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="any"
                                                    value={counter[q.id] ?? ""}
                                                    onChange={(e) =>
                                                        setCounter((prev) => ({ ...prev, [q.id]: e.target.value }))
                                                    }
                                                    placeholder={`Your price per ${q.unit || "unit"}`}
                                                    className="grow px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                                />
                                                <input
                                                    type="text"
                                                    value={note[q.id] ?? ""}
                                                    onChange={(e) =>
                                                        setNote((prev) => ({ ...prev, [q.id]: e.target.value }))
                                                    }
                                                    placeholder="A note to the buyer (optional)"
                                                    className="grow px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                                />
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                {/*
                                                  *   Accept is shown only when there is a figure to
                                                  *   accept. A request raised with no price has
                                                  *   nothing to say yes to, and the server says so —
                                                  *   this stops the seller finding that out by
                                                  *   being refused.
                                                  */}
                                                {typeof q.offeredPrice === "number" && (
                                                    <button
                                                        type="button"
                                                        disabled={sending === q.id}
                                                        onClick={() => respond(q.id, "accept")}
                                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:bg-slate-300"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                        Accept {naira(q.offeredPrice)}
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    disabled={sending === q.id || (counter[q.id] ?? "").trim() === ""}
                                                    onClick={() => respond(q.id, "counter")}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-slate-300"
                                                    title={(counter[q.id] ?? "").trim() === "" ? "Type a price first" : undefined}
                                                >
                                                    <Tag className="w-4 h-4" />
                                                    Send this price
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={sending === q.id}
                                                    onClick={() => respond(q.id, "decline")}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:text-slate-300"
                                                >
                                                    <X className="w-4 h-4" />
                                                    Decline
                                                </button>
                                                {sending === q.id && (
                                                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        Sending…
                                                    </span>
                                                )}
                                            </div>
                                        </div>
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
                                            : q.status === "countered" ? "Your price sent"
                                                : "Needs a reply"}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
