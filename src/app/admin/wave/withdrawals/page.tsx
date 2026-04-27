"use client";

import { useState, useEffect } from "react";
import { DollarSign, CheckCircle, XCircle, Loader2, AlertCircle, Clock, User } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useAdminData } from "@/hooks/useAdminData";
import { getStandardWaveWithdrawalsAction } from "@/app/actions/wave-admin";
import { formatDateTime } from "@/lib/utils";

interface WaveWithdrawal {
    withdrawalId: string;
    userId: string;
    userEmail?: string;
    amount: number;
    status: "pending" | "processing" | "approved" | "approved_pending_payout" | "completed" | "rejected";
    requestedAt: any;
    processedAt?: any;
    processedBy?: string;
    adminNotes?: string;
    transactionReference?: string;
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
}

const STATUS_COLORS: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    processing: "bg-blue-100 text-blue-700",
    approved: "bg-indigo-100 text-indigo-700",
    approved_pending_payout: "bg-orange-100 text-orange-700",
    completed: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
};

export default function AdminWaveWithdrawalsPage() {
    const { showToast } = useToast();
    const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "processing" | "approved" | "approved_pending_payout" | "completed" | "rejected">("pending");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    const {
        data: withdrawals,
        loading: isLoading,
        error,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: fetchWithdrawals
    } = useAdminData<WaveWithdrawal>({
        fetchAction: async (opts) => {
            const result = await getStandardWaveWithdrawalsAction({
                status: statusFilter,
                limit: opts.limit || 25,
                lastDocId: opts.lastDocId,
                sortOrder: sortOrder
            });
            return {
                success: result.success,
                data: result.data as any,
                meta: { ...result.meta, lastDocId: result.lastDocId, hasMore: result.hasMore },
                error: result.error
            };
        },
        limit: 25,
        dependencies: [statusFilter, sortOrder]
    });

    const [processingId, setProcessingId] = useState<string | null>(null);

    async function handleAction(withdrawalId: string, action: "approve" | "reject" | "complete") {
        const notes = action === "reject"
            ? prompt("Enter rejection reason:")
            : action === "approve"
                ? prompt("Enter transaction reference (optional):")
                : prompt("Enter bank transfer reference (optional):");

        if (action === "reject" && !notes) return;

        setProcessingId(withdrawalId);
        try {
            const res = await fetch("/api/admin/wave/withdrawals", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    withdrawalId,
                    action,
                    adminNotes: notes || undefined,
                    transactionReference: (action === "approve" || action === "complete") ? notes || undefined : undefined,
                }),
            });

            const data = await res.json();
            if (data.success) {
                showToast(`Withdrawal ${action === "complete" ? "marked as completed" : action + "d"} successfully`, "success");
                fetchWithdrawals();
            } else {
                showToast(data.error || `Failed to ${action} withdrawal`, "error");
            }
        } catch {
            showToast(`Failed to ${action} withdrawal`, "error");
        } finally {
            setProcessingId(null);
        }
    };

    const formatCurrency = (amt: number) =>
        new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(amt);



    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">WAVE Withdrawal Requests</h1>
                <p className="text-slate-600">Process member earnings withdrawal requests</p>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-4 mb-6">
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900"
                >
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="approved">Approved</option>
                    <option value="approved_pending_payout">Approved (Pending Payout)</option>
                    <option value="completed">Completed</option>
                    <option value="rejected">Rejected</option>
                    <option value="all">All</option>
                </select>
                <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900"
                >
                    <option value="desc">Newest First</option>
                    <option value="asc">Oldest First</option>
                </select>
            </div>

            {isLoading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                </div>
            )}

            {error && !isLoading && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-red-700">{error}</p>
                </div>
            )}

            {!isLoading && !error && (
                <div className="space-y-4">
                    {withdrawals.length === 0 && (
                        <div className="bg-white rounded-2xl p-12 text-center">
                            <DollarSign className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">No Withdrawal Requests</h3>
                            <p className="text-slate-600">No {statusFilter !== "all" ? statusFilter : ""} withdrawal requests found.</p>
                        </div>
                    )}

                    {withdrawals.map((wd) => (
                        <div key={wd.withdrawalId} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                        <User className="w-6 h-6 text-emerald-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-slate-900 text-lg">{formatCurrency(wd.amount)}</p>
                                        <p className="text-sm text-slate-500">{wd.userEmail || wd.userId}</p>
                                        <p className="text-xs text-slate-400 mt-1">ID: {wd.withdrawalId}</p>
                                        {wd.bankName && (
                                            <p className="text-sm text-slate-600 mt-1">
                                                🏦 {wd.bankName} • {wd.accountNumber ? `****${wd.accountNumber.slice(-4)}` : "—"}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${STATUS_COLORS[wd.status] || ""}`}>
                                    {wd.status}
                                </span>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <Clock className="w-4 h-4" />
                                    Requested: {formatDateTime(wd.requestedAt)}
                                    {wd.processedAt && ` • Processed: ${formatDateTime(wd.processedAt)}`}
                                </div>

                                {wd.status === "pending" && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleAction(wd.withdrawalId, "reject")}
                                            disabled={processingId === wd.withdrawalId}
                                            className="px-4 py-2 rounded-lg border border-red-300 text-red-700 font-semibold hover:bg-red-50 transition disabled:opacity-50 flex items-center gap-2 text-sm"
                                        >
                                            {processingId === wd.withdrawalId ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                            Reject
                                        </button>
                                        <button
                                            onClick={() => handleAction(wd.withdrawalId, "approve")}
                                            disabled={processingId === wd.withdrawalId}
                                            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition disabled:opacity-50 flex items-center gap-2 text-sm"
                                        >
                                            {processingId === wd.withdrawalId ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                            Approve
                                        </button>
                                    </div>
                                )}

                                {wd.status === "approved_pending_payout" && (
                                    <button
                                        onClick={() => handleAction(wd.withdrawalId, "complete")}
                                        disabled={processingId === wd.withdrawalId}
                                        className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2 text-sm"
                                    >
                                        {processingId === wd.withdrawalId ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                        Mark Completed
                                    </button>
                                )}

                                {wd.adminNotes && (
                                    <p className="text-xs text-slate-500 italic">{wd.adminNotes}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Pagination Controls */}
            {withdrawals.length > 0 && !isLoading && !error && (
                <div className="flex items-center justify-between mt-8 p-4 bg-white rounded-2xl shadow-sm border border-slate-100">
                    <span className="text-sm font-medium text-slate-500">Page {pageIndex + 1}</span>
                    <div className="flex gap-2">
                        <button
                            onClick={onPrevPage}
                            disabled={pageIndex === 0 || isLoading}
                            className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
                        >
                            Previous
                        </button>
                        <button
                            onClick={onNextPage}
                            disabled={!hasMore || isLoading}
                            className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition flex items-center gap-2"
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : "Next Page"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
