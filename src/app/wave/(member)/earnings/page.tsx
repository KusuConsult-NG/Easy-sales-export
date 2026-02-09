"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
    DollarSign, TrendingUp, Clock, Download, Calendar,
    Eye, Loader2, ArrowDownCircle, CheckCircle
} from "lucide-react";
import { calculateEarningsAction } from "@/app/actions/wave";
import type { MemberEarnings } from "@/app/actions/wave";
import { formatCurrency } from "@/lib/utils";

export default function WaveEarningsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [earnings, setEarnings] = useState<MemberEarnings | null>(null);
    const [loading, setLoading] = useState(true);
    const [withdrawalAmount, setWithdrawalAmount] = useState("");
    const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push("/auth/login");
        } else if (status === "authenticated" && session?.user?.id) {
            loadEarnings();
        }
    }, [status, session]);

    const loadEarnings = async () => {
        if (!session?.user?.id) return;

        setLoading(true);
        try {
            const result = await calculateEarningsAction(session.user.id);
            setEarnings(result);
        } catch (error) {
            console.error("Failed to load earnings:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleWithdraw = async () => {
        // In production, call withdrawEarningsAction
        alert(`Withdrawal request for ₦${parseFloat(withdrawalAmount).toLocaleString()} submitted!`);
        setShowWithdrawalModal(false);
        setWithdrawalAmount("");
    };

    if (loading || status === "loading") {
        return (
            <div className="min-h-screen bg-linear-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900/20 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-purple-600" />
            </div>
        );
    }

    if (!earnings) {
        return (
            <div className="min-h-screen bg-linear-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900/20 flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-600 dark:text-gray-400">Failed to load earnings data</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900/20 py-8 px-4">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        💰 My Earnings
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Track your sales commissions and withdraw funds
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    {/* Total Earnings */}
                    <div className="bg-linear-to-br from-purple-600 to-pink-600 rounded-2xl p-6 text-white shadow-xl">
                        <div className="flex items-center justify-between mb-2">
                            <DollarSign className="w-8 h-8" />
                            <span className="text-purple-200 text-sm">All Time</span>
                        </div>
                        <p className="text-3xl font-bold mb-1">
                            {formatCurrency(earnings.totalEarnings)}
                        </p>
                        <p className="text-purple-200 text-sm">Total Earnings</p>
                    </div>

                    {/* Pending Amount */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center justify-between mb-2">
                            <Clock className="w-8 h-8 text-yellow-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                            {formatCurrency(earnings.pendingAmount)}
                        </p>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">Pending</p>
                    </div>

                    {/* Paid Amount */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center justify-between mb-2">
                            <CheckCircle className="w-8 h-8 text-green-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                            {formatCurrency(earnings.paidAmount)}
                        </p>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">Paid Out</p>
                    </div>

                    {/* Total Sales */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center justify-between mb-2">
                            <TrendingUp className="w-8 h-8 text-blue-600" />
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                            {formatCurrency(earnings.totalSales)}
                        </p>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">Total Sales</p>
                        <p className="text-xs text-gray-500 mt-1">
                            {(earnings.commissionRate * 100).toFixed(0)}% commission rate
                        </p>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 mb-8">
                    <button
                        onClick={() => setShowWithdrawalModal(true)}
                        disabled={earnings.paidAmount === 0}
                        className="flex-1 px-6 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        <ArrowDownCircle className="w-5 h-5" />
                        Withdraw Earnings
                    </button>
                    <button
                        onClick={() => window.print()}
                        className="px-6 py-4 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center gap-2"
                    >
                        <Download className="w-5 h-5" />
                        Download Report
                    </button>
                </div>

                {/* Transaction History */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden">
                    <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                            Transaction History
                        </h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {earnings.transactions.length} transactions
                        </p>
                    </div>

                    {earnings.transactions.length === 0 ? (
                        <div className="p-12 text-center">
                            <DollarSign className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                            <p className="text-gray-500 dark:text-gray-400">
                                No transactions yet
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 dark:bg-gray-900">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
                                            Date
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
                                            Order ID
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
                                            Sale Amount
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
                                            Commission
                                        </th>
                                        <th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
                                            Status
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {earnings.transactions.map((txn, idx) => (
                                        <tr
                                            key={txn.orderId}
                                            className="hover:bg-gray-50 dark:hover:bg-gray-900/50 transition"
                                        >
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="w-4 h-4 text-gray-400" />
                                                    {txn.date.toLocaleDateString()}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600 dark:text-gray-400">
                                                {txn.orderId}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900 dark:text-white">
                                                {formatCurrency(txn.saleAmount)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-purple-600">
                                                {formatCurrency(txn.commission)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-center">
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${txn.status === "paid"
                                                    ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                                                    : "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400"
                                                    }`}>
                                                    {txn.status.charAt(0).toUpperCase() + txn.status.slice(1)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Withdrawal Modal */}
                {showWithdrawalModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                                Withdraw Earnings
                            </h2>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                                Available balance: <span className="font-bold text-purple-600">{formatCurrency(earnings.paidAmount)}</span>
                            </p>

                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Withdrawal Amount (₦)
                                </label>
                                <input
                                    type="number"
                                    value={withdrawalAmount}
                                    onChange={(e) => setWithdrawalAmount(e.target.value)}
                                    max={earnings.paidAmount}
                                    placeholder="Enter amount"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-600"
                                />
                                <p className="mt-2 text-xs text-gray-500">
                                    Minimum withdrawal: ₦5,000
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowWithdrawalModal(false)}
                                    className="flex-1 px-4 py-3 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleWithdraw}
                                    disabled={!withdrawalAmount || parseFloat(withdrawalAmount) < 5000 || parseFloat(withdrawalAmount) > earnings.paidAmount}
                                    className="flex-1 px-4 py-3 bg-purple-600 text-white font-semibold rounded-xl hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
