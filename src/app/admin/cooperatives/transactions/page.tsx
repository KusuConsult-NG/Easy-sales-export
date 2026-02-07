"use client";

import { useState, useEffect } from "react";
import {
    Filter,
    Download,
    Loader2,
    TrendingUp,
    TrendingDown,
    Clock,
    CheckCircle,
    XCircle,
    Search,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getAllTransactionsAction } from "@/app/actions/cooperative-admin";

type TransactionType = "all" | "contribution" | "withdrawal" | "loan" | "fixed_savings";
type TransactionStatus = "all" | "pending" | "completed" | "failed";

export default function AdminTransactionsPage() {
    const [loading, setLoading] = useState(true);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [typeFilter, setTypeFilter] = useState<TransactionType>("all");
    const [statusFilter, setStatusFilter] = useState<TransactionStatus>("all");
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        loadTransactions();
    }, [typeFilter, statusFilter]);

    async function loadTransactions() {
        setLoading(true);
        try {
            const result = await getAllTransactionsAction({
                type: typeFilter,
                status: statusFilter,
                limit: 100,
            });

            if (result.success && result.data) {
                setTransactions(result.data);
            }
        } catch (error) {
            console.error("Failed to load transactions:", error);
        } finally {
            setLoading(false);
        }
    }

    function getStatusIcon(status: string) {
        switch (status) {
            case "completed":
                return <CheckCircle className="w-5 h-5 text-green-600" />;
            case "pending":
                return <Clock className="w-5 h-5 text-yellow-600" />;
            case "failed":
                return <XCircle className="w-5 h-5 text-red-600" />;
            default:
                return null;
        }
    }

    function getStatusColor(status: string) {
        switch (status) {
            case "completed":
                return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
            case "pending":
                return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400";
            case "failed":
                return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400";
            default:
                return "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-400";
        }
    }

    function getTypeColor(type: string) {
        switch (type) {
            case "contribution":
                return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400";
            case "withdrawal":
                return "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400";
            case "loan":
                return "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400";
            case "fixed_savings":
                return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
            default:
                return "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-400";
        }
    }

    const filteredTransactions = transactions.filter((t) =>
        t.userId?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Calculate totals
    const totalAmount = filteredTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const completedCount = filteredTransactions.filter((t) => t.status === "completed").length;
    const pendingCount = filteredTransactions.filter((t) => t.status === "pending").length;
    const failedCount = filteredTransactions.filter((t) => t.status === "failed").length;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                            Transaction Monitor
                        </h1>
                        <p className="text-gray-600 dark:text-gray-400">
                            View and manage all cooperative transactions
                        </p>
                    </div>
                    <button className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition flex items-center gap-2">
                        <Download className="w-5 h-5" />
                        Export CSV
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Transactions</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {filteredTransactions.length}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Amount</p>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {formatCurrency(totalAmount)}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Completed</p>
                        <p className="text-3xl font-bold text-green-600">{completedCount}</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3">
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Status</p>
                                <p className="text-sm">
                                    <span className="text-yellow-600">Pending: {pendingCount}</span>
                                    {" • "}
                                    <span className="text-red-600">Failed: {failedCount}</span>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Transaction Type
                            </label>
                            <select
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value as TransactionType)}
                                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-600"
                            >
                                <option value="all">All Types</option>
                                <option value="contribution">Contribution</option>
                                <option value="withdrawal">Withdrawal</option>
                                <option value="loan">Loan</option>
                                <option value="fixed_savings">Fixed Savings</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Status
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as TransactionStatus)}
                                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-600"
                            >
                                <option value="all">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="completed">Completed</option>
                                <option value="failed">Failed</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Search User ID
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search by user ID..."
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-600"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Transactions Table */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-green-600" />
                    </div>
                ) : filteredTransactions.length > 0 ? (
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 dark:bg-gray-700">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">
                                            Date
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">
                                            User ID
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">
                                            Type
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">
                                            Amount
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">
                                            Status
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {filteredTransactions.map((transaction) => {
                                        const date = transaction.date?.toDate
                                            ? transaction.date.toDate()
                                            : new Date(transaction.date);
                                        return (
                                            <tr
                                                key={transaction.id}
                                                className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                            >
                                                <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                                                    {date.toLocaleDateString()} {date.toLocaleTimeString()}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                                                    {transaction.userId}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span
                                                        className={`px-3 py-1 text-xs font-semibold rounded-full capitalize ${getTypeColor(
                                                            transaction.type
                                                        )}`}
                                                    >
                                                        {transaction.type.replace("_", " ")}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">
                                                    {formatCurrency(transaction.amount)}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2">
                                                        {getStatusIcon(transaction.status)}
                                                        <span
                                                            className={`px-3 py-1 text-xs font-semibold rounded-full capitalize ${getStatusColor(
                                                                transaction.status
                                                            )}`}
                                                        >
                                                            {transaction.status}
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-12 text-center">
                        <Filter className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                            No Transactions Found
                        </h3>
                        <p className="text-gray-600 dark:text-gray-400">
                            Try adjusting your filters or search criteria
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
