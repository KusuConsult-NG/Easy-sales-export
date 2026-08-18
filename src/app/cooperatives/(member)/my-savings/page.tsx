"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
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
import BackButton from "@/components/ui/BackButton";

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
            const [membershipResult, savingsResponse] = await Promise.all([
                getMembershipAction(),
                fetch("/api/cooperative/fixed-savings"),
            ]);

            if (membershipResult.success && membershipResult.data?.membership) {
                setMembership(membershipResult.data.membership);
            }

            if (savingsResponse.ok) {
                const savingsData = await savingsResponse.json();
                if (savingsData.success && savingsData.plans) {
                    // Transform API response to component format
                    const transformedPlans = savingsData.plans.map((plan: any) => ({
                        id: plan.id,
                        name: `Fixed Savings Plan - ${plan.durationMonths} months`,
                        type: "fixed",
                        balance: plan.amount,
                        interestRate: plan.interestRate,
                        // The interest the SERVER computed and stored, pro-rated
                        // over the plan's term. See below for why this page must
                        // not work it out for itself.
                        projectedProfit: Number(plan.projectedProfit) || 0,
                        startDate: new Date(plan.startDate),
                        maturityDate: new Date(plan.maturityDate),
                        durationMonths: plan.durationMonths,
                        status: plan.status,
                        targetAmount: null, // Fixed savings don't have targets
                    }));
                    setSavings(transformedPlans);
                } else {
                    setSavings([]);
                }
            } else {
                setSavings([]);
            }
        } catch (error) {
            logger.error("Failed to load savings:", error);
            setSavings([]);
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
    // A FULL YEAR'S INTEREST, WHATEVER THE TERM.
    //
    // This was `balance * interestRate / 100`. interestRate on a fixed savings
    // plan is FIXED_SAVINGS_ANNUAL_RATE — a rate PER YEAR, and the one field in
    // this codebase that is, which is why cooperative-savings.ts carries a
    // header warning that "a bare percentage next to this number is what makes
    // the mistake possible".
    //
    // So a three-month plan of ₦100,000 was shown ₦14,000 of interest against a
    // real projected profit of ₦3,500 — overstated four times. The sibling page
    // /cooperatives/fixed-savings renders the stored projectedProfit and gets it
    // right, so one member saw two different figures for the same plans on two
    // screens.
    //
    // The server already computes this, with projectedFixedSavingsProfit, and
    // stores it on the plan. Reading it is the fix: a figure a member is shown
    // and a figure the cooperative pays must come from one calculation.
    const totalInterest = savings.reduce((sum, s) => sum + s.projectedProfit, 0);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <BackButton fallbackPath="/cooperatives/dashboard" />
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        My Savings
                    </h1>
                    <p className="text-slate-600">
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

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-blue-600" />
                            </div>
                            <p className="text-sm text-slate-600">Interest Earned</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">
                            {formatCurrency(totalInterest)}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                                <Award className="w-5 h-5 text-purple-600" />
                            </div>
                            <p className="text-sm text-slate-600">Active Plans</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">
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
                                    className="bg-white rounded-2xl shadow-lg overflow-hidden"
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
                                                <p className="text-2xl font-bold">{plan.interestRate}% p.a.</p>
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
                                                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                                                    <Calendar className="w-5 h-5 text-blue-600" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900 mb-1">
                                                        Started
                                                    </p>
                                                    <p className="text-sm text-slate-600">
                                                        {formatDate(plan.startDate)}
                                                    </p>
                                                    <p className="text-xs text-slate-500 mt-1">
                                                        {monthsActive} months ago
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center shrink-0">
                                                    <Clock className="w-5 h-5 text-purple-600" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900 mb-1">
                                                        Maturity Date
                                                    </p>
                                                    <p className="text-sm text-slate-600">
                                                        {formatDate(plan.maturityDate)}
                                                    </p>
                                                    <p className="text-xs text-slate-500 mt-1">
                                                        {daysToMaturity} days remaining
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center shrink-0">
                                                    <DollarSign className="w-5 h-5 text-green-600" />
                                                </div>
                                                <div>
                                                    {/*
                                                      * Was "Monthly Contribution",
                                                      * showing amount / durationMonths.
                                                      * A fixed savings plan is a lump
                                                      * sum locked away — the member
                                                      * paid the whole amount once and
                                                      * owes nothing monthly — so this
                                                      * told them they were contributing
                                                      * ₦33,333 a month against a
                                                      * ₦100,000 plan they had already
                                                      * paid in full.
                                                      */}
                                                    <p className="font-semibold text-slate-900 mb-1">
                                                        Amount Locked
                                                    </p>
                                                    <p className="text-sm text-slate-600">
                                                        {formatCurrency(plan.balance)} for {plan.durationMonths} months
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-start gap-3">
                                                <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center shrink-0">
                                                    <TrendingUp className="w-5 h-5 text-orange-600" />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900 mb-1">
                                                        Projected Interest
                                                    </p>
                                                    <p className="text-sm text-slate-600">
                                                        {formatCurrency(plan.projectedProfit)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {daysToMaturity > 0 && (
                                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                                <p className="text-sm text-slate-900">
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
                    <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
                        <Wallet className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 mb-2">
                            No Savings Plans Yet
                        </h3>
                        <p className="text-slate-600 mb-6">
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
