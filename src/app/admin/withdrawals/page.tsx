"use client";

import { useState, useEffect } from "react";
import { Wallet, CheckCircle, XCircle, Loader2, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
    getPendingWithdrawalsAction,
    processWithdrawalAction
} from "@/app/actions/admin";

interface WithdrawalRequest {
    id: string;
    userId: string;
    userName: string;
    cooperativeId: string;
    amount: number;
    bankAccount: string;
    reason?: string;
    status: "pending" | "completed" | "rejected";
    createdAt: Date;
}

export default function AdminWithdrawalsPage() {
    const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        fetchWithdrawals();
    }, []);

    const fetchWithdrawals = async () => {
        setIsLoading(true);
        setError(null);

        const result = await getPendingWithdrawalsAction();

        if (result.success && result.data) {
            setWithdrawals(result.data);
        } else {
            setError(result.error || "Failed to load withdrawal requests");
        }

        setIsLoading(false);
    };

    const handleApprove = async (withdrawalId: string) => {
        const notes = prompt("Optional admin notes:");

        setProcessingId(withdrawalId);
        const result = await processWithdrawalAction(withdrawalId, "approve", notes || undefined);

        if (result.success) {
            fetchWithdrawals(); // Refresh list
        } else {
            alert(result.error);
        }

        setProcessingId(null);
    };

    const handleReject = async (withdrawalId: string) => {
        const notes = prompt("Enter rejection reason:");
        if (!notes) return;

        setProcessingId(withdrawalId);
        const result = await processWithdrawalAction(withdrawalId, "reject", notes);

        if (result.success) {
            fetchWithdrawals(); // Refresh list
        } else {
            alert(result.error);
        }

        setProcessingId(null);
    };

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(date));
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Withdrawal Requests
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Review and process pending cooperative withdrawal requests
                </p>
            </div>

            {/* Summary Card */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 mb-6 elevation-2">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Pending Requests</p>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {withdrawals.length}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Total Amount</p>
                        <p className="text-3xl font-bold text-primary">
                            {formatCurrency(withdrawals.reduce((sum, w) => sum + w.amount, 0))}
                        </p>
                    </div>
                </div>
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            )}

            {/* Error State */}
            {error && !isLoading && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-red-300">{error}</p>
                </div>
            )}

            {/* Withdrawals List */}
            {!isLoading && !error && (
                <div className="space-y-4">
                    {withdrawals.map((withdrawal) => (
                        <div
                            key={withdrawal.id}
                            className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                        <Wallet className="w-6 h-6 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                            {withdrawal.userName}
                                        </h3>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            User ID: {withdrawal.userId}
                                        </p>
                                        {withdrawal.reason && (
                                            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
                                                <span className="font-semibold">Reason:</span> {withdrawal.reason}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                        {formatCurrency(withdrawal.amount)}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        {withdrawal.bankAccount}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Requested: {formatDate(withdrawal.createdAt)}
                                </p>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleReject(withdrawal.id)}
                                        disabled={processingId === withdrawal.id}
                                        className="px-4 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-700 dark:text-red-400 font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {processingId === withdrawal.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <XCircle className="w-4 h-4" />
                                        )}
                                        Reject
                                    </button>
                                    <button
                                        onClick={() => handleApprove(withdrawal.id)}
                                        disabled={processingId === withdrawal.id}
                                        className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {processingId === withdrawal.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <CheckCircle className="w-4 h-4" />
                                        )}
                                        Approve & Process
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}

                    {withdrawals.length === 0 && (
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center">
                            <Wallet className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                No Pending Withdrawals
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400">
                                All withdrawal requests have been processed
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
