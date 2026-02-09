/**
 * Export Transactions Page
 * 
 * Transaction history for deposits, investments, and withdrawals
 */

"use client";

import { Calendar, ArrowDownCircle, ArrowUpCircle, Clock } from "lucide-react";

interface Transaction {
    id: string;
    type: "deposit" | "investment" | "return" | "withdrawal";
    description: string;
    amount: number;
    status: "completed" | "pending" | "processing";
    date: string;
}

export default function ExportTransactionsPage() {
    const transactions: Transaction[] = [
        {
            id: "1",
            type: "return",
            description: "Profit from Yam Tubers Export - Phase 1",
            amount: 180000,
            status: "completed",
            date: "2026-02-05",
        },
        {
            id: "2",
            type: "investment",
            description: "Investment in Sesame Seeds Export",
            amount: -750000,
            status: "completed",
            date: "2026-02-01",
        },
        {
            id: "3",
            type: "deposit",
            description: "Account funding via bank transfer",
            amount: 1000000,
            status: "completed",
            date: "2026-01-28",
        },
        {
            id: "4",
            type: "investment",
            description: "Investment in Yam Tubers Export - UK",
            amount: -1000000,
            status: "completed",
            date: "2026-01-15",
        },
        {
            id: "5",
            type: "return",
            description: "Profit from Hibiscus Export - USA - Phase 1",
            amount: 90000,
            status: "pending",
            date: "2026-01-10",
        },
    ];

    const getTransactionIcon = (type: string) => {
        switch (type) {
            case "deposit":
            case "return":
                return <ArrowDownCircle className="w-5 h-5 text-green-600" />;
            case "investment":
            case "withdrawal":
                return <ArrowUpCircle className="w-5 h-5 text-red-600" />;
            default:
                return <Clock className="w-5 h-5 text-slate-400" />;
        }
    };

    const getStatusBadge = (status: string) => {
        const styles = {
            completed: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
            pending: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
            processing: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
        };

        return (
            <span
                className={`px-3 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles]
                    }`}
            >
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Transaction History
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        View all your export investment transactions
                    </p>
                </div>

                {/* Transactions */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="divide-y divide-slate-200 dark:divide-slate-700">
                        {transactions.map((transaction) => (
                            <div
                                key={transaction.id}
                                className="p-6 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-start gap-4 flex-1">
                                        {/* Icon */}
                                        <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                                            {getTransactionIcon(transaction.type)}
                                        </div>

                                        {/* Details */}
                                        <div className="flex-1">
                                            <h3 className="font-semibold text-slate-900 dark:text-white mb-1">
                                                {transaction.description}
                                            </h3>
                                            <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="w-4 h-4" />
                                                    {new Date(transaction.date).toLocaleDateString("en-US", {
                                                        month: "short",
                                                        day: "numeric",
                                                        year: "numeric",
                                                    })}
                                                </div>
                                                <span className="capitalize">{transaction.type}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Amount and Status */}
                                    <div className="text-right flex flex-col items-end gap-2">
                                        <div
                                            className={`text-xl font-bold ${transaction.amount > 0
                                                    ? "text-green-600"
                                                    : "text-red-600"
                                                }`}
                                        >
                                            {transaction.amount > 0 ? "+" : ""}₦
                                            {Math.abs(transaction.amount).toLocaleString()}
                                        </div>
                                        {getStatusBadge(transaction.status)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Empty State (if no transactions) */}
                {transactions.length === 0 && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
                        <Clock className="w-16 h-16 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                            No Transactions Yet
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Your transaction history will appear here once you start investing
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
