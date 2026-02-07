"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    Wallet,
    TrendingUp,
    DollarSign,
    ArrowRight,
    Clock,
    Loader2,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getCooperativeQuickStats } from "@/lib/cooperative-utils";

export default function CooperativeWidget() {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadStats();
    }, []);

    async function loadStats() {
        setLoading(true);
        try {
            const result = await getCooperativeQuickStats();
            if (result.success && result.data) {
                setStats(result.data);
            } else {
                setError(result.error || "Not a cooperative member");
            }
        } catch (err) {
            setError("Failed to load cooperative data");
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin text-green-600" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Cooperative Savings
                    </h3>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                    Join the cooperative to start saving and access loans
                </p>
                <Link
                    href="/cooperatives/register"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition text-sm"
                >
                    Join Cooperative
                    <ArrowRight className="w-4 h-4" />
                </Link>
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-br from-green-600 to-emerald-600 text-white rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Cooperative Savings</h3>
                <Wallet className="w-6 h-6 opacity-80" />
            </div>

            {/* Savings Balance */}
            <div className="mb-4">
                <p className="text-sm text-green-100 mb-1">Savings Balance</p>
                <p className="text-3xl font-bold">{formatCurrency(stats.savingsBalance)}</p>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-white/10 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <TrendingUp className="w-4 h-4" />
                        <p className="text-xs text-green-100">Available Credit</p>
                    </div>
                    <p className="text-lg font-bold">{formatCurrency(stats.availableCredit)}</p>
                </div>

                <div className="bg-white/10 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="w-4 h-4" />
                        <p className="text-xs text-green-100">Loan Balance</p>
                    </div>
                    <p className="text-lg font-bold">{formatCurrency(stats.loanBalance)}</p>
                </div>
            </div>

            {/* Next Payment Alert */}
            {stats.nextPaymentDate && (
                <div className="bg-yellow-500/20 border border-yellow-400/30 rounded-lg p-3 mb-4">
                    <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-yellow-200" />
                        <p className="text-xs text-yellow-100 font-semibold">Next Payment Due</p>
                    </div>
                    <p className="text-sm">
                        {new Date(stats.nextPaymentDate).toLocaleDateString()} -{" "}
                        {formatCurrency(stats.nextPaymentAmount)}
                    </p>
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
                <Link
                    href="/cooperatives/contribute"
                    className="flex-1 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg font-semibold text-sm text-center transition"
                >
                    Contribute
                </Link>
                <Link
                    href="/cooperatives"
                    className="flex-1 px-4 py-2 bg-white text-green-600 hover:bg-green-50 rounded-lg font-semibold text-sm text-center transition"
                >
                    View Details
                </Link>
            </div>
        </div>
    );
}
