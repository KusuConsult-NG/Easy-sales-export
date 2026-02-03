"use client";

import { useState } from "react";
import { Users, TrendingUp, DollarSign, Calendar, Download } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import Modal from "@/components/ui/Modal";
import { AreaChartComponent } from "@/components/ui/Chart";

export default function CooperativesPage() {
    const [transactionFilter, setTransactionFilter] = useState("all");
    const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState("");

    // Savings growth data for chart
    const savingsData = [
        { month: "Jan", savings: 50000 },
        { month: "Feb", savings: 65000 },
        { month: "Mar", savings: 82000 },
        { month: "Apr", savings: 98000 },
        { month: "May", savings: 125000 },
        { month: "Jun", savings: 155000 },
    ];

    // Transaction filters
    const filterOptions = [
        { value: "all", label: "All Transactions" },
        { value: "deposits", label: "Deposits Only" },
        { value: "withdrawals", label: "Withdrawals Only" },
        { value: "earnings", label: "Earnings Only" },
    ];

    //  Transactions
    const allTransactions = [
        {
            id: "1",
            type: "deposit",
            amount: 15000,
            date: "2024-02-01",
            description: "Monthly Savings Contribution",
        },
        {
            id: "2",
            type: "earning",
            amount: 2500,
            date: "2024-02-05",
            description: "Cooperative Interest (5% APY)",
        },
        {
            id: "3",
            type: "deposit",
            amount: 15000,
            date: "2024-02-15",
            description: "Group Export Contribution",
        },
        {
            id: "4",
            type: "withdrawal",
            amount: 10000,
            date: "2024-02-20",
            description: "Emergency Withdrawal",
        },
        {
            id: "5",
            type: "earning",
            amount: 3000,
            date: "2024-02-25",
            description: "Export Profit Share",
        },
        {
            id: "6",
            type: "deposit",
            amount: 15000,
            date: "2024-03-01",
            description: "Monthly Savings Contribution",
        },
    ];

    // Filter transactions
    const filteredTransactions = allTransactions.filter((transaction) => {
        if (transactionFilter === "all") return true;
        if (transactionFilter === "deposits") return transaction.type === "deposit";
        if (transactionFilter === "withdrawals")
            return transaction.type === "withdrawal";
        if (transactionFilter === "earnings") return transaction.type === "earning";
        return true;
    });

    // Handle withdrawal
    const handleWithdrawal = () => {
        // TODO: Implement actual withdrawal logic
        console.log("Withdrawing:", withdrawAmount);
        setIsWithdrawModalOpen(false);
        setWithdrawAmount("");
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="p-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Cooperatives
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Manage your cooperative savings and transactions
                    </p>
                </div>

                {/* Member Profile & Quick Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                                <Users className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Member Since
                                </p>
                                <p className="font-bold text-slate-900 dark:text-white">
                                    January 2023
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Member ID: COOP-2023-001
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                                <DollarSign className="w-6 h-6 text-green-500" />
                            </div>
                            <div>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Total Savings
                                </p>
                                <p className="font-bold text-slate-900 dark:text-white text-xl">
                                    {formatCurrency(155000)}
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-green-600 dark:text-green-400 font-semibold">
                            +₦5,500 this month
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-blue-500" />
                            </div>
                            <div>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    Total Earnings
                                </p>
                                <p className="font-bold text-slate-900 dark:text-white text-xl">
                                    {formatCurrency(5500)}
                                </p>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            5% APY
                        </p>
                    </div>
                </div>

                {/* Savings Growth Chart */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 mb-8">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                                Savings Growth
                            </h2>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                Track your cooperative savings over time
                            </p>
                        </div>
                        <button
                            onClick={() => setIsWithdrawModalOpen(true)}
                            className="px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors flex items-center gap-2"
                        >
                            <Download className="w-4 h-4" />
                            Withdraw
                        </button>
                    </div>
                    <AreaChartComponent
                        data={savingsData.map(d => ({ name: d.month, value: d.savings }))}
                        dataKey="value"
                        xAxisKey="name"
                        color="#2E519F"
                    />
                </div>

                {/* Transaction History */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                                Transaction History
                            </h2>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                View all your cooperative transactions
                            </p>
                        </div>
                        <select
                            value={transactionFilter}
                            onChange={(e) => setTransactionFilter(e.target.value)}
                            className="px-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            {filterOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-3">
                        {filteredTransactions.length > 0 ? (
                            filteredTransactions.map((transaction) => (
                                <div
                                    key={transaction.id}
                                    className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <div className="flex items-center gap-4">
                                        <div
                                            className={`w-10 h-10 rounded-full flex items-center justify-center ${transaction.type === "deposit"
                                                ? "bg-green-500/10"
                                                : transaction.type === "withdrawal"
                                                    ? "bg-red-500/10"
                                                    : "bg-blue-500/10"
                                                }`}
                                        >
                                            {transaction.type === "deposit" ? (
                                                <TrendingUp
                                                    className={`w-5 h-5 ${transaction.type === "deposit"
                                                        ? "text-green-500"
                                                        : ""
                                                        }`}
                                                />
                                            ) : transaction.type === "withdrawal" ? (
                                                <Download className="w-5 h-5 text-red-500" />
                                            ) : (
                                                <DollarSign className="w-5 h-5 text-blue-500" />
                                            )}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-white">
                                                {transaction.description}
                                            </p>
                                            <p className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
                                                <Calendar className="w-3 h-3" />
                                                {new Date(transaction.date).toLocaleDateString("en-US", {
                                                    year: "numeric",
                                                    month: "long",
                                                    day: "numeric",
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                    <p
                                        className={`font-bold text-lg ${transaction.type === "withdrawal"
                                            ? "text-red-500"
                                            : "text-green-500"
                                            }`}
                                    >
                                        {transaction.type === "withdrawal" ? "-" : "+"}
                                        {formatCurrency(transaction.amount)}
                                    </p>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-12">
                                <p className="text-slate-500 dark:text-slate-400">
                                    No transactions match your filter
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Withdrawal Modal */}
            <Modal
                isOpen={isWithdrawModalOpen}
                onClose={() => setIsWithdrawModalOpen(false)}
                title="Withdraw from Savings"
            >
                <div className="space-y-4">
                    <div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                            Available Balance: <strong>{formatCurrency(155000)}</strong>
                        </p>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Withdrawal Amount
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                ₦
                            </span>
                            <input
                                type="number"
                                value={withdrawAmount}
                                onChange={(e) => setWithdrawAmount(e.target.value)}
                                placeholder="0.00"
                                className="w-full pl-8 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>

                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            <strong>Note:</strong> Withdrawals will be processed within 3-5
                            business days. A 2% processing fee applies to all withdrawals.
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => setIsWithdrawModalOpen(false)}
                            className="flex-1 px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleWithdrawal}
                            disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0}
                            className="flex-1 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
                        >
                            Confirm Withdrawal
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
