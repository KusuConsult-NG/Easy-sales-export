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
 * ON WHAT IT DOES NOT SHOW
 * ------------------------
 * There is no seller-response flow in this codebase — nothing writes a quoted
 * price, a rejection, or anything else onto a quote after it is created. Every
 * quote is therefore "pending", and this page says so plainly rather than
 * implying a negotiation that cannot happen. Inventing that flow here would be
 * building a feature under cover of fixing a bug.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FileText, Loader2, Package, Clock, Container } from "lucide-react";
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
    status?: string;
    createdAt?: any;
}

export default function BuyerQuotesPage() {
    const [loading, setLoading] = useState(true);
    const [quotes, setQuotes] = useState<QuoteRow[]>([]);
    const [error, setError] = useState<string | null>(null);

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
        load();
    }, [load]);

    return (
        <div className="max-w-5xl mx-auto p-4 lg:p-8">
            <BackButton />

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
                                className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4"
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
                                </div>

                                {/*
                                 * Always "Awaiting response" in practice: nothing in the
                                 * codebase writes a status onto a quote after creation.
                                 * Reading the field anyway so this page starts telling the
                                 * truth the moment something does.
                                 */}
                                <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                    <Clock className="w-3 h-3" />
                                    {q.status && q.status !== "pending" ? q.status : "Awaiting response"}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
