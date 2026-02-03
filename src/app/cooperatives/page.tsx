import { User, Wallet, TrendingUp, Calendar, DollarSign } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function CooperativesPage() {
    // Mock member data
    const memberData = {
        membershipNumber: "ESE-2024-00142",
        name: "John Doe",
        tier: "Gold",
        joinDate: "January 15, 2024",
        totalSavings: 450000,
        totalExports: 8,
        totalRevenue: 1250000,
        availableBalance: 75000,
    };

    // Mock transactions
    const transactions = [
        {
            id: "1",
            type: "deposit",
            amount: 50000,
            description: "Monthly savings contribution",
            date: "Feb 1, 2024",
            status: "completed",
        },
        {
            id: "2",
            type: "export_profit",
            amount: 125000,
            description: "Yam Tubers Export - Phase 2 Profit",
            date: "Jan 28, 2024",
            status: "completed",
        },
        {
            id: "3",
            type: "withdrawal",
            amount: 30000,
            description: "Withdrawal to bank account",
            date: "Jan 25, 2024",
            status: "completed",
        },
        {
            id: "4",
            type: "deposit",
            amount: 50000,
            description: "Monthly savings contribution",
            date: "Jan 1, 2024",
            status: "completed",
        },
    ];

    const getTierColor = (tier: string) => {
        switch (tier) {
            case "Gold":
                return "bg-gradient-to-r from-yellow-500 to-yellow-600";
            case "Premium":
                return "bg-gradient-to-r from-purple-500 to-purple-600";
            default:
                return "bg-gradient-to-r from-slate-500 to-slate-600";
        }
    };

    const getTransactionIcon = (type: string) => {
        switch (type) {
            case "deposit":
                return "↓";
            case "withdrawal":
                return "↑";
            case "export_profit":
                return "★";
            default:
                return "•";
        }
    };

    const getTransactionColor = (type: string) => {
        switch (type) {
            case "deposit":
                return "text-green-600 dark:text-green-400";
            case "withdrawal":
                return "text-red-600 dark:text-red-400";
            case "export_profit":
                return "text-primary";
            default:
                return "text-slate-600 dark:text-slate-400";
        }
    };

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Cooperative Membership
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Your membership profile, savings, and transaction history
                </p>
            </div>

            {/* Member Profile Card */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-3 mb-8 animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]">
                <div className="flex items-start gap-6">
                    {/* Avatar */}
                    <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white text-3xl font-bold shrink-0">
                        {memberData.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                    </div>

                    {/* Member Info */}
                    <div className="flex-1">
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                                    {memberData.name}
                                </h2>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Member ID: {memberData.membershipNumber}
                                </p>
                            </div>
                            <span
                                className={`px-4 py-2 ${getTierColor(
                                    memberData.tier
                                )} text-white font-bold rounded-xl elevation-2`}
                            >
                                {memberData.tier} Member
                            </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                                <div className="flex items-center gap-2 mb-2">
                                    <Wallet className="w-4 h-4 text-slate-500" />
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Total Savings
                                    </p>
                                </div>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">
                                    {formatCurrency(memberData.totalSavings)}
                                </p>
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                                <div className="flex items-center gap-2 mb-2">
                                    <TrendingUp className="w-4 h-4 text-slate-500" />
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Total Revenue
                                    </p>
                                </div>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">
                                    {formatCurrency(memberData.totalRevenue)}
                                </p>
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                                <div className="flex items-center gap-2 mb-2">
                                    <Calendar className="w-4 h-4 text-slate-500" />
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Member Since
                                    </p>
                                </div>
                                <p className="text-xl font-bold text-slate-900 dark:text-white">
                                    {memberData.joinDate}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Transaction History */}
                <div className="lg:col-span-2">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                        Transaction History
                    </h2>
                    <div className="space-y-4">
                        {transactions.map((transaction, index) => (
                            <div
                                key={transaction.id}
                                className="bg-white dark:bg-slate-800 rounded-xl p-5 elevation-1 hover-lift animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]"
                                style={{ animationDelay: `${200 + index * 50}ms` }}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4">
                                        <div
                                            className={`w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xl font-bold ${getTransactionColor(
                                                transaction.type
                                            )}`}
                                        >
                                            {getTransactionIcon(transaction.type)}
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-white mb-1">
                                                {transaction.description}
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                {transaction.date}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p
                                            className={`text-lg font-bold ${getTransactionColor(
                                                transaction.type
                                            )}`}
                                        >
                                            {transaction.type === "withdrawal" ? "-" : "+"}
                                            {formatCurrency(transaction.amount)}
                                        </p>
                                        <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
                                            {transaction.status}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Savings Summary */}
                <div className="lg:col-span-1">
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                        Savings Summary
                    </h2>
                    <div className="bg-gradient-to-br from-primary to-blue-700 rounded-2xl p-6 text-white elevation-3 mb-6">
                        <p className="text-sm text-blue-100 mb-2">Available Balance</p>
                        <p className="text-3xl font-bold mb-6">
                            {formatCurrency(memberData.availableBalance)}
                        </p>
                        <button className="w-full py-3 bg-white text-primary font-semibold rounded-xl hover:scale-105 transition-transform">
                            Withdraw Funds
                        </button>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                        <h3 className="font-bold text-slate-900 dark:text-white mb-4">
                            Membership Benefits
                        </h3>
                        <ul className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
                            <li className="flex items-start gap-2">
                                <span className="text-green-500 mt-1">✓</span>
                                <span>Access to exclusive export windows</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-500 mt-1">✓</span>
                                <span>Monthly savings with competitive interest</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-500 mt-1">✓</span>
                                <span>Cooperative profit sharing</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-500 mt-1">✓</span>
                                <span>Priority marketplace access</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
