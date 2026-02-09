/**
 * Cooperative Member Dashboard
 * 
 * Central hub for cooperative members
 */

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    Wallet,
    TrendingUp,
    CreditCard,
    Calendar,
    ArrowRight,
    Award,
    PlusCircle,
    ArrowDownLeft,
    History as HistoryIcon,
    DollarSign,
    Clock,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

import { getMembershipAction, getTransactionsAction } from "@/app/actions/cooperative";
import type { CooperativeMembership, CooperativeTransaction } from "@/lib/types/cooperative";
import { useRouter } from "next/navigation";

export default function CooperativeDashboardPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [membership, setMembership] = useState<CooperativeMembership | null>(null);
    const [transactions, setTransactions] = useState<CooperativeTransaction[]>([]);

    useEffect(() => {
        async function loadData() {
            try {
                const [membershipRes, transactionsRes] = await Promise.all([
                    getMembershipAction(),
                    getTransactionsAction()
                ]);

                if (membershipRes.success && membershipRes.data) {
                    setMembership(membershipRes.data);
                } else if (membershipRes.error?.includes("no cooperative")) {
                    // Redirect to onboarding if not a member?
                    // For now, let's show a "Join Cooperative" state or just handle null
                }

                if (transactionsRes.success && transactionsRes.data) {
                    setTransactions(transactionsRes.data);
                }
            } catch (error) {
                console.error("Failed to load dashboard data:", error);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, []);

    const formatDate = (date: Date | string) => {
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "long",
            day: "numeric",
        }).format(new Date(date));
    };

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
                    <p className="text-slate-600 dark:text-slate-400">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    if (!membership) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Not a Member Yet?</h1>
                <p className="text-slate-600 dark:text-slate-400 text-center max-w-md">
                    Join a cooperative today to access savings, loans, and investment opportunities.
                </p>
                <Link
                    href="/cooperatives/onboarding"
                    className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all"
                >
                    Join Cooperative
                </Link>
            </div>
        );
    }

    // Derived Financial Data
    const totalSavings = membership.savingsBalance;
    const activeLoans = membership.loanBalance;
    const availableLoanLimit = totalSavings * 3;
    const interestEarned = transactions
        .filter(t => t.type === 'interest') // Assuming 'interest' type exists or we strictly mock it as 0
        .reduce((sum, t) => sum + t.amount, 0);

    // Mock Next Payment (since we don't have a schedule DB yet)
    const nextPaymentDue = new Date();
    nextPaymentDue.setMonth(nextPaymentDue.getMonth() + 1);
    nextPaymentDue.setDate(1); // 1st of next month
    const contributionAmount = membership.monthlyTarget;


    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Welcome Back!
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Here's your cooperative summary
                </p>
            </div>

            {/* Membership Info Card */}
            <div className="bg-linear-to-br from-purple-600 to-pink-600 rounded-2xl p-6 text-white shadow-xl">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <p className="text-purple-100 mb-1">Membership ID</p>
                        <p className="text-2xl font-bold truncate max-w-[200px]">{membership.id}</p>
                    </div>
                    <div className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full">
                        <span className="font-semibold capitalize">{membership.membershipTier}</span>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-purple-100 text-sm mb-1">Member Since</p>
                        <p className="font-semibold">{formatDate(membership.memberSince)}</p>
                    </div>
                    <div>
                        <p className="text-purple-100 text-sm mb-1">Next Payment</p>
                        <p className="font-semibold">{formatDate(nextPaymentDue)}</p>
                    </div>
                </div>
            </div>

            {/* Financial Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                            <Wallet className="w-6 h-6 text-green-600" />
                        </div>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Total Savings</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {formatCurrency(totalSavings)}
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                            <CreditCard className="w-6 h-6 text-purple-600" />
                        </div>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Active Loans</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {formatCurrency(activeLoans)}
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                            <TrendingUp className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Loan Limit</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {formatCurrency(availableLoanLimit)}
                    </p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                            <Award className="w-6 h-6 text-orange-600" />
                        </div>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Interest Earned</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {formatCurrency(interestEarned)}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Quick Actions */}
                <div className="lg:col-span-1">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                        Quick Actions
                    </h2>
                    <div className="space-y-3">
                        <Link
                            href="/cooperatives/contribute"
                            className="flex items-center justify-between p-4 bg-white dark:bg-slate-800 rounded-xl shadow-lg hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                                    <PlusCircle className="w-5 h-5 text-green-600" />
                                </div>
                                <span className="font-semibold text-slate-900 dark:text-white">Contribute</span>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-green-600 group-hover:translate-x-1 transition-all" />
                        </Link>

                        <Link
                            href="/cooperatives/loans"
                            className="flex items-center justify-between p-4 bg-white dark:bg-slate-800 rounded-xl shadow-lg hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                                    <TrendingUp className="w-5 h-5 text-blue-600" />
                                </div>
                                <span className="font-semibold text-slate-900 dark:text-white">Apply for Loan</span>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                        </Link>

                        <Link
                            href="/cooperatives/withdrawals"
                            className="flex items-center justify-between p-4 bg-white dark:bg-slate-800 rounded-xl shadow-lg hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                                    <ArrowDownLeft className="w-5 h-5 text-purple-600" />
                                </div>
                                <span className="font-semibold text-slate-900 dark:text-white">Withdraw</span>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
                        </Link>

                        <Link
                            href="/cooperatives/history"
                            className="flex items-center justify-between p-4 bg-white dark:bg-slate-800 rounded-xl shadow-lg hover:shadow-xl transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
                                    <HistoryIcon className="w-5 h-5 text-orange-600" />
                                </div>
                                <span className="font-semibold text-slate-900 dark:text-white">View Statement</span>
                            </div>
                            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-orange-600 group-hover:translate-x-1 transition-all" />
                        </Link>
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="lg:col-span-2">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                            Recent Activity
                        </h2>
                        <Link
                            href="/cooperatives/history"
                            className="text-purple-600 hover:text-purple-700 font-semibold text-sm"
                        >
                            View All
                        </Link>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg divide-y divide-slate-200 dark:divide-slate-700">
                        {transactions.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">
                                No recent activity
                            </div>
                        ) : (
                            transactions.map((activity) => (
                                <div key={activity.id} className="p-4 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center">
                                            {getActivityIcon(activity.type)}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-white">
                                                {activity.description || "Transaction"}
                                            </p>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">
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
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-semibold rounded-full capitalize">
                                            {activity.status}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Next Payment Alert */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
                        <Calendar className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold text-blue-900 dark:text-blue-200 mb-1">
                            Next Payment Due
                        </h3>
                        <p className="text-blue-800 dark:text-blue-300 mb-3">
                            Your next monthly contribution of{" "}
                            <span className="font-bold">{formatCurrency(contributionAmount)}</span>{" "}
                            is due on {formatDate(nextPaymentDue)}.
                        </p>
                        <Link
                            href="/cooperatives/contribute"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                        >
                            Pay Now
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
