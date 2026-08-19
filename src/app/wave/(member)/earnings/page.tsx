"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    DollarSign, TrendingUp, Clock, Download, Calendar,
    Eye, Loader2, ArrowDownCircle, CheckCircle, ChevronDown
} from "lucide-react";
import { calculateEarningsAction, withdrawEarningsAction } from "@/app/actions/wave";
import { useFeatureToggle } from "@/hooks/useFeatureToggle";
import type { MemberEarnings } from "@/app/actions/wave";
import { formatCurrency, parseCurrencyStringToFloat } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

export default function WaveEarningsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const { showToast } = useToast();

    const [earnings, setEarnings] = useState<MemberEarnings | null>(null);
    const [loading, setLoading] = useState(true);
    const [withdrawalAmount, setWithdrawalAmount] = useState("");
    const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

    /**
     * Whether withdrawals are open at all.
     *
     * The action used to refuse every request from an unconditional `return`,
     * and this page had no way to know: it enabled Withdraw whenever the
     * balance was above zero, opened the modal, took an amount, and only then
     * showed "currently disabled". A member with money showing was invited to
     * withdraw it and refused every time. Both sides read the same toggle now.
     */
    const withdrawalsEnabled = useFeatureToggle("wave_withdrawals");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated" && session?.user?.id) {
            loadEarnings();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, session]);

    async function loadEarnings() {
        if (!session?.user?.id) return;

        setLoading(true);
        try {
            const result = await calculateEarningsAction(session.user.id);
            if (result.success ) {
                setEarnings(result.data || null);
            } else {
                setEarnings(null);
                showToast(result.error || "Failed to load earnings data", "error");
            }
        } catch (error) {
        } finally {
            setLoading(false);
        }
    };

    async function handleWithdraw() {
        const amount = parseCurrencyStringToFloat(withdrawalAmount);
        if (isNaN(amount) || amount < 5000) {
            showToast("Minimum withdrawal is ₦5,000", "error");
            return;
        }

        try {
            const result = await withdrawEarningsAction(amount);
            if (result.success) {
                showToast(`Withdrawal request of ₦${amount.toLocaleString()} submitted! Our team will process it shortly.`, "success");
                setShowWithdrawalModal(false);
                setWithdrawalAmount("");
                loadEarnings(); // Refresh data
            } else {
                showToast(result.error || "Withdrawal failed", "error");
            }
        } catch {
            showToast("Failed to submit withdrawal request", "error");
        }
    };

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-linear-to-br from-emerald-50 to-emerald-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-emerald-700" />
            </div>
        );
    }

    if (!earnings) {
        return (
            <div className="min-h-screen bg-linear-to-br from-emerald-50 to-emerald-50 flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-600">Failed to load earnings data</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-emerald-50 to-emerald-50 py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        💰 My Earnings
                    </h1>
                    <p className="text-gray-600">
                        Track your sales commissions and withdraw funds
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    {/* Total Earnings */}
                    <div className="bg-linear-to-br from-emerald-700 to-emerald-700 rounded-2xl p-6 text-white shadow-xl">
                        <div className="flex items-center justify-between mb-2">
                            <DollarSign className="w-8 h-8" />
                            <span className="text-emerald-200 text-sm">All Time</span>
                        </div>
                        <p className="text-3xl font-bold mb-1">
                            {formatCurrency(earnings.totalEarnings)}
                        </p>
                        <p className="text-emerald-200 text-sm">Total Earnings</p>
                    </div>

                    {/* Pending Amount */}
                    <div className="bg-white rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center justify-between mb-2">
                            <Clock className="w-8 h-8 text-yellow-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 mb-1">
                            {formatCurrency(earnings.pendingAmount)}
                        </p>
                        <p className="text-gray-600 text-sm">Pending</p>
                    </div>

                    {/* Paid Amount */}
                    <div className="bg-white rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center justify-between mb-2">
                            <CheckCircle className="w-8 h-8 text-emerald-700" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 mb-1">
                            {formatCurrency(earnings.paidAmount)}
                        </p>
                        <p className="text-gray-600 text-sm">Paid Out</p>
                    </div>

                    {/* Total Sales */}
                    <div className="bg-white rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center justify-between mb-2">
                            <TrendingUp className="w-8 h-8 text-blue-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 mb-1">
                            {formatCurrency(earnings.totalSales)}
                        </p>
                        <p className="text-gray-600 text-sm">Total Sales</p>
                        <p className="text-xs text-gray-500 mt-1">
                            {(earnings.commissionRate * 100).toFixed(0)}% commission rate
                        </p>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 mb-8">
                    <button
                        onClick={() => setShowWithdrawalModal(true)}
                        disabled={earnings.paidAmount === 0 || !withdrawalsEnabled}
                        title={!withdrawalsEnabled
                            ? "Withdrawals are paused at the moment. Your earnings are safe and will still be here."
                            : undefined}
                        className="flex-1 px-6 py-4 bg-emerald-700 hover:bg-emerald-700 text-white rounded-xl font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        <ArrowDownCircle className="w-5 h-5" />
                        {withdrawalsEnabled ? "Withdraw Earnings" : "Withdrawals Paused"}
                    </button>
                    <button
                        onClick={() => window.print()}
                        className="px-6 py-4 bg-white border-2 border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition flex items-center gap-2"
                    >
                        <Download className="w-5 h-5" />
                        Download Report
                    </button>
                </div>

                {/* Transaction History */}
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                    <div className="p-6 border-b border-gray-200">
                        <h2 className="text-xl font-bold text-gray-900">
                            Transaction History
                        </h2>
                        <p className="text-sm text-gray-600 mt-1">
                            {earnings.transactions.length} transactions
                        </p>
                    </div>

                    {earnings.transactions.length === 0 ? (
                        <div className="p-12 text-center">
                            <DollarSign className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <p className="text-gray-500">
                                No transactions yet
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {earnings.transactions.map((txn) => (
                                <div
                                    key={txn.orderId}
                                    onClick={() => setExpandedOrderId(expandedOrderId === txn.orderId ? null : txn.orderId)}
                                    className="p-5 hover:bg-gray-50 transition cursor-pointer"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-start gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                                                <DollarSign className="w-5 h-5 text-emerald-700" />
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-slate-900 text-sm">Commission from Sale</h4>
                                                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                                                    <Calendar className="w-3.5 h-3.5" />
                                                    <span>{txn.date.toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                <p className="font-bold text-sm text-emerald-700">
                                                    +{formatCurrency(txn.commission)}
                                                </p>
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                                    txn.status === "paid"
                                                        ? "bg-emerald-100 text-emerald-800"
                                                        : "bg-yellow-100 text-yellow-700"
                                                }`}>
                                                    {txn.status.charAt(0).toUpperCase() + txn.status.slice(1)}
                                                </span>
                                            </div>
                                            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${expandedOrderId === txn.orderId ? "rotate-180" : ""}`} />
                                        </div>
                                    </div>

                                    {/* Expanded details */}
                                    {expandedOrderId === txn.orderId && (
                                        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl">
                                            <div>
                                                <p className="text-gray-500 font-semibold mb-0.5">Order ID</p>
                                                <p className="font-mono text-gray-800 select-all">{txn.orderId}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-500 font-semibold mb-0.5">Sale Amount</p>
                                                <p className="text-gray-800 font-medium">{formatCurrency(txn.saleAmount)}</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-500 font-semibold mb-0.5">Commission Rate</p>
                                                <p className="text-gray-800 font-medium">{(earnings.commissionRate * 100).toFixed(0)}%</p>
                                            </div>
                                            <div>
                                                <p className="text-gray-500 font-semibold mb-0.5">Payment Status</p>
                                                <p className="text-gray-800 capitalize font-medium">{txn.status}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Withdrawal Modal */}
                {showWithdrawalModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl max-w-md w-full p-6">
                            <h2 className="text-2xl font-bold text-gray-900 mb-4">
                                Withdraw Earnings
                            </h2>
                            <p className="text-sm text-gray-600 mb-6">
                                Available balance: <span className="font-bold text-emerald-700">{formatCurrency(earnings.paidAmount)}</span>
                            </p>

                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Withdrawal Amount (₦)
                                </label>
                                <input
                                    type="number"
                                    value={withdrawalAmount}
                                    onChange={(e) => setWithdrawalAmount(e.target.value)}
                                    max={earnings.paidAmount}
                                    placeholder="Enter amount"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-emerald-700"
                                />
                                <p className="mt-2 text-xs text-gray-500">
                                    Minimum withdrawal: ₦5,000
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowWithdrawalModal(false)}
                                    className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleWithdraw}
                                    disabled={!withdrawalAmount || parseCurrencyStringToFloat(withdrawalAmount) < 5000 || parseCurrencyStringToFloat(withdrawalAmount) > earnings.paidAmount}
                                    className="flex-1 px-4 py-3 bg-emerald-700 text-white font-semibold rounded-xl hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Confirm Withdrawal
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
