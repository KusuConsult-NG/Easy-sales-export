"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    DollarSign,
    Calendar,
    Clock,
    TrendingUp,
    AlertCircle,
    CheckCircle,
    Loader2,
    ArrowRight,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getMembershipAction } from "@/app/actions/cooperative";

export default function MyLoansPage() {
    const [loading, setLoading] = useState(true);
    const [membership, setMembership] = useState<any>(null);
    const [loans, setLoans] = useState<any[]>([]);

    useEffect(() => {
        loadLoans();
    }, []);

    async function loadLoans() {
        setLoading(true);
        try {
            const result = await getMembershipAction();
            if (result.success && result.data) {
                setMembership(result.data);
                // TODO: Fetch actual loans from cooperative_loans collection
                // For now using mock data
                setLoans([
                    {
                        id: "1",
                        amount: 500000,
                        balance: 350000,
                        interestRate: 5,
                        duration: 12,
                        startDate: new Date("2025-06-01"),
                        status: "disbursed",
                        nextPaymentDate: new Date("2026-03-01"),
                        nextPaymentAmount: 45000,
                        repaymentSchedule: [
                            { date: new Date("2025-07-01"), amount: 45000, paid: true },
                            { date: new Date("2025-08-01"), amount: 45000, paid: true },
                            { date: new Date("2025-09-01"), amount: 45000, paid: true },
                            { date: new Date("2026-01-01"), amount: 45000, paid: true },
                            { date: new Date("2026-02-01"), amount: 45000, paid: false },
                            { date: new Date("2026-03-01"), amount: 45000, paid: false },
                        ],
                    },
                ]);
            }
        } catch (error) {
            console.error("Failed to load loans:", error);
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

    const activeLoans = loans.filter((l) => l.status === "disbursed");
    const totalBalance = activeLoans.reduce((sum, l) => sum + l.balance, 0);
    const totalBorrowed = activeLoans.reduce((sum, l) => sum + l.amount, 0);

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        My Loans
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Track your loan balances and repayment schedule
                    </p>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-linear-to-br from-blue-600 to-indigo-600 text-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <DollarSign className="w-8 h-8" />
                        </div>
                        <p className="text-sm text-blue-100 mb-1">Total Outstanding</p>
                        <p className="text-3xl font-bold">{formatCurrency(totalBalance)}</p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Total Borrowed</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {formatCurrency(totalBorrowed)}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Active Loans</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {activeLoans.length}
                        </p>
                    </div>
                </div>

                {/* Active Loans */}
                {activeLoans.length > 0 ? (
                    <div className="space-y-6">
                        {activeLoans.map((loan) => {
                            const paidPayments = loan.repaymentSchedule.filter((p: any) => p.paid).length;
                            const totalPayments = loan.repaymentSchedule.length;
                            const progress = (paidPayments / totalPayments) * 100;

                            return (
                                <div key={loan.id} className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden">
                                    {/* Loan Header */}
                                    <div className="bg-linear-to-r from-blue-600 to-indigo-600 text-white p-6">
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h3 className="text-2xl font-bold mb-1">
                                                    {formatCurrency(loan.amount)}
                                                </h3>
                                                <p className="text-blue-100">
                                                    Disbursed on {formatDate(loan.startDate)}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm text-blue-100 mb-1">Balance</p>
                                                <p className="text-2xl font-bold">{formatCurrency(loan.balance)}</p>
                                            </div>
                                        </div>

                                        {/* Progress Bar */}
                                        <div className="mb-3">
                                            <div className="flex items-center justify-between text-sm mb-2">
                                                <span>Repayment Progress</span>
                                                <span>{paidPayments}/{totalPayments} payments</span>
                                            </div>
                                            <div className="w-full bg-blue-800 rounded-full h-3">
                                                <div
                                                    className="bg-white rounded-full h-3 transition-all"
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-6 text-sm">
                                            <div>
                                                <span className="text-blue-100">Rate:</span>{" "}
                                                <span className="font-semibold">{loan.interestRate}%</span>
                                            </div>
                                            <div>
                                                <span className="text-blue-100">Duration:</span>{" "}
                                                <span className="font-semibold">{loan.duration} months</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Next Payment Alert */}
                                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 p-4">
                                        <div className="flex items-center gap-3">
                                            <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                                            <div className="flex-1">
                                                <p className="font-semibold text-slate-900 dark:text-white">
                                                    Next Payment Due
                                                </p>
                                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                                    {formatDate(loan.nextPaymentDate)} - {formatCurrency(loan.nextPaymentAmount)}
                                                </p>
                                            </div>
                                            <Link
                                                href="/cooperatives/payment"
                                                className="px-4 py-2 bg-yellow-600 text-white font-semibold rounded-lg hover:bg-yellow-700 transition"
                                            >
                                                Pay Now
                                            </Link>
                                        </div>
                                    </div>

                                    {/* Repayment Schedule */}
                                    <div className="p-6">
                                        <h4 className="font-bold text-slate-900 dark:text-white mb-4">
                                            Repayment Schedule
                                        </h4>
                                        <div className="space-y-3">
                                            {loan.repaymentSchedule.map((payment: any, index: number) => (
                                                <div
                                                    key={index}
                                                    className={`flex items-center justify-between p-4 rounded-lg ${payment.paid
                                                            ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                                                            : "bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600"
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {payment.paid ? (
                                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                                        ) : (
                                                            <div className="w-5 h-5 rounded-full border-2 border-slate-400" />
                                                        )}
                                                        <div>
                                                            <p className="font-semibold text-slate-900 dark:text-white">
                                                                Payment #{index + 1}
                                                            </p>
                                                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                                                {formatDate(payment.date)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-bold text-slate-900 dark:text-white">
                                                            {formatCurrency(payment.amount)}
                                                        </p>
                                                        {payment.paid && (
                                                            <p className="text-xs text-green-600 dark:text-green-400">Paid</p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-12 text-center">
                        <DollarSign className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                            No Active Loans
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            You don't have any active loans at the moment
                        </p>
                        <Link
                            href="/cooperatives/loans"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition"
                        >
                            Apply for a Loan
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
