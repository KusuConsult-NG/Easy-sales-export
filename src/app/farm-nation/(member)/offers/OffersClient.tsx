/**
 * Offers a member has made, and offers made on their land.
 *
 *   #874 THE SCREEN THE NEGOTIATION HAPPENS ON.
 *
 *   THE OWNER: "a buyer wants to ask for discount on certain product/property".
 *   #873 wired the marketplace half; this is the property one, and the module
 *   had nothing at all before it — the only buyer-to-owner channel on a listing
 *   is a land inquiry, and an inquiry is a public intake with no account behind
 *   it, so it cannot carry money.
 *
 *   NOTHING ON THIS SCREEN SETS A PRICE. Every control sends an id and a
 *   decision; the figures are written by the server from the row, and the
 *   checkout re-reads the row again before it charges anything. See
 *   lib/quote-negotiation.ts for the rules and why they are shared with the
 *   marketplace rather than copied.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Handshake, Loader2, Check, X, Tag, Clock, ArrowRight } from "lucide-react";
import { logger } from "@/lib/logger";
import {
    getMyLandOffersAction,
    respondToLandOfferAction,
    settleLandOfferCounterAction,
} from "@/app/actions/land-offers";
import { formatLocalDate } from "@/lib/date-utils";
import { useToast } from "@/contexts/ToastContext";
import BackButton from "@/components/ui/BackButton";

interface OfferRow {
    id: string;
    listingId?: string;
    listingTitle?: string;
    buyerName?: string;
    buyerEmail?: string;
    offerMode?: "buy" | "rent";
    listedPrice?: number;
    offeredPrice?: number;
    counterPrice?: number;
    agreedPrice?: number;
    message?: string;
    sellerMessage?: string;
    status?: string;
    consumedByOrderId?: string;
    createdAt?: any;
}

interface Both { asBuyer: OfferRow[]; asSeller: OfferRow[] }

const naira = (n: unknown) => `₦${Number(n || 0).toLocaleString()}`;

/** The pill, spelled the same on both lists so one status never reads two ways. */
function StatusPill({ status }: { status?: string }) {
    const label = status === "accepted" ? "Agreed"
        : status === "declined" ? "Declined"
            : status === "countered" ? "Countered"
                : "Waiting";
    const tone = status === "accepted" ? "bg-green-100 text-green-700"
        : status === "declined" ? "bg-slate-100 text-slate-600"
            : status === "countered" ? "bg-blue-100 text-blue-700"
                : "bg-amber-100 text-amber-700";
    return (
        <span className={`shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${tone}`}>
            <Clock className="w-3 h-3" />
            {label}
        </span>
    );
}

export default function OffersClient({ initial = null }: { initial?: Both | null }) {
    const router = useRouter();
    const { showToast } = useToast();
    const [loading, setLoading] = useState(initial === null);
    const [data, setData] = useState<Both>(initial ?? { asBuyer: [], asSeller: [] });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [counter, setCounter] = useState<Record<string, string>>({});
    const [note, setNote] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getMyLandOffersAction();
            if (result.success && result.data) {
                setData(result.data as Both);
            } else {
                setError(result.error || "Failed to load your offers.");
            }
        } catch (e) {
            logger.error("Failed to load land offers:", { error: e });
            setError("An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (initial !== null) return;
        load();
    }, [load, initial]);

    /** The owner answers. try/catch/finally, so a throw cannot strand a button. */
    const respond = useCallback(async (
        id: string,
        decision: "accept" | "counter" | "decline",
    ) => {
        setBusy(id);
        try {
            const priceText = (counter[id] ?? "").trim();
            const result = await respondToLandOfferAction(id, {
                decision,
                price: priceText === "" ? undefined : Number(priceText),
                message: note[id] ?? "",
            });
            if (!result.success) {
                showToast(result.error || "Could not send your response.", "error");
                return;
            }
            showToast(
                decision === "accept" ? "Offer accepted."
                    : decision === "counter" ? "Your price was sent to the buyer."
                        : "Offer declined.",
                "success",
            );
            setCounter((prev) => ({ ...prev, [id]: "" }));
            setNote((prev) => ({ ...prev, [id]: "" }));
            await load();
        } catch (e) {
            logger.error("Failed to respond to a land offer:", { error: e });
            showToast("An unexpected error occurred.", "error");
        } finally {
            setBusy(null);
        }
    }, [counter, note, load, showToast]);

    /** The buyer answers a counter. Takes no figure — the owner's is on the row. */
    const settle = useCallback(async (id: string, decision: "accept" | "decline") => {
        setBusy(id);
        try {
            const result = await settleLandOfferCounterAction(id, decision);
            if (!result.success) {
                showToast(result.error || "Could not record your answer.", "error");
                return;
            }
            showToast(
                decision === "accept" ? "Price agreed. You can reserve the land at that price."
                    : "Offer declined.",
                "success",
            );
            await load();
        } catch (e) {
            logger.error("Failed to settle a land offer:", { error: e });
            showToast("An unexpected error occurred.", "error");
        } finally {
            setBusy(null);
        }
    }, [load, showToast]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                Loading your offers...
            </div>
        );
    }

    const nothing = data.asBuyer.length === 0 && data.asSeller.length === 0;

    return (
        <div className="max-w-5xl mx-auto p-4 lg:p-8">
            <BackButton />

            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <Handshake className="w-6 h-6 text-green-600" />
                    Offers
                </h1>
                <p className="text-slate-600 text-sm mt-1">
                    Prices you have offered on land, and prices buyers have offered you.
                </p>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6">
                    {error}
                </div>
            )}

            {nothing && !error && (
                <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                    <Handshake className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-700 font-medium">No offers yet</p>
                    <p className="text-slate-500 text-sm mt-1">
                        Open any property and use “Make an offer” to name your price.
                    </p>
                    <Link
                        href="/farm-nation/properties"
                        className="inline-block mt-4 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                    >
                        Browse properties
                    </Link>
                </div>
            )}

            {/* ─── Offers on my land ─────────────────────────────────────── */}
            {data.asSeller.length > 0 && (
                <section className="mb-10">
                    <h2 className="text-lg font-bold text-slate-900 mb-3">
                        Offers on your land
                    </h2>
                    <div className="space-y-3">
                        {data.asSeller.map((o) => (
                            <div key={o.id} className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-start gap-4">
                                <div className="grow min-w-0">
                                    <p className="font-semibold text-slate-900 truncate">
                                        {o.listingTitle || "Untitled"}
                                    </p>
                                    <p className="text-sm mt-1 flex flex-wrap items-center gap-2">
                                        <Tag className="w-4 h-4 text-green-600" />
                                        <span className="font-semibold text-slate-900">
                                            {o.buyerName || "A buyer"} offered {naira(o.offeredPrice)}
                                        </span>
                                        <span className="text-slate-500">
                                            (listed {naira(o.listedPrice)}
                                            {o.offerMode === "rent" ? ", rental" : ""})
                                        </span>
                                    </p>
                                    {o.message && (
                                        <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">
                                            “{o.message}”
                                        </p>
                                    )}
                                    <p className="text-xs text-slate-400 mt-1">
                                        Received {o.createdAt ? formatLocalDate(o.createdAt) : "recently"}
                                    </p>

                                    {o.status === "accepted" && (
                                        <p className="text-sm text-green-700 font-semibold mt-2">
                                            Agreed at {naira(o.agreedPrice)}. Waiting for the buyer to pay.
                                        </p>
                                    )}
                                    {o.status === "countered" && (
                                        <p className="text-sm text-blue-700 mt-2">
                                            You asked {naira(o.counterPrice)} — waiting for the buyer.
                                        </p>
                                    )}

                                    {/*
                                      *   Controls only while there is an answer to give.
                                      *   The server refuses a second response, and a button
                                      *   that always fails is worse than no button.
                                      */}
                                    {o.status === "pending" && (
                                        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                                            <div className="flex flex-col sm:flex-row gap-2">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="any"
                                                    value={counter[o.id] ?? ""}
                                                    onChange={(e) => setCounter((p) => ({ ...p, [o.id]: e.target.value }))}
                                                    placeholder="Your price"
                                                    className="grow px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                                />
                                                <input
                                                    type="text"
                                                    value={note[o.id] ?? ""}
                                                    onChange={(e) => setNote((p) => ({ ...p, [o.id]: e.target.value }))}
                                                    placeholder="A note to the buyer (optional)"
                                                    className="grow px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                                />
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    disabled={busy === o.id}
                                                    onClick={() => respond(o.id, "accept")}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:bg-slate-300"
                                                >
                                                    <Check className="w-4 h-4" />
                                                    Accept {naira(o.offeredPrice)}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busy === o.id || (counter[o.id] ?? "").trim() === ""}
                                                    onClick={() => respond(o.id, "counter")}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-slate-300"
                                                    title={(counter[o.id] ?? "").trim() === "" ? "Type a price first" : undefined}
                                                >
                                                    <Tag className="w-4 h-4" />
                                                    Send this price
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busy === o.id}
                                                    onClick={() => respond(o.id, "decline")}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:text-slate-300"
                                                >
                                                    <X className="w-4 h-4" />
                                                    Decline
                                                </button>
                                                {busy === o.id && (
                                                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        Sending…
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <StatusPill status={o.status} />
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* ─── Offers I have made ────────────────────────────────────── */}
            {data.asBuyer.length > 0 && (
                <section>
                    <h2 className="text-lg font-bold text-slate-900 mb-3">
                        Offers you have made
                    </h2>
                    <div className="space-y-3">
                        {data.asBuyer.map((o) => (
                            <div key={o.id} className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-start gap-4">
                                <div className="grow min-w-0">
                                    <Link
                                        href={`/farm-nation/property/${o.listingId}`}
                                        className="font-semibold text-slate-900 truncate hover:text-green-700"
                                    >
                                        {o.listingTitle || "Untitled"}
                                    </Link>
                                    <p className="text-sm mt-1 flex flex-wrap items-center gap-2">
                                        <Tag className="w-4 h-4 text-green-600" />
                                        <span className="text-slate-700">
                                            You offered {naira(o.offeredPrice)}
                                        </span>
                                        <span className="text-slate-500">
                                            (listed {naira(o.listedPrice)}
                                            {o.offerMode === "rent" ? ", rental" : ""})
                                        </span>
                                    </p>
                                    {o.sellerMessage && (
                                        <p className="text-sm text-slate-600 mt-2 whitespace-pre-line">
                                            “{o.sellerMessage}”
                                        </p>
                                    )}
                                    <p className="text-xs text-slate-400 mt-1">
                                        Sent {o.createdAt ? formatLocalDate(o.createdAt) : "recently"}
                                    </p>

                                    {o.status === "countered" && (
                                        <div className="mt-3 pt-3 border-t border-slate-100">
                                            <p className="text-sm font-semibold text-slate-900 mb-2">
                                                The owner asked {naira(o.counterPrice)}.
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    disabled={busy === o.id}
                                                    onClick={() => settle(o.id, "accept")}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:bg-slate-300"
                                                >
                                                    <Check className="w-4 h-4" />
                                                    Accept this price
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busy === o.id}
                                                    onClick={() => settle(o.id, "decline")}
                                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:text-slate-300"
                                                >
                                                    <X className="w-4 h-4" />
                                                    Decline
                                                </button>
                                                {busy === o.id && (
                                                    <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        Saving…
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/*
                                      *   An agreed price the buyer cannot spend would be the
                                      *   same defect the rest of this audit keeps finding: a
                                      *   record written that nothing can act on. The id
                                      *   travels to the checkout, which re-reads the row.
                                      */}
                                    {o.status === "accepted" && !o.consumedByOrderId && (
                                        <div className="mt-3 pt-3 border-t border-slate-100">
                                            <p className="text-sm text-green-700 font-semibold mb-2">
                                                Agreed at {naira(o.agreedPrice)}.
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => router.push(
                                                    `/farm-nation/checkout/${o.listingId}?mode=${o.offerMode || "buy"}&offer=${o.id}`,
                                                )}
                                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700"
                                            >
                                                Reserve at {naira(o.agreedPrice)}
                                                <ArrowRight className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}

                                    {o.status === "accepted" && o.consumedByOrderId && (
                                        <p className="text-sm text-slate-500 mt-2">
                                            Used on purchase {o.consumedByOrderId}.
                                        </p>
                                    )}
                                </div>
                                <StatusPill status={o.status} />
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
