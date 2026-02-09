"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Wallet,
    Filter,
    Download,
    Loader2,
    CheckCircle,
    XCircle,
    Clock,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";

interface Withdrawal {
    id: string;
    amount: number;
    bankName: string;
    accountNumber: string;
    accountName: string;
    reason: string;
    status: "pending" | "completed" | "rejected";
    requestedAt: any;
    processedAt?: any;
    adminNotes?: string;
}

export default function WithdrawalsHistoryPage() {
    const [loading, setLoading] = useState(true);
    const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
    const [timeFilter, setTimeFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");

    useEffect(() => {
        loadWithdrawals();
    }, []);

    async function loadWithdrawals() {
        setLoading(true);
        try {
            // Get current user (client-side auth check)
            const response = await fetch("/api/auth/session");
            const session = await response.json();

            if (!session?.user?.id) {
                return;
            }

            // Query withdrawals for current user
            const withdrawalsQuery = query(
                collection(db, "withdrawals"),
                where("userId", "==", session.user.id),
                orderBy("createdAt", "desc")
            );

            const snapshot = await getDocs(withdrawalsQuery);
            const data = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                requestedAt: doc.data().createdAt?.toDate() || new Date(),
                processedAt: doc.data().processedAt?.toDate(),
            })) as Withdrawal[];

            setWithdrawals(data);
        } catch (error) {
            console.error("Failed to load withdrawals:", error);
        } finally {
            setLoading(false);
        }
    }

    function formatDate(date: Date) {
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date(date));
    }

    // Apply filters
    const filteredWithdrawals = withdrawals.filter((w) => {
        // Status filter
        if (statusFilter !== "all" && w.status !== statusFilter) return false;

        // Time filter
        if (timeFilter !== "all") {
            const now = new Date();
            const requestDate = new Date(w.requestedAt);
            const daysDiff = Math.floor(
                (now.getTime() - requestDate.getTime()) / (1000 * 60 * 60 * 24)
            );

            if (timeFilter === "7days" && daysDiff > 7) return false;
            if (timeFilter === "30days" && daysDiff > 30) return false;
            if (timeFilter === "year" && daysDiff > 365) return false;
        }

        return true;
    });

    const totalWithdrawn = withdrawals
        .filter((w) => w.status === "completed")
        .reduce((sum, w) => sum + w.amount, 0);

    const pendingCount = withdrawals.filter((w) => w.status === "pending").length;

    const lastWithdrawal = withdrawals.find((w) => w.status === "completed");

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <Link
                        href="/cooperatives"
                        className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-4 transition"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Cooperative
                    </Link>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Withdrawal History
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Track all your withdrawal requests and their status
                    </p>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <Wallet className="w-5 h-5 text-green-600 dark:text-green-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Total Withdrawn
                            </p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {formatCurrency(totalWithdrawn)}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-xl flex items-center justify-center">
                                <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Pending Requests
                            </p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {pendingCount}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Last Withdrawal
                            </p>
                        </div>
                        <p className="text-lg font-bold text-slate-900 dark:text-white">
                            {lastWithdrawal
                                ? formatCurrency(lastWithdrawal.amount)
                                : "None yet"}
                        </p>
                        {lastWithdrawal && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {formatDate(lastWithdrawal.processedAt || lastWithdrawal.requestedAt)}
                            </p>
                        )}
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Time Period
                            </label>
                            <select
                                value={timeFilter}
                                onChange={(e) => setTimeFilter(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600"
                            >
                                <option value="all">All Time</option>
                                <option value="7days">Last 7 Days</option>
                                <option value="30days">Last 30 Days</option>
                                <option value="year">Last Year</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Status
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600"
                            >
                                <option value="all">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="completed">Completed</option>
                                <option value="rejected">Rejected</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Withdrawals Timeline */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-green-600" />
                    </div>
                ) : filteredWithdrawals.length > 0 ? (
                    <div className="space-y-4">
                        {filteredWithdrawals.map((withdrawal) => (
                            <div
                                key={withdrawal.id}
                                className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className={`w-12 h-12 rounded-xl flex items-center justify-center ${withdrawal.status === "completed"
                                                    ? "bg-green-100 dark:bg-green-900/30"
                                                    : withdrawal.status === "pending"
                                                        ? "bg-yellow-100 dark:bg-yellow-900/30"
                                                        : "bg-red-100 dark:bg-red-900/30"
                                                }`}
                                        >
                                            {withdrawal.status === "completed" ? (
                                                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
                                            ) : withdrawal.status === "pending" ? (
                                                <Clock className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                                            ) : (
                                                <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                                                {formatCurrency(withdrawal.amount)}
                                            </h3>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                                {formatDate(withdrawal.requestedAt)}
                                            </p>
                                        </div>
                                    </div>

                                    <span
                                        className={`px-3 py-1 rounded-full text-xs font-semibold ${withdrawal.status === "completed"
                                                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                : withdrawal.status === "pending"
                                                    ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                                    : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                            }`}
                                    >
                                        {withdrawal.status.charAt(0).toUpperCase() +
                                            withdrawal.status.slice(1)}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-slate-500 dark:text-slate-400 mb-1">
                                            Bank Details
                                        </p>
                                        <p className="text-slate-900 dark:text-white font-semibold">
                                            {withdrawal.bankName}
                                        </p>
                                        <p className="text-slate-600 dark:text-slate-400">
                                            {withdrawal.accountNumber} - {withdrawal.accountName}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-slate-500 dark:text-slate-400 mb-1">
                                            Reason
                                        </p>
                                        <p className="text-slate-900 dark:text-white">
                                            {withdrawal.reason}
                                        </p>
                                    </div>
                                </div>

                                {withdrawal.status === "completed" && withdrawal.processedAt && (
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            ✓ Processed on {formatDate(withdrawal.processedAt)}
                                        </p>
                                    </div>
                                )}

                                {withdrawal.status === "rejected" && withdrawal.adminNotes && (
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                        <p className="text-sm text-red-600 dark:text-red-400 font-semibold mb-1">
                                            Rejection Reason:
                                        </p>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            {withdrawal.adminNotes}
                                        </p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-12 text-center">
                        <Filter className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                            No Withdrawals Found
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            {timeFilter !== "all" || statusFilter !== "all"
                                ? "Try adjusting your filters"
                                : "You haven't made any withdrawal requests yet"}
                        </p>
                        <Link
                            href="/cooperatives/withdraw"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
                        >
                            <Wallet className="w-5 h-5" />
                            Request Withdrawal
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
