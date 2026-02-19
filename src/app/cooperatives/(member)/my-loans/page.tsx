"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
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
import { getUserLoanApplicationsAction, getRepaymentScheduleAction } from "@/app/actions/loans";

// Helper to convert FieldValue | Timestamp to Date
function toDate(value: any): Date {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    return new Date();
}

export default function MyLoansPage() {
    const [loading, setLoading] = useState(true);
    const [membership, setMembership] = useState<any>(null);
    const [loans, setLoans] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadLoans();
    }, []);

    async function loadLoans() {
        setLoading(true);
        setError(null);
        try {
            const result = await getMembershipAction();
            if (result.success && result.data) {
                setMembership(result.data);

                // Fetch real loans from Firestore using membership.id (which is the User ID)
                const loanApplications = await getUserLoanApplicationsAction(result.data.id);

                // Only show disbursed loans (active loans with repayment schedules)
                const disbursedLoans = loanApplications.filter(loan => loan.status === "disbursed");

                // Fetch repayment schedule for each disbursed loan
                const loansWithSchedules = await Promise.all(
                    disbursedLoans.map(async (loan) => {
                        const scheduleResult = await getRepaymentScheduleAction(loan.id || "");

                        if (scheduleResult.success && scheduleResult.schedule) {
                            const schedule = scheduleResult.schedule;

                            // Calculate balance (sum of unpaid installments)
                            const balance = schedule
                                .filter(inst => inst.status !== "paid")
                                .reduce((sum, inst) => sum + (inst.totalAmount - inst.paidAmount), 0);

                            // Find next unpaid installment
                            const nextPayment = schedule.find(inst => inst.status === "pending" || inst.status === "partial");

                            return {
                                ...loan,
                                balance,
                                repaymentSchedule: schedule.map(inst => ({
                                    date: inst.dueDate,
                                    amount: inst.totalAmount,
                                    paid: inst.status === "paid"
                                })),
                                nextPaymentDate: nextPayment ? nextPayment.dueDate : null,
                                nextPaymentAmount: nextPayment ? nextPayment.totalAmount - nextPayment.paidAmount : 0,
                                startDate: toDate(loan.disbursedAt || loan.appliedAt),
                                interestRate: loan.interestRate,
                                duration: loan.durationMonths
                            };
                        }

                        // Fallback if schedule fetch fails
                        return {
                            ...loan,
                            balance: loan.totalRepayment,
                            repaymentSchedule: [],
                            nextPaymentDate: null,
                            nextPaymentAmount: loan.monthlyPayment || 0,
                            startDate: toDate(loan.disbursedAt) || toDate(loan.appliedAt) || new Date(),
                            interestRate: loan.interestRate,
                            duration: loan.durationMonths
                        };
                    })
                );

                setLoans(loansWithSchedules);
            } else {
                setError(result.error || "Failed to load membership data");
            }
        } catch (error) {
            logger.error("Failed to load loans:", error);
            setError("An unexpected error occurred while loading your loans");
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
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        My Loans
                    </h1>
                    <p className="text-slate-600">
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

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-purple-600" />
                            </div>
                            <p className="text-sm text-slate-600">Total Borrowed</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">
                            {formatCurrency(totalBorrowed)}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                                <CheckCircle className="w-5 h-5 text-green-600" />
                            </div>
                            <p className="text-sm text-slate-600">Active Loans</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">
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
                                <div key={loan.id} className="bg-white rounded-2xl shadow-lg overflow-hidden">
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
                                    <div className="bg-yellow-50 border-b border-yellow-200 p-4">
                                        <div className="flex items-center gap-3">
                                            <Clock className="w-5 h-5 text-yellow-600" />
                                            <div className="flex-1">
                                                <p className="font-semibold text-slate-900">
                                                    Next Payment Due
                                                </p>
                                                <p className="text-sm text-slate-600">
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
                                        <h4 className="font-bold text-slate-900 mb-4">
                                            Repayment Schedule
                                        </h4>
                                        <div className="space-y-3">
                                            {loan.repaymentSchedule.map((payment: any, index: number) => (
                                                <div
                                                    key={index}
                                                    className={`flex items-center justify-between p-4 rounded-lg ${payment.paid
                                                        ? "bg-green-50 border border-green-200"
                                                        : "bg-slate-50 border border-slate-200"
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {payment.paid ? (
                                                            <CheckCircle className="w-5 h-5 text-green-600" />
                                                        ) : (
                                                            <div className="w-5 h-5 rounded-full border-2 border-slate-400" />
                                                        )}
                                                        <div>
                                                            <p className="font-semibold text-slate-900">
                                                                Payment #{index + 1}
                                                            </p>
                                                            <p className="text-sm text-slate-600">
                                                                {formatDate(payment.date)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-bold text-slate-900">
                                                            {formatCurrency(payment.amount)}
                                                        </p>
                                                        {payment.paid && (
                                                            <p className="text-xs text-green-600">Paid</p>
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
                    <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
                        <DollarSign className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 mb-2">
                            No Active Loans
                        </h3>
                        <p className="text-slate-600 mb-6">
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
