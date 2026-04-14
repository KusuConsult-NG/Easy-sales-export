"use client";

import { useState, useEffect } from "react";
import {
    ShieldCheck,
    Search,
    Filter,
    Loader2,
    CheckCircle,
    RefreshCw,
    Clock,
    AlertTriangle,
    DollarSign,
    Send,
    XCircle,
    ChevronRight,
} from "lucide-react";
import {
    getAllEscrowTransactionsAdmin,
    releaseEscrowFunds,
    refundEscrowToBuyer,
} from "@/app/actions/escrow-actions";
import type { EscrowTransaction, EscrowStatus } from "@/types/escrow";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: React.ElementType }> = {
    pending: { label: "Pending", badge: "bg-gray-100 text-gray-700", icon: Clock },
    funded: { label: "Funded", badge: "bg-blue-100 text-blue-800", icon: DollarSign },
    in_transit: { label: "In Transit", badge: "bg-yellow-100 text-yellow-800", icon: Send },
    delivered: { label: "Delivered", badge: "bg-teal-100 text-teal-800", icon: CheckCircle },
    released: { label: "Released", badge: "bg-green-100 text-green-800", icon: CheckCircle },
    refunded: { label: "Refunded", badge: "bg-orange-100 text-orange-800", icon: RefreshCw },
    disputed: { label: "Disputed", badge: "bg-red-100 text-red-800", icon: AlertTriangle },
    cancelled: { label: "Cancelled", badge: "bg-slate-100 text-slate-600", icon: XCircle },
    completed: { label: "Completed", badge: "bg-emerald-100 text-emerald-800", icon: CheckCircle },
};

const FILTER_OPTIONS: { value: EscrowStatus | "all"; label: string }[] = [
    { value: "all", label: "All Statuses" },
    { value: "funded", label: "Funded (Awaiting Release)" },
    { value: "disputed", label: "Disputed" },
    { value: "pending", label: "Pending Payment" },
    { value: "in_transit", label: "In Transit" },
    { value: "delivered", label: "Delivered" },
    { value: "released", label: "Released" },
    { value: "refunded", label: "Refunded" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
];

interface ActionModalState {
    open: boolean;
    type: "release" | "refund" | null;
    tx: EscrowTransaction | null;
}

export default function AdminEscrowPage() {
    const { data: session } = useSession();
    const { showToast } = useToast();

    const [transactions, setTransactions] = useState<EscrowTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);

    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<EscrowStatus | "all">("all");

    const [modal, setModal] = useState<ActionModalState>({ open: false, type: null, tx: null });

    useEffect(() => {
        loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter]);

    async function loadTransactions() {
        setLoading(true);
        try {
            const result = await getAllEscrowTransactionsAdmin(
                statusFilter !== "all" ? { status: statusFilter } : undefined
            );
            if (result.success) {
                setTransactions(result.data?.transactions ?? []);
            } else {
                showToast(result.error ?? "Failed to load transactions", "error");
            }
        } finally {
            setLoading(false);
        }
    }

    async function confirmAction() {
        if (!modal.tx || !modal.type || !session?.user?.id) return;

        setActionLoading(true);
        try {
            const result = modal.type === "release"
                ? await releaseEscrowFunds(modal.tx.id!)
                : await refundEscrowToBuyer(modal.tx.id!);

            if (result.success) {
                showToast(
                    modal.type === "release"
                        ? "Funds released to seller successfully"
                        : "Escrow refunded to buyer successfully",
                    "success"
                );
                setModal({ open: false, type: null, tx: null });
                await loadTransactions();
            } else {
                showToast(result.error ?? "Action failed", "error");
            }
        } finally {
            setActionLoading(false);
        }
    }

    const filtered = transactions.filter((tx) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            tx.id?.toLowerCase().includes(q) ||
            tx.buyerEmail?.toLowerCase().includes(q) ||
            tx.sellerEmail?.toLowerCase().includes(q) ||
            tx.productName?.toLowerCase().includes(q) ||
            tx.paymentReference?.toLowerCase().includes(q)
        );
    });

    const stats = {
        funded: transactions.filter((t) => t.status === "funded").length,
        disputed: transactions.filter((t) => t.status === "disputed").length,
        released: transactions.filter((t) => t.status === "released").length,
        totalHeld: transactions
            .filter((t) => t.status === "funded" || t.status === "disputed")
            .reduce((sum, t) => sum + (t.amount ?? 0), 0),
    };

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-7xl mx-auto px-4">

                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <ShieldCheck className="w-9 h-9 text-primary" />
                        <h1 className="text-3xl font-bold text-gray-900">Escrow Management</h1>
                    </div>
                    <p className="text-gray-600">
                        Review, release, or refund escrow transactions across all modules.
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
                        <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Funded (Held)</p>
                        <p className="text-3xl font-bold text-blue-900">{stats.funded}</p>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
                        <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-1">Disputed</p>
                        <p className="text-3xl font-bold text-red-900">{stats.disputed}</p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
                        <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">Released</p>
                        <p className="text-3xl font-bold text-green-900">{stats.released}</p>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
                        <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1">Total Held (₦)</p>
                        <p className="text-2xl font-bold text-purple-900">{formatCurrency(stats.totalHeld)}</p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by ID, email, product, reference..."
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary focus:border-transparent text-sm"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">Status Filter</label>
                            <div className="relative">
                                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value as EscrowStatus | "all")}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-primary appearance-none text-sm"
                                >
                                    {FILTER_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Table */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="bg-white rounded-2xl shadow-sm p-16 text-center">
                        <ShieldCheck className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg font-medium">No escrow transactions found</p>
                        <p className="text-gray-400 text-sm mt-2">
                            {searchQuery || statusFilter !== "all" ? "Try adjusting your filters" : "No transactions have been created yet"}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filtered.map((tx) => {
                            const cfg = STATUS_CONFIG[tx.status] ?? STATUS_CONFIG.pending;
                            const StatusIcon = cfg.icon;
                            const canRelease = tx.status === "funded";
                            const canRefund = tx.status === "funded" || tx.status === "disputed";

                            return (
                                <div
                                    key={tx.id}
                                    className="bg-white rounded-2xl shadow-sm p-5 hover:shadow-md transition"
                                >
                                    <div className="flex flex-col md:flex-row md:items-center gap-4">

                                        {/* Left: info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 mb-2 flex-wrap">
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${cfg.badge}`}>
                                                    <StatusIcon className="w-3 h-3" />
                                                    {cfg.label}
                                                </span>
                                                <span className="font-mono text-xs text-gray-400">{tx.id?.slice(0, 10)}...</span>
                                                {tx.createdAt && (
                                                    <span className="text-xs text-gray-400">
                                                        {(tx.createdAt as Date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                                                    </span>
                                                )}
                                            </div>

                                            <p className="font-bold text-gray-900 text-base mb-1 truncate">{tx.productName}</p>

                                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                                                <span>Buyer: <span className="font-mono text-xs">{tx.buyerEmail ?? tx.buyerId?.slice(0, 8)}</span></span>
                                                <span>Seller: <span className="font-mono text-xs">{tx.sellerEmail ?? tx.sellerId?.slice(0, 8)}</span></span>
                                            </div>

                                            {tx.paymentReference && (
                                                <p className="text-xs text-gray-400 mt-1 font-mono">Ref: {tx.paymentReference}</p>
                                            )}
                                        </div>

                                        {/* Right: amount + actions */}
                                        <div className="flex flex-col items-end gap-3 shrink-0">
                                            <p className="text-xl font-bold text-gray-900">{formatCurrency(tx.amount ?? 0)}</p>

                                            <div className="flex gap-2">
                                                {canRelease && (
                                                    <button
                                                        onClick={() => setModal({ open: true, type: "release", tx })}
                                                        className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 transition flex items-center gap-2"
                                                    >
                                                        <ChevronRight className="w-4 h-4" />
                                                        Release to Seller
                                                    </button>
                                                )}
                                                {canRefund && (
                                                    <button
                                                        onClick={() => setModal({ open: true, type: "refund", tx })}
                                                        className="px-4 py-2 bg-orange-500 text-white text-sm font-semibold rounded-xl hover:bg-orange-600 transition flex items-center gap-2"
                                                    >
                                                        <RefreshCw className="w-4 h-4" />
                                                        Refund Buyer
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Confirm Action Modal */}
            {modal.open && modal.tx && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
                        <div className="mb-6">
                            <div className="flex items-center gap-3 mb-3">
                                {modal.type === "release"
                                    ? <CheckCircle className="w-8 h-8 text-green-600" />
                                    : <RefreshCw className="w-8 h-8 text-orange-500" />
                                }
                                <h2 className="text-xl font-bold text-gray-900">
                                    {modal.type === "release" ? "Release Escrow Funds" : "Refund Escrow to Buyer"}
                                </h2>
                            </div>
                            <p className="text-gray-600 text-sm">
                                {modal.type === "release"
                                    ? `You are about to release ${formatCurrency(modal.tx.amount ?? 0)} to the seller for "${modal.tx.productName}". This action cannot be undone.`
                                    : `You are about to refund ${formatCurrency(modal.tx.amount ?? 0)} to the buyer for "${modal.tx.productName}". This action cannot be undone.`
                                }
                            </p>
                        </div>

                        <div className="bg-gray-50 rounded-xl p-4 mb-6 text-sm space-y-2">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Product</span>
                                <span className="font-semibold text-gray-900">{modal.tx.productName}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Amount</span>
                                <span className="font-bold text-gray-900">{formatCurrency(modal.tx.amount ?? 0)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Buyer</span>
                                <span className="font-mono text-xs text-gray-900">{modal.tx.buyerEmail ?? modal.tx.buyerId?.slice(0, 12)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Seller</span>
                                <span className="font-mono text-xs text-gray-900">{modal.tx.sellerEmail ?? modal.tx.sellerId?.slice(0, 12)}</span>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setModal({ open: false, type: null, tx: null })}
                                className="flex-1 px-4 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmAction}
                                disabled={actionLoading}
                                className={`flex-1 px-4 py-3 text-white font-semibold rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2 ${modal.type === "release"
                                    ? "bg-green-600 hover:bg-green-700"
                                    : "bg-orange-500 hover:bg-orange-600"
                                    }`}
                            >
                                {actionLoading
                                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                                    : <><CheckCircle className="w-4 h-4" /> Confirm</>
                                }
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
