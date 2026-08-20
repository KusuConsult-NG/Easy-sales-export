/**
 * Admin product moderation.
 *
 * WHY THIS PAGE EXISTS
 * --------------------
 * There was no admin screen anywhere that listed or acted on a marketplace
 * product. createProductAction wrote `status: "pending"`, every buyer-facing
 * reader filters on `status == "active"`, and nothing moved a product between
 * the two — so the primary seller form (linked from six places as "Add your
 * first product") produced listings no buyer could see and no admin could
 * release. admin-content.ts counted the pending products, so the dashboard
 * displayed the size of a backlog with no way to clear it.
 *
 * New listings are no longer held — PRODUCT_INITIAL_STATUS is "active", see
 * lib/product-status.ts for that decision and how to reverse it. This page
 * releases the backlog that accumulated, and gives moderation a mechanism:
 * suspend or reject a live listing, publish a held one.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
    Package,
    Loader2,
    CheckCircle,
    XCircle,
    PauseCircle,
    ShieldAlert,
} from "lucide-react";
import { logger } from "@/lib/logger";
import { getAdminProductsAction, reviewProductAction } from "@/app/actions/admin";
import { formatCurrency } from "@/lib/utils";
import { formatLocalDate } from "@/lib/date-utils";
import BackButton from "@/components/ui/BackButton";

type Decision = "approve" | "reject" | "suspend";

interface AdminProduct {
    id: string;
    title?: string;
    name?: string;
    sellerName?: string;
    sellerId?: string;
    status?: string;
    rejectionReason?: string | null;
    pricingTiers?: Array<{ type: string; price: number }>;
    availableQuantity?: number;
    unit?: string;
    createdAt?: any;
}

const TABS = ["pending", "active", "rejected", "suspended", "draft"] as const;

export default function AdminProductsPage() {
    const [tab, setTab] = useState<(typeof TABS)[number]>("pending");
    const [products, setProducts] = useState<AdminProduct[]>([]);
    const [stats, setStats] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async (status: string) => {
        setLoading(true);
        setError(null);
        try {
            const result = await getAdminProductsAction({ status, limitCount: 50 });
            if (result.success && result.data) {
                setProducts(result.data.products as AdminProduct[]);
                setStats(result.data.stats || {});
            } else {
                setError(result.error || "Failed to load products.");
            }
        } catch (e) {
            logger.error("Admin products load failed:", { error: e });
            setError("An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load(tab);
    }, [tab, load]);

    async function decide(product: AdminProduct, action: Decision) {
        // A rejection or suspension without a reason leaves the seller with a
        // dead listing and nothing to fix, so the action refuses one. Asking here
        // rather than letting the server error is the difference between a prompt
        // and a failure.
        let reason = "";
        if (action !== "approve") {
            const entered = window.prompt(
                `Why are you ${action === "reject" ? "rejecting" : "suspending"} "${product.title || product.name}"?\n\nThe seller sees this.`,
            );
            if (entered === null) return;
            reason = entered.trim();
            if (reason.length < 5) {
                setNotice("A reason of at least 5 characters is required.");
                return;
            }
        }

        setBusyId(product.id);
        setNotice(null);
        try {
            const result = await reviewProductAction({ productId: product.id, action, reason });
            if (result.success) {
                setNotice(`"${product.title || product.name}" is now ${result.data?.status}.`);
                await load(tab);
            } else {
                setNotice(result.error || "The review could not be applied.");
            }
        } catch (e) {
            logger.error("Product review failed:", { error: e });
            setNotice("An unexpected error occurred.");
        } finally {
            setBusyId(null);
        }
    }

    const retailPrice = (p: AdminProduct) =>
        p.pricingTiers?.find((t) => t.type === "retail")?.price ?? p.pricingTiers?.[0]?.price ?? 0;

    return (
        <div className="max-w-6xl mx-auto p-4 lg:p-8">
            <BackButton />

            <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <ShieldAlert className="w-6 h-6 text-green-600" />
                    Product Moderation
                </h1>
                <p className="text-slate-600 text-sm mt-1">
                    New listings publish immediately. Use this to release held listings, or to pull
                    one that should not be live.
                </p>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
                {TABS.map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium capitalize transition-colors ${
                            tab === t
                                ? "bg-green-600 text-white"
                                : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                        }`}
                    >
                        {t}
                        {typeof stats[t] === "number" && (
                            <span
                                className={`ml-2 text-xs ${tab === t ? "text-green-100" : "text-slate-400"}`}
                            >
                                {stats[t]}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {notice && (
                <div className="mb-4 bg-slate-100 border border-slate-200 text-slate-700 rounded-xl p-3 text-sm">
                    {notice}
                </div>
            )}

            {loading && (
                <div className="flex items-center justify-center py-20 text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Loading products...
                </div>
            )}

            {!loading && error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">{error}</div>
            )}

            {!loading && !error && products.length === 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                    <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-700 font-medium">No {tab} products</p>
                </div>
            )}

            {!loading && !error && products.length > 0 && (
                <div className="space-y-3">
                    {products.map((p) => (
                        <div
                            key={p.id}
                            className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center gap-4"
                        >
                            <div className="grow min-w-0">
                                <Link
                                    href={`/marketplace/products/${p.id}`}
                                    className="font-semibold text-slate-900 hover:text-green-700 truncate block"
                                >
                                    {p.title || p.name || "Untitled"}
                                </Link>
                                <p className="text-sm text-slate-600">
                                    {p.sellerName || "Unknown seller"} · {formatCurrency(retailPrice(p))} ·{" "}
                                    {p.availableQuantity ?? 0} {p.unit || "units"}
                                </p>
                                {p.rejectionReason && (
                                    <p className="text-sm text-red-600 mt-1">Reason: {p.rejectionReason}</p>
                                )}
                                <p className="text-xs text-slate-400 mt-1">
                                    Listed {p.createdAt ? formatLocalDate(p.createdAt) : "recently"} · status{" "}
                                    {p.status || "unknown"}
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2 shrink-0">
                                {p.status !== "active" && (
                                    <button
                                        disabled={busyId === p.id}
                                        onClick={() => decide(p, "approve")}
                                        className="px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                                    >
                                        <CheckCircle className="w-4 h-4" />
                                        Publish
                                    </button>
                                )}
                                {p.status === "active" && (
                                    <button
                                        disabled={busyId === p.id}
                                        onClick={() => decide(p, "suspend")}
                                        className="px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1"
                                    >
                                        <PauseCircle className="w-4 h-4" />
                                        Suspend
                                    </button>
                                )}
                                {p.status !== "rejected" && (
                                    <button
                                        disabled={busyId === p.id}
                                        onClick={() => decide(p, "reject")}
                                        className="px-3 py-2 rounded-lg bg-white border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50 flex items-center gap-1"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        Reject
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
