/**
 * Cooperative Member Dashboard
 * 
 * Central hub for cooperative members
 */

"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import Link from "next/link";
import {
    Wallet,
    TrendingUp,
    CreditCard,
    ArrowRight,
    Award,
    PlusCircle,
    ArrowDownLeft,
    History as HistoryIcon,
    DollarSign,
    Clock,
    IdCard,
    ChevronLeft,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

import { getDashboardDataAction } from "@/app/actions/cooperative";
import type { CooperativeMembership, CooperativeTransaction } from "@/lib/types/cooperative";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export default function CooperativeDashboardPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);

    const isDedicatedCoop = typeof window !== "undefined" && (
        window.location.hostname.replace(/^www\./, "").toLowerCase() === "easysalescooperative.com" ||
        window.location.hostname.replace(/^www\./, "").toLowerCase().endsWith(".easysalescooperative.com")
    );
    const prefix = isDedicatedCoop ? "" : "/cooperatives";
    const hubUrl = isDedicatedCoop ? "https://www.easysalesexport.com/dashboard" : "/dashboard";
    const [error, setError] = useState<string | null>(null);
    const [membership, setMembership] = useState<CooperativeMembership | null>(null);
    const [transactions, setTransactions] = useState<CooperativeTransaction[]>([]);

    const { data: sessionData } = useSession();
    const userId = (sessionData?.user as any)?.id;

    useEffect(() => {
        // Always attempt to load data when the user is confirmed authenticated.
        // The server action (getDashboardDataAction) has its own multi-fallback
        // queries — don't pre-block it here based on a client-side hook that may
        // lag behind Firestore or have a stale session status.
        if (userId) {
            loadData();
        }
    }, [userId]);

    async function loadData() {
        try {
            setLoading(true);
            const result = await getDashboardDataAction();
            if (result.success && result.data) {
                setMembership(result.data.membership);
                setTransactions(result.data.transactions);
            } else {
                setError(result.error);
            }
        } catch (error) {
            logger.error("Failed to load cooperative dashboard data", error);
            setError("Failed to load dashboard data. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    const getActivityIcon = (type: string) => {
        switch (type) {
            case "contribution":
                return <PlusCircle className="w-5 h-5 text-green-600" />;
            case "interest":
                return <TrendingUp className="w-5 h-5 text-blue-600" />;
            case "loan_payment":
                return <CreditCard className="w-5 h-5 text-purple-600" />;
            default:
                return <DollarSign className="w-5 h-5 text-slate-600" />;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-600">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    if (!membership) {
        // Differentiate: if we have a real error message it's a fetch failure.
        // If error is null it means the server action returned no membership doc
        // (user registered but data not yet visible) — show pending state, not error.
        const isPending = !error || error.toLowerCase().includes("no cooperative membership");
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                {isPending ? (
                    <>
                        <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
                            <Clock className="w-8 h-8 text-purple-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-900">Membership Pending Approval</h1>
                        <p className="text-slate-600 text-center max-w-md">
                            Your registration has been received and is currently being reviewed by our admin team. You will be notified once approved.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all"
                        >
                            Refresh Status
                        </button>
                    </>
                ) : (
                    <>
                        <h1 className="text-2xl font-bold text-slate-900">Account Access Issue</h1>
                        <p className="text-slate-600 text-center max-w-md">
                            We couldn&apos;t load your cooperative profile. This usually happens if your registration is still being processed or there was a system error.
                        </p>
                        <div className="flex flex-col items-center gap-4">
                            <Link
                                href={`${prefix}/onboarding`}
                                className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all"
                            >
                                Complete Registration
                            </Link>
                            <button
                                onClick={() => window.location.reload()}
                                className="text-sm text-purple-600 hover:underline"
                            >
                                Retry Loading
                            </button>
                        </div>
                    </>
                )}
            </div>
        );
    }


    // Derived Financial Data
    const totalSavings = membership.savingsBalance;
    const activeLoans = membership.loanBalance;
    const availableLoanLimit = totalSavings * 3;
    const interestEarned = transactions
        .filter(t => t.type === 'interest')
        .reduce((sum, t) => sum + t.amount, 0);


    return (
        <div className="space-y-8">
            {/* Back to Hub Link */}
            <div className="-mb-4">
                <Link
                    href={hubUrl}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-purple-600 hover:text-purple-700 transition"
                >
                    <ChevronLeft className="w-4 h-4" />
                    Back to Dashboard
                </Link>
            </div>

            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    Welcome Back!
                </h1>
                <p className="text-slate-600">
                    Here's your cooperative summary
                </p>
            </div>

            {/* Membership Info Card */}
            <div className="bg-linear-to-br from-purple-600 to-pink-600 rounded-2xl p-6 text-white shadow-xl">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <p className="text-purple-100 mb-1">Membership ID</p>
                        <p className="text-2xl font-bold truncate max-w-[200px]">{`ESE-COOP-${membership.id.slice(-4).toUpperCase()}`}</p>
                    </div>
                    <div className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full">
                        <span className="font-semibold capitalize">{membership.membershipTier}</span>
                    </div>
                </div>
                <div>
                    <p className="text-purple-100 text-sm mb-1">Membership Status</p>
                    <p className="font-semibold capitalize">{membership.membershipStatus}</p>
                </div>
            </div>

            {/* Financial Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white rounded-2xl p-6 shadow-lg" data-testid="stat-card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                            <Wallet className="w-6 h-6 text-green-600" />
                        </div>
                    </div>
                    <p className="text-sm text-slate-600 mb-1">Total Savings</p>
                    <p className="text-2xl font-bold text-slate-900">
                        {formatCurrency(totalSavings)}
                    </p>
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-lg" data-testid="stat-card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                            <CreditCard className="w-6 h-6 text-purple-600" />
                        </div>
                    </div>
                    <p className="text-sm text-slate-600 mb-1">Active Loans</p>
                    <p className="text-2xl font-bold text-slate-900">
                        {formatCurrency(activeLoans)}
                    </p>
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-lg" data-testid="stat-card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                    <p className="text-sm text-slate-600 mb-1">Loan Limit</p>
                    <p className="text-2xl font-bold text-slate-900">
                        {formatCurrency(availableLoanLimit)}
                    </p>
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-lg" data-testid="stat-card">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                            <Award className="w-6 h-6 text-orange-600" />
                        </div>
                    </div>
                    <p className="text-sm text-slate-600 mb-1">Interest Earned</p>
                    <p className="text-2xl font-bold text-slate-900">
                        {formatCurrency(interestEarned)}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Quick Actions */}
                <div className="lg:col-span-1">
                    <h2 className="text-xl font-bold text-slate-900 mb-4">
                        Quick Actions
                    </h2>
                    <div className="space-y-3">
                        <Link
                            href={`${prefix}/contribute`}
                            className="flex items-center justify-between p-4 bg-white rounded-xl shadow-lg hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                    <PlusCircle className="w-5 h-5 text-green-600" />
                                </div>
                                <span className="font-semibold text-slate-900">Contribute</span>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-green-600 group-hover:translate-x-1 transition-all" />
                        </Link>

                        <Link
                            href={`${prefix}/loans`}
                            className="flex items-center justify-between p-4 bg-white rounded-xl shadow-lg hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                    <TrendingUp className="w-5 h-5 text-blue-600" />
                                </div>
                                <span className="font-semibold text-slate-900">Apply for Loan</span>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                        </Link>

                        <Link
                            href={`${prefix}/withdrawals`}
                            className="flex items-center justify-between p-4 bg-white rounded-xl shadow-lg hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                    <ArrowDownLeft className="w-5 h-5 text-purple-600" />
                                </div>
                                <span className="font-semibold text-slate-900">Withdraw</span>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
                        </Link>

                        <Link
                            href={`${prefix}/history`}
                            className="flex items-center justify-between p-4 bg-white rounded-xl shadow-lg hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                                    <HistoryIcon className="w-5 h-5 text-orange-600" />
                                </div>
                                <span className="font-semibold text-slate-900">View Statement</span>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-orange-600 group-hover:translate-x-1 transition-all" />
                        </Link>

                        <Link
                            href={`${prefix}/id-card`}
                            className="flex items-center justify-between p-4 bg-linear-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl shadow-lg hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                    <IdCard className="w-5 h-5 text-purple-600" />
                                </div>
                                <div>
                                    <span className="font-semibold text-slate-900 block">My Membership ID</span>
                                    <span className="text-xs text-purple-600">Download for printing</span>
                                </div>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
                        </Link>
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="lg:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-slate-900">
                            Recent Activity
                        </h2>
                        <Link
                            href={`${prefix}/history`}
                            className="text-purple-600 hover:text-purple-700 font-semibold text-sm"
                        >
                            View All
                        </Link>
                    </div>
                    <div className="bg-white rounded-2xl shadow-lg divide-y divide-slate-200">
                        {transactions.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">
                                No recent activity
                            </div>
                        ) : (
                            transactions.map((activity) => (
                                <div key={activity.id} className="p-4 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                                            {getActivityIcon(activity.type)}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900">
                                                {activity.description || "Transaction"}
                                            </p>
                                            <p className="text-sm text-slate-600">
                                                {formatDate(activity.date)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className={`font-bold ${activity.amount > 0
                                            ? "text-green-600"
                                            : "text-red-600"
                                            }`}>
                                            {activity.amount > 0 ? "+" : ""}
                                            {formatCurrency(Math.abs(activity.amount))}
                                        </p>
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full capitalize">
                                            {activity.status}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
