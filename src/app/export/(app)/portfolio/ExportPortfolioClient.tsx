/**
 * Export Portfolio Page
 * 
 * Comprehensive portfolio view with analytics and performance tracking
 */

"use client";

import { useState, useEffect } from "react";
import { PieChart, TrendingUp, Calendar, DollarSign, Loader2, RefreshCw } from "lucide-react";
import BackButton from "@/components/ui/BackButton";
import { getUserExportInvestmentsAction, getUserExportStatsAction } from "@/app/actions/export";
import { useServerSeed } from "@/hooks/useServerSeed";
import { toast } from "sonner";
import ListLoadFailed from "@/components/common/ListLoadFailed";

interface Investment {
    id: string;
    commodity: string;
    amount: number;
    expectedReturn: number;
    roi: number; // approximate or calculated
    status: string;
    startDate: string | Date;
    endDate: string | Date;
}

export default function ExportPortfolioClient({ initial = null }: {
    /**
     *   #550 The two RAW results the server already fetched.
     *
     *   TWO SEPARATE EFFECTS FIRED ON MOUNT HERE, one for the stats and one for
     *   the first page of investments — independent reads issued as two round
     *   trips from the browser. The server does both in parallel now.
     *
     *   Raw, because the client derives the aggregate ROI from the stats and a
     *   per-investment ROI from each row, and it pages: loadInvestments(false)
     *   fetches the next page with a cursor, so the fetch has to stay.
     */
    initial?: { statsResult: any; investmentsResult: any } | null;
}) {
    const takeSeedStats = useServerSeed(initial?.statsResult ?? null);
    const takeSeedInvestments = useServerSeed(initial?.investmentsResult ?? null);

    const [stats, setStats] = useState({
        totalValue: 0,
        totalReturns: 0,
        roi: 0
    });
    const [investments, setInvestments] = useState<Investment[]>([]);
    /**
     *   #588 — a read that FAILED, as opposed to one that found nothing.
     *
     *   A toast is not a state: it appears for a few seconds and goes, and what
     *   the investor is left looking at is "No investments found" over money
     *   they have in escrow. The toast stays — it is the right thing for a
     *   RETRY that fails — and the table now says which of the two happened.
     */
    const [loadFailed, setLoadFailed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastId, setLastId] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);

    useEffect(() => {
        async function loadStats() {
            const result = takeSeedStats() ?? await getUserExportStatsAction();
            if (result.success && result.data) {
                const totalVal = result.data.totalInvested;
                const totalRet = result.data.totalReturns + result.data.pendingReturns;
                // Simple aggregate ROI
                const avgRoi = totalVal > 0 ? Math.round(((totalRet - totalVal) / totalVal) * 100) : 0;

                setStats({
                    totalValue: totalVal,
                    totalReturns: result.data.totalReturns + result.data.pendingReturns, // Show all expected returns
                    roi: avgRoi
                });
            }
        }
        loadStats();
    }, [takeSeedStats]);

    async function loadInvestments(reset = true) {
        if (reset) {
            setLoading(true);
            setInvestments([]);
        } else {
            setLoadingMore(true);
        }

        try {
            const currentLastId = reset ? undefined : lastId || undefined;
            //   The seed covers only the FIRST page. Paging always fetches.
            const result = (reset ? takeSeedInvestments() : null)
                ?? await getUserExportInvestmentsAction(10, currentLastId);

            if (result.success && result.data) {
                const mappedInvestments = result.data.map((inv: any) => ({
                    ...inv,
                    roi: inv.amount > 0 ? Math.round((inv.expectedReturn / inv.amount) * 100) : 0 // Calculate ROI dynamically
                }));

                if (reset) {
                    setInvestments(mappedInvestments);
                } else {
                    setInvestments(prev => [...prev, ...mappedInvestments]);
                }
                setLastId(result.meta?.cursor || null);
                setHasMore(!!result.meta?.cursor);
                setLoadFailed(false);
            } else {
                toast.error(result.error || "Failed to load investments");
                setLoadFailed(true);
            }
        } catch (error) {
            console.error("Failed to load investments:", error);
            toast.error("Failed to load investments");
            setLoadFailed(true);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        loadInvestments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleLoadMore() {
        if (!loadingMore && hasMore) {
            loadInvestments(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="mb-8">
                    <BackButton fallbackPath="/export/dashboard" />
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Investment Portfolio
                    </h1>
                    <p className="text-slate-600">
                        Track your export investments and performance
                    </p>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-xl p-6 border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-slate-600">
                                Total Portfolio Value
                            </div>
                            <DollarSign className="w-5 h-5 text-orange-600" />
                        </div>
                        <div className="text-3xl font-bold text-slate-900">
                            ₦{stats.totalValue.toLocaleString()}
                        </div>
                    </div>

                    <div className="bg-white rounded-xl p-6 border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-slate-600">
                                Total Returns
                            </div>
                            <TrendingUp className="w-5 h-5 text-green-600" />
                        </div>
                        <div className="text-3xl font-bold text-green-600">
                            +₦{stats.totalReturns.toLocaleString()}
                        </div>
                    </div>

                    <div className="bg-white rounded-xl p-6 border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-slate-600">
                                Average ROI
                            </div>
                            <PieChart className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="text-3xl font-bold text-blue-600">
                            {stats.roi}%
                        </div>
                    </div>
                </div>

                {/* Investments Table */}
                <div className="bg-white rounded-xl border border-slate-200">
                    <div className="p-6 border-b border-slate-200">
                        <h2 className="text-xl font-bold text-slate-900">
                            All Investments
                        </h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-slate-200">
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900">
                                        Commodity
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900">
                                        Investment
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900">
                                        Expected Returns
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900">
                                        ROI
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900">
                                        Period
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900">
                                        Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={6} className="text-center py-12">
                                            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600" />
                                        </td>
                                    </tr>
                                ) : loadFailed && investments.length === 0 ? (
                                    /*  #588 — not "you have none". */
                                    <tr>
                                        <td colSpan={6} className="py-8 px-4">
                                            <ListLoadFailed what="your investments" onRetry={() => loadInvestments(true)} />
                                        </td>
                                    </tr>
                                ) : investments.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="text-center py-12 text-slate-500">
                                            No investments found
                                        </td>
                                    </tr>
                                ) : (investments.map((investment) => (
                                    <tr
                                        key={investment.id}
                                        className="border-b border-slate-200 hover:bg-slate-50 transition-colors"
                                    >
                                        <td className="p-4">
                                            <div className="font-medium text-slate-900">
                                                {investment.commodity}
                                            </div>
                                        </td>
                                        <td className="p-4 text-slate-900">
                                            ₦{investment.amount.toLocaleString()}
                                        </td>
                                        <td className="p-4 text-green-600 font-medium">
                                            +₦{investment.expectedReturn.toLocaleString()}
                                        </td>
                                        <td className="p-4">
                                            <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                                                {investment.roi}%
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm text-slate-600">
                                            <div className="flex items-center gap-1">
                                                <Calendar className="w-4 h-4" />
                                                {new Date(investment.startDate).toLocaleDateString()} -{" "}
                                                {new Date(investment.endDate).toLocaleDateString()}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium capitalize">
                                                {investment.status}
                                            </span>
                                        </td>
                                    </tr>
                                )))}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination */}
                    {hasMore && (
                        <div className="p-4 border-t border-slate-200 flex justify-center">
                            <button
                                onClick={handleLoadMore}
                                disabled={loadingMore}
                                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors text-sm font-medium"
                            >
                                {loadingMore ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Loading more...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="w-4 h-4" />
                                        Load More
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
