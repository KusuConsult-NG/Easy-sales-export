"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    Wallet,
    TrendingUp,
    Calendar,
    DollarSign,
    Loader2,
    Clock,
    ArrowRight,
    Award,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getMembershipAction, getTransactionsAction } from "@/app/actions/cooperative";

export default function MySavingsPage() {
    const [loading, setLoading] = useState(true);
    const [membership, setMembership] = useState<any>(null);
    const [savings, setSavings] = useState<any[]>([]);

    useEffect(() => {
        loadSavings();
    }, []);

    async function loadSavings() {
        setLoading(true);
        try {
            const [membershipResult, transactionsResult] = await Promise.all([
                getMembershipAction(),
                getTransactionsAction(),
            ]);

            if (membershipResult.success && membershipResult.data) {
                setMembership(membershipResult.data);
            }

            if (transactionsResult.success && transactionsResult.data) {
                // Filter for fixed savings transactions
                const savingsTxns = transactionsResult.data.filter(
                    (t: any) => t.type === "fixed_savings" && t.status === "completed"
                );

                // Group by savings plan (mock - would need actual savings plans)
                setSavings([
                    {
                        id: "1",
                        name: "Monthly Fixed Savings",
                        type: "fixed",
                        balance: 450000,
                        interestRate: 8,
                        startDate: new Date("2025-01-01"),
                        maturityDate: new Date("2026-01-01"),
                        monthlyContribution: 50000,
                        status: "active",
                    },
                    {
                        id: "2",
                        name: "Target Savings",
                        type: "target",
                        balance: 200000,
                        targetAmount: 500000,
                        interestRate: 6,
                        startDate: new Date("2025-06-01"),
                        maturityDate: new Date("2026-06-01"),
                        monthlyContribution: 25000,
                        status: "active",
                    },
                ]);
            }
        } catch (error) {
            console.error("Failed to load savings:", error);
        } finally {
            setLoading(false);
        }
    }

    function formatDate(date: Date) {
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "long",
            day: "numeric",
        }).format(new Date(date));
    }

    function getDaysToMaturity(maturityDate: Date) {
        const now = new Date();
        const maturity = new Date(maturityDate);
        const days = Math.floor((maturity.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return days > 0 ? days : 0;
    }

    const totalSavings = savings.reduce((sum, s) => sum + s.balance, 0);
    const totalInterest = savings.reduce(
        (sum, s) => sum + (s.balance * s.interestRate) / 100,
        0
    );

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        My Savings
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Track your savings plans and interest earnings
                    </p>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-linear-to-br from-green-600 to-emerald-600 text-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <Wallet className="w-8 h-8" />
                        </div>
                        <p className="text-sm text-green-100 mb-1">Total Savings</p>
                        <p className="text-3xl font-bold">{formatCurrency(totalSavings)}</p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Interest Earned</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {formatCurrency(totalInterest)}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <Award className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Active Plans</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {savings.length}
                        </p>
                    </div>
                </div>

                {/* Savings Plans */}
                {savings.length > 0 ? (
                    <div className="space-y-6">
                        {savings.map((plan) => {
                            const daysToMaturity = getDaysToMaturity(plan.maturityDate);
                            const monthsActive = Math.floor(
                                (new Date().getTime() - new Date(plan.startDate).getTime()) /
                                (1000 * 60 * 60 * 24 * 30)
                            );
                            const progress = plan.targetAmount
                                ? (plan.balance / plan.targetAmount) * 100
                                : 100;

                            return (
                                <div
                                    key={plan.id}
                                    className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden"
                                >
                                    {/* Plan Header */}
                                    <div className="bg-linear-to-r from-green-600 to-emerald-600 text-white p-6">
                                        <div className="flex items-start justify-between mb-4">
                                            <div>
                                                <h3 className="text-2xl font-bold mb-1">{plan.name}</h3>
                                                <p className="text-green-100 capitalize">{plan.type} Savings Plan</p>
                                            </div>
                                            <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-semibold">
                                                {plan.status}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-sm text-green-100 mb-1">Current Balance</p>
                                                <p className="text-2xl font-bold">{formatCurrency(plan.balance)}</p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-green-100 mb-1">Interest Rate</p>
                                                <p className="text-2xl font-bold">{plan.interestRate}% APR</p>
                                            </div>
                                        </div>

                                        {plan.targetAmount && (
                                            <div className="mt-4">
                                                <div className="flex items-center justify-between text-sm mb-2">
                                                    <span>Progress to Target</span>
                                                    <span>
                                                        {formatCurrency(plan.balance)} / {formatCurrency(plan.targetAmount)}
                                                    </span>
                                                </div>
                                                <div className="w-full bg-green-800 rounded-full h-3">
                                                    <div
                                                        className="bg-white rounded-full h-3 transition-all"
                                                        style={{ width: `${Math.min(progress, 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Plan Details */}
                                    <div className="p-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                            <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center shrink-0">
                                                    <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900 dark:text-white mb-1">
                                                        Started
                                                    </p>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                                        {formatDate(plan.startDate)}
                                                    </p>
                                                    <p className="text-xs text-slate-500 mt-1">
                                                        {monthsActive} months ago
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center shrink-0">
                                                    <Clock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900 dark:text-white mb-1">
                                                        Maturity Date
                                                    </p>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                                        {formatDate(plan.maturityDate)}
                                                    </p>
                                                    <p className="text-xs text-slate-500 mt-1">
                                                        {daysToMaturity} days remaining
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center shrink-0">
                                                    <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900 dark:text-white mb-1">
                                                        Monthly Contribution
                                                    </p>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                                        {formatCurrency(plan.monthlyContribution)}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center shrink-0">
                                                    <TrendingUp className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900 dark:text-white mb-1">
                                                        Projected Interest
                                                    </p>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                                        {formatCurrency((plan.balance * plan.interestRate) / 100)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {daysToMaturity > 0 && (
                                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                                                <p className="text-sm text-slate-700 dark:text-slate-300">
                                                    💡 <strong>Tip:</strong> Your savings will mature in {daysToMaturity}{" "}
                                                    days. Continue contributing monthly to maximize your returns!
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-12 text-center">
                        <Wallet className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                            No Savings Plans Yet
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            Start saving today and earn competitive interest rates
                        </p>
                        <Link
                            href="/cooperatives/fixed-savings"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
                        >
                            Create Savings Plan
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
