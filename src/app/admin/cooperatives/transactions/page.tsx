"use client";

import { useState } from "react";
import { logger } from '@/lib/logger';
import Link from "next/link";
import {
    Filter,
    Download,
    Loader2,
    Clock,
    CheckCircle,
    XCircle,
    Search,
    ArrowLeft,
    ChevronDown,
    ChevronUp,
    Copy,
    DollarSign,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getAllTransactionsAction, getCooperativeStatsAction } from "@/app/actions/cooperative";
import { toast } from "sonner";
import { useAdminData } from "@/hooks/useAdminData";
import DateRangeFilter, { type DateRange } from "@/components/admin/DateRangeFilter";
import { recordExport } from "@/lib/record-export";

type TransactionType = "all" | "contribution" | "withdrawal" | "loan" | "fixed_savings" | "membership_registration";
type TransactionStatus = "all" | "pending" | "completed" | "failed";

interface Transaction {
    id: string;
    userId: string;
    userName: string;
    type: string;
    amount: number;
    status: string;
    date: string;
    description?: string;
    reference?: string;
    metadata?: Record<string, unknown>;
    user?: {
        phone?: string;
        email?: string;
        name?: string;
    } | null;
    bankDetails?: {
        bankName?: string;
        accountNumber?: string;
        accountName?: string;
        bankCode?: string;
    } | null;
}

export default function AdminTransactionsPage() {
    const [loading, setLoading] = useState(true);
    const [typeFilter, setTypeFilter] = useState<TransactionType>("all");
    const [statusFilter, setStatusFilter] = useState<TransactionStatus>("all");
    const [dateRange, setDateRange] = useState<DateRange>({ from: "", to: "" });
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [globalStats, setGlobalStats] = useState<{
        totalTransactions: number;
        totalTransactionAmount: number;
        completedTransactions: number;
        pendingTransactions: number;
        failedTransactions: number;
    } | null>(null);

    const {
        data: transactions,
        loading: isLoading,
        hasMore,
        onNextPage,
        onPrevPage,
        refresh: loadTransactions,
        pageIndex,
        search: searchTerm,
        setSearch: setSearchTerm,
    } = useAdminData<Transaction>({
        fetchAction: async (opts) => {
            try {
                const limit = opts.limit || 50;

                const result = await getAllTransactionsAction({
                    type: typeFilter,
                    status: statusFilter,
                    limit,
                    lastDocId: opts.lastDocId,
                    search: opts.search?.trim() || undefined,
                    dateFrom: dateRange.from || undefined,
                    dateTo: dateRange.to || undefined,
                });

                // Opportunistically load stats if on page 0
                if (!opts.lastDocId) {
                    getCooperativeStatsAction().then(statsResult => {
                        if (statsResult.success && statsResult.data?.stats) {
                            setGlobalStats(statsResult.data.stats as any);
                        }
                    }).catch(() => {}); // fire and forget
                }

                if (!result.success) {
                    toast.error(result.error || "Failed to load transactions");
                    return { success: false, data: [], meta: { hasMore: false }, error: result.error };
                }

                return {
                    success: true,
                    data: result.data?.transactions || [],
                    meta: { lastDocId: result.meta?.lastDocId, hasMore: result.meta?.hasMore }
                };

            } catch (error: any) {
                return { success: false, data: [], meta: { hasMore: false }, error: error.message };
            }
        },
        limit: 50,
        dependencies: [typeFilter, statusFilter, dateRange]
    });

    function getStatusIcon(status: string) {
        switch (status) {
            case "completed":
                return <CheckCircle className="w-4 h-4 text-green-600" />;
            case "pending":
                return <Clock className="w-4 h-4 text-yellow-600" />;
            case "failed":
                return <XCircle className="w-4 h-4 text-red-600" />;
            default:
                return null;
        }
    }

    function getStatusColor(status: string) {
        switch (status) {
            case "completed":
                return "bg-green-100 text-green-700";
            case "pending":
                return "bg-yellow-100 text-yellow-700";
            case "failed":
                return "bg-red-100 text-red-700";
            default:
                return "bg-gray-100 text-gray-700";
        }
    }

    function getTypeColor(type: string) {
        switch (type) {
            case "contribution":
                return "bg-blue-100 text-blue-700";
            case "withdrawal":
                return "bg-purple-100 text-purple-700";
            case "loan":
                return "bg-orange-100 text-orange-700";
            case "fixed_savings":
                return "bg-emerald-100 text-emerald-700";
            case "membership_registration":
                return "bg-violet-100 text-violet-700";
            default:
                return "bg-gray-100 text-gray-700";
        }
    }

    function copyToClipboard(text: string) {
        navigator.clipboard.writeText(text);
        toast.success("Copied to clipboard");
    }

    function exportCsv() {
        if (!filteredTransactions.length) return;
        const headers = ["Date", "User", "Phone", "Type", "Amount", "Status", "Description", "Reference"];
        const rows = filteredTransactions.map((t) => [
            new Date(t.date).toLocaleDateString("en-NG"),
            t.userName,
            t.user?.phone || "",
            t.type.replace(/_/g, " "),
            t.amount.toString(),
            t.status,
            t.description || "",
            t.reference || "",
        ]);
        const csvContent = [headers, ...rows]
            .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
            .join("\n");
        const blob = new Blob([csvContent], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `transactions-export-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        // #309 The download is recorded. Fourteen admin screens built a CSV
        // and two of them left a trace; several of these carry BVN, NIN and
        // bank details. recordExport never throws and never blocks.
        recordExport("cooperative_transactions");
    }

    // transactions already server-side filtered when searchTerm is set
    const filteredTransactions = transactions;

    // Calculate summary stats (fallback if global stats fail)
    const localTotalAmount = filteredTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const localCompletedCount = filteredTransactions.filter((t) => t.status === "completed").length;
    const localPendingCount = filteredTransactions.filter((t) => t.status === "pending").length;
    const localFailedCount = filteredTransactions.filter((t) => t.status === "failed").length;

    // Use global stats by default to prevent arrays capped at 100 from skewing dashboard totals
    const displayedTotalTxs = globalStats?.totalTransactions ?? filteredTransactions.length;
    const displayedTotalAmount = globalStats?.totalTransactionAmount ?? localTotalAmount;
    const displayedCompleted = globalStats?.completedTransactions ?? localCompletedCount;
    const displayedPending = globalStats?.pendingTransactions ?? localPendingCount;
    const displayedFailed = globalStats?.failedTransactions ?? localFailedCount;

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-start justify-between mb-8">
                    <div>
                        <Link
                            href="/admin"
                            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Dashboard
                        </Link>
                        <h1 className="text-4xl font-bold text-slate-900 mb-2">
                            Transaction Monitor
                        </h1>
                        <p className="text-slate-600">
                            View and manage all cooperative transactions
                        </p>
                    </div>
                    {/* Temporarily removed Export CSV button */}
                    {/* <button
                        onClick={exportCsv}
                        className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm"
                    >
                        <Download className="w-5 h-5" />
                        Export CSV
                    </button> */}
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                                <DollarSign className="w-5 h-5 text-blue-600" />
                            </div>
                            <p className="text-sm text-slate-500">Total Transactions</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">
                            {globalStats ? (
                                displayedTotalTxs
                            ) : (
                                <span className="inline-block w-16 h-8 bg-slate-100 animate-pulse rounded-lg mt-1" />
                            )}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                                <DollarSign className="w-5 h-5 text-emerald-600" />
                            </div>
                            <p className="text-sm text-slate-500">Total Amount</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">
                            {globalStats ? (
                                formatCurrency(displayedTotalAmount)
                            ) : (
                                <span className="inline-block w-28 h-8 bg-emerald-50 animate-pulse rounded-lg mt-1" />
                            )}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                                <CheckCircle className="w-5 h-5 text-green-600" />
                            </div>
                            <p className="text-sm text-slate-500">Completed</p>
                        </div>
                        <p className="text-3xl font-bold text-green-600">
                            {globalStats ? (
                                displayedCompleted
                            ) : (
                                <span className="inline-block w-16 h-8 bg-green-50 animate-pulse rounded-lg mt-1" />
                            )}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-10 h-10 bg-yellow-50 rounded-xl flex items-center justify-center">
                                <Clock className="w-5 h-5 text-yellow-600" />
                            </div>
                            <p className="text-sm text-slate-500">Pending / Failed</p>
                        </div>
                        <div className="text-lg">
                            {globalStats ? (
                                <>
                                    <span className="font-bold text-yellow-600">{displayedPending}</span>
                                    <span className="text-slate-400 mx-2">•</span>
                                    <span className="font-bold text-red-600">{displayedFailed}</span>
                                </>
                            ) : (
                                <span className="inline-block w-24 h-6 bg-yellow-50 animate-pulse rounded-lg mt-1" />
                            )}
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Transaction Type
                            </label>
                            <select
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value as TransactionType)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                            >
                                <option value="all">All Types</option>
                                <option value="membership_registration">Membership Registration</option>
                                <option value="contribution">Contribution</option>
                                <option value="withdrawal">Withdrawal</option>
                                <option value="loan">Loan</option>
                                <option value="fixed_savings">Fixed Savings</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Status
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as TransactionStatus)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                            >
                                <option value="all">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="completed">Completed</option>
                                <option value="failed">Failed</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Search
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search by name, ID, or reference..."
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Date Range
                            </label>
                            <div className="flex items-center gap-2">
                                <DateRangeFilter
                                    value={dateRange}
                                    onChange={setDateRange}
                                    label="All dates"
                                    className="flex-1"
                                />
                                {(dateRange.from || dateRange.to) && (
                                    <button
                                        type="button"
                                        onClick={() => setDateRange({ from: "", to: "" })}
                                        className="shrink-0 px-3 py-2.5 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 text-xs font-medium transition"
                                        title="Clear date filter"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Transactions Table */}
                {isLoading && transactions.length === 0 ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="text-center">
                            <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-3" />
                            <p className="text-sm text-slate-500">Loading transactions…</p>
                        </div>
                    </div>
                ) : filteredTransactions.length > 0 ? (
                    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50 border-b border-slate-100">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Date
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            User
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Type
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Amount
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Status
                                        </th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Reference
                                        </th>
                                        <th className="px-6 py-4 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                            Detail
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredTransactions.map((transaction) => {
                                        const isExpanded = expandedId === transaction.id;
                                        const date = new Date(transaction.date);
                                        return (
                                            <>
                                                <tr
                                                    key={transaction.id}
                                                    className={`hover:bg-slate-50 transition cursor-pointer ${isExpanded ? "bg-blue-50/50" : ""}`}
                                                    onClick={() => setExpandedId(isExpanded ? null : transaction.id)}
                                                >
                                                    <td className="px-6 py-4 text-sm text-slate-900 whitespace-nowrap">
                                                        <div>
                                                            <p className="font-medium">{date.toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" })}</p>
                                                            <p className="text-xs text-slate-500">{date.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</p>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div>
                                                            <p className="text-sm font-semibold text-slate-900">{transaction.userName}</p>
                                                            <p className="text-xs text-slate-500">{transaction.userId.slice(0, 12)}…</p>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <span
                                                            className={`px-3 py-1 text-xs font-semibold rounded-full capitalize ${getTypeColor(transaction.type)}`}
                                                        >
                                                            {transaction.type.replace(/_/g, " ")}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-sm font-bold text-slate-900">
                                                        {formatCurrency(transaction.amount)}
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center gap-1.5">
                                                            {getStatusIcon(transaction.status)}
                                                            <span
                                                                className={`px-3 py-1 text-xs font-semibold rounded-full capitalize ${getStatusColor(transaction.status)}`}
                                                            >
                                                                {transaction.status}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        {transaction.reference ? (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(transaction.reference!); }}
                                                                className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-blue-600 font-mono bg-slate-100 px-2 py-1 rounded transition"
                                                                title="Click to copy"
                                                            >
                                                                {transaction.reference.slice(0, 10)}…
                                                                <Copy className="w-3 h-3" />
                                                            </button>
                                                        ) : (
                                                            <span className="text-xs text-slate-400">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        {isExpanded ? (
                                                            <ChevronUp className="w-4 h-4 text-slate-400 mx-auto" />
                                                        ) : (
                                                            <ChevronDown className="w-4 h-4 text-slate-400 mx-auto" />
                                                        )}
                                                    </td>
                                                </tr>

                                                {/* Expandable Detail Row */}
                                                {isExpanded && (
                                                    <tr key={`${transaction.id}-detail`}>
                                                        <td colSpan={7} className="px-6 py-5 bg-slate-50/80 border-t border-b border-slate-100">
                                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                                {/* Transaction Info */}
                                                                <div className="space-y-3">
                                                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Transaction Details</h4>
                                                                    <div className="space-y-2 text-sm text-slate-600">
                                                                        <p><span className="font-medium text-slate-400">ID:</span> <span className="font-mono text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-200 text-xs">{transaction.id}</span></p>
                                                                        <p><span className="font-medium text-slate-400">Reference:</span> <span className="font-mono text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-200 text-xs">{transaction.reference || "N/A"}</span></p>
                                                                        <p><span className="font-medium text-slate-400">Type:</span> <span className="font-semibold text-slate-900 capitalize">{transaction.type.replace(/_/g, " ")}</span></p>
                                                                        <p><span className="font-medium text-slate-400">Description:</span> <span className="text-slate-900">{transaction.description || "N/A"}</span></p>
                                                                        <p><span className="font-medium text-slate-400">Date:</span> <span className="text-slate-900">{new Date(transaction.date).toLocaleString("en-NG")}</span></p>
                                                                    </div>
                                                                </div>

                                                                {/* Member Info */}
                                                                <div className="space-y-3">
                                                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Member Details</h4>
                                                                    <div className="space-y-2 text-sm text-slate-600">
                                                                        <p><span className="font-medium text-slate-400">Name:</span> <span className="font-semibold text-slate-900">{transaction.userName}</span></p>
                                                                        <p><span className="font-medium text-slate-400">User ID:</span> <span className="font-mono text-slate-900 text-xs">{transaction.userId}</span></p>
                                                                        <p><span className="font-medium text-slate-400">Email:</span> <span className="text-slate-900">{transaction.user?.email || "N/A"}</span></p>
                                                                        <p><span className="font-medium text-slate-400">Phone:</span> <span className="text-slate-900">{transaction.user?.phone || "N/A"}</span></p>
                                                                        {transaction.bankDetails?.accountNumber && (
                                                                            <p>
                                                                                <span className="font-medium text-slate-400">Bank:</span>{" "}
                                                                                <span className="text-slate-900 font-mono text-xs">
                                                                                    {transaction.bankDetails.bankName} - {transaction.bankDetails.accountNumber} ({transaction.bankDetails.accountName})
                                                                                </span>
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Diagnostic Metadata */}
                                                                <div className="space-y-3">
                                                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Full Metadata Logs</h4>
                                                                    <pre className="text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200 overflow-auto max-h-40 whitespace-pre-wrap font-mono shadow-inner">
                                                                        {JSON.stringify(transaction.metadata, null, 2)}
                                                                    </pre>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        
                        {/* Pagination Controls */}
                        {!isLoading && transactions.length > 0 && (
                            <div className="flex items-center justify-between p-4 bg-white border-t border-slate-100">
                                <span className="text-sm font-medium text-slate-500">Page {pageIndex + 1}</span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={onPrevPage}
                                        disabled={pageIndex === 0 || isLoading}
                                        className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
                                    >
                                        Previous
                                    </button>
                                    <button
                                        onClick={onNextPage}
                                        disabled={!hasMore || isLoading}
                                        className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition flex items-center gap-2"
                                    >
                                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : "Next Page"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
                        <Filter className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 mb-2">
                            No Transactions Found
                        </h3>
                        <p className="text-slate-500">
                            Try adjusting your filters or search criteria
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
