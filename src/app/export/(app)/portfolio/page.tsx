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
import { toast } from "sonner";

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

export default function ExportPortfolioPage() {
    const [stats, setStats] = useState({
        totalValue: 0,
        totalReturns: 0,
        roi: 0
    });
    const [investments, setInvestments] = useState<Investment[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastId, setLastId] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);

    useEffect(() => {
        async function loadStats() {
            const result = await getUserExportStatsAction();
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
    }, []);

    async function loadInvestments(reset = true) {
        if (reset) {
            setLoading(true);
            setInvestments([]);
        } else {
            setLoadingMore(true);
        }

        try {
            const currentLastId = reset ? undefined : lastId || undefined;
            const result = await getUserExportInvestmentsAction(10, currentLastId);

            if (result.success && result.data) {
                const mappedInvestments = result.data.map(inv => ({
                    ...inv,
                    roi: inv.amount > 0 ? Math.round((inv.expectedReturn / inv.amount) * 100) : 0 // Calculate ROI dynamically
                }));

                if (reset) {
                    setInvestments(mappedInvestments);
                } else {
                    setInvestments(prev => [...prev, ...mappedInvestments]);
                }
                setLastId(result.lastId || null);
                setHasMore(!!result.lastId);
            } else {
                toast.error(result.error || "Failed to load investments");
            }
        } catch (error) {
            console.error("Failed to load investments:", error);
            toast.error("Failed to load investments");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        loadInvestments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleLoadMore = () => {
        if (!loadingMore && hasMore) {
            loadInvestments(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="mb-8">
                    <BackButton fallbackPath="/export/dashboard" />
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Investment Portfolio
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Track your export investments and performance
                    </p>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-slate-600 dark:text-slate-400">
                                Total Portfolio Value
                            </div>
                            <DollarSign className="w-5 h-5 text-orange-600" />
                        </div>
                        <div className="text-3xl font-bold text-slate-900 dark:text-white">
                            ₦{stats.totalValue.toLocaleString()}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-slate-600 dark:text-slate-400">
                                Total Returns
                            </div>
                            <TrendingUp className="w-5 h-5 text-green-600" />
                        </div>
                        <div className="text-3xl font-bold text-green-600">
                            +₦{stats.totalReturns.toLocaleString()}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-slate-600 dark:text-slate-400">
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
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                            All Investments
                        </h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700">
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900 dark:text-white">
                                        Commodity
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900 dark:text-white">
                                        Investment
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900 dark:text-white">
                                        Expected Returns
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900 dark:text-white">
                                        ROI
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900 dark:text-white">
                                        Period
                                    </th>
                                    <th className="text-left p-4 text-sm font-semibold text-slate-900 dark:text-white">
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
                                ) : investments.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="text-center py-12 text-slate-500">
                                            No investments found
                                        </td>
                                    </tr>
                                ) : (investments.map((investment) => (
                                    <tr
                                        key={investment.id}
                                        className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                                    >
                                        <td className="p-4">
                                            <div className="font-medium text-slate-900 dark:text-white">
                                                {investment.commodity}
                                            </div>
                                        </td>
                                        <td className="p-4 text-slate-900 dark:text-white">
                                            ₦{investment.amount.toLocaleString()}
                                        </td>
                                        <td className="p-4 text-green-600 font-medium">
                                            +₦{investment.expectedReturn.toLocaleString()}
                                        </td>
                                        <td className="p-4">
                                            <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">
                                                {investment.roi}%
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm text-slate-600 dark:text-slate-400">
                                            <div className="flex items-center gap-1">
                                                <Calendar className="w-4 h-4" />
                                                {new Date(investment.startDate).toLocaleDateString()} -{" "}
                                                {new Date(investment.endDate).toLocaleDateString()}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="px-3 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded-full text-sm font-medium capitalize">
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
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-center">
                            <button
                                onClick={handleLoadMore}
                                disabled={loadingMore}
                                className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors text-sm font-medium"
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
