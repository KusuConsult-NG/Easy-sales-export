/**
 * Admin — Marketplace Wallet Withdrawals
 * /admin/marketplace/withdrawals
 *
 * Process wallet withdrawal requests from marketplace buyers/sellers
 */

"use client";

import { useState, useEffect } from "react";
import {
    DollarSign, CheckCircle, XCircle, Loader2, Clock, User, AlertCircle,
} from "lucide-react";
import { processWalletWithdrawalAction, getAdminWalletWithdrawalsAction } from "@/app/actions/wallet";
import { useToast } from "@/contexts/ToastContext";
import { useAdminData } from "@/hooks/useAdminData";

const STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    processing: "bg-blue-100 text-blue-800",
    approved: "bg-indigo-100 text-indigo-800",
    completed: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
};

const fmt = (n: number = 0) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n || 0);

const fmtDate = (val: any) => {
    if (!val) return "—";
    const d = val?.toDate ? val.toDate() : new Date(val);
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

export default function AdminWalletWithdrawalsPage() {
    const { showToast } = useToast();
    const [statusFilter, setStatusFilter] = useState("pending");

    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    const {
        data: withdrawals,
        loading,
        error,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: fetchWithdrawals
    } = useAdminData<any>({
        fetchAction: async (opts) => {
            const result = await getAdminWalletWithdrawalsAction({
                status: statusFilter,
                limit: opts.limit || 25,
                lastDocId: opts.lastDocId,
                sortOrder: sortOrder
            });
            return {
                success: result.success,
                data: result.success ? result.data : [],
                lastDocId: result.success ? result.lastDocId : undefined,
                hasMore: result.success ? result.hasMore : false,
                error: result.success ? null : result.error
            };
        },
        limit: 25,
        dependencies: [statusFilter, sortOrder]
    });

    const [processingId, setProcessingId] = useState<string | null>(null);

    async function handleAction(withdrawalId: string, action: "approve" | "reject") {
        const notes = action === "reject"
            ? prompt("Enter rejection reason (required):")
            : prompt("Enter bank transfer reference (optional):");
        if (action === "reject" && !notes) return;

        setProcessingId(withdrawalId);
        const res = await processWalletWithdrawalAction(withdrawalId, action, notes || undefined);
        setProcessingId(null);
        if (res.success) {
            showToast(`Withdrawal ${action === "approve" ? "approved" : "rejected"} successfully`, "success");
            fetchWithdrawals();
        } else {
            showToast(res.error || `Unable to ${action}`, "error");
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">Wallet Withdrawals</h1>
                <p className="text-slate-600">Review and process marketplace wallet withdrawal requests</p>
            </div>

            {/* Filter */}
            <div className="flex flex-col sm:flex-row items-center gap-3 mb-6">
                <div className="flex items-center gap-2 flex-wrap">
                    {["pending", "processing", "approved", "completed", "rejected", "all"].map((s) => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${statusFilter === s ? "bg-slate-900 text-white" : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"}`}
                        >
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                    ))}
                </div>
                <div className="ml-auto flex items-center gap-2 w-full sm:w-auto">
                    <select
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                        className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-300 text-slate-700 bg-white w-full sm:w-auto"
                    >
                        <option value="desc">Newest First</option>
                        <option value="asc">Oldest First</option>
                    </select>
                </div>
            </div>

            {loading && (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-10 h-10 animate-spin text-green-600" />
                </div>
            )}

            {error && !loading && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 mb-6">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-red-700">{error}</p>
                </div>
            )}

            {!loading && !error && (
                <div className="space-y-4">
                    {withdrawals.length === 0 ? (
                        <div className="bg-white rounded-2xl p-16 text-center border border-slate-200">
                            <DollarSign className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">No Withdrawal Requests</h3>
                            <p className="text-slate-500">No {statusFilter !== "all" ? statusFilter : ""} withdrawal requests at this time.</p>
                        </div>
                    ) : withdrawals.map((wd) => (
                        <div key={wd.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                            <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                                        <User className="w-6 h-6 text-green-700" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-slate-900 text-lg">{fmt(wd.amount)}</p>
                                        <p className="text-sm text-slate-500">{wd.userId}</p>
                                        {wd.bankDetails && (
                                            <p className="text-sm text-slate-600 mt-1">
                                                🏦 {wd.bankDetails.bankName} • {wd.bankDetails.accountNumber} — {wd.bankDetails.accountName}
                                            </p>
                                        )}
                                        {wd.adminNotes && (
                                            <p className="text-xs text-slate-400 italic mt-1">{wd.adminNotes}</p>
                                        )}
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${STATUS_COLORS[wd.status] || "bg-slate-100 text-slate-600"}`}>
                                    {wd.status}
                                </span>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-slate-100 flex-wrap gap-3">
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <Clock className="w-4 h-4" />
                                    Requested: {fmtDate(wd.createdAt)}
                                    {wd.processedAt && ` • Processed: ${fmtDate(wd.processedAt)}`}
                                </div>

                                {wd.status === "pending" && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleAction(wd.id, "reject")}
                                            disabled={processingId === wd.id}
                                            className="px-4 py-2 rounded-lg border border-red-300 text-red-700 font-semibold hover:bg-red-50 transition disabled:opacity-50 flex items-center gap-1.5 text-sm"
                                        >
                                            {processingId === wd.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Reject
                                        </button>
                                        <button
                                            onClick={() => handleAction(wd.id, "approve")}
                                            disabled={processingId === wd.id}
                                            className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-1.5 text-sm"
                                        >
                                            {processingId === wd.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Approve
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Pagination Controls */}
            {withdrawals.length > 0 && !loading && !error && (
                <div className="flex items-center justify-between mt-8 p-4 bg-white rounded-2xl shadow-sm border border-slate-100">
                    <span className="text-sm font-medium text-slate-500">Page {pageIndex + 1}</span>
                    <div className="flex gap-2">
                        <button
                            onClick={onPrevPage}
                            disabled={pageIndex === 0 || loading}
                            className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
                        >
                            Previous
                        </button>
                        <button
                            onClick={onNextPage}
                            disabled={!hasMore || loading}
                            className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition flex items-center gap-2"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : "Next Page"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
