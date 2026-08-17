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
 * The notification now links to this list. A per-quote detail route is still
 * not created: there is no seller-response flow for one to show, and adding a
 * page whose only content is what the list already displays would be the same
 * mistake in a nicer shape.
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
import { FileText, Loader2, Package, Clock, Container, Mail } from "lucide-react";
import { logger } from "@/lib/logger";
import { getMyQuotesAction } from "@/app/actions/marketplace";
import { formatLocalDate } from "@/lib/date-utils";
import BackButton from "@/components/ui/BackButton";

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
}

export default function SellerQuotesPage() {
    const [loading, setLoading] = useState(true);
    const [quotes, setQuotes] = useState<QuoteRow[]>([]);
    const [error, setError] = useState<string | null>(null);

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
        load();
    }, [load]);

    return (
        <div className="max-w-5xl mx-auto">
            <BackButton />

            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-6 h-6 text-green-600" />
                    Quote Requests
                </h1>
                <p className="text-slate-600 text-sm mt-1">
                    Buyers asking you for a price. Reply by email — there is no in-app quoting yet.
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
                                </div>

                                <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                    <Clock className="w-3 h-3" />
                                    {q.status && q.status !== "pending" ? q.status : "Needs a reply"}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
