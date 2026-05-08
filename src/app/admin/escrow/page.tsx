"use client";

import { useState, useEffect, useCallback } from "react";
import { type EscrowTransaction, type EscrowStatus } from "@/types/escrow";
import { getAllEscrowTransactionsAdmin, releaseEscrowFunds, refundEscrowToBuyer } from "@/app/actions/escrow-actions";
import { EscrowDetailsModal } from "./components/EscrowDetailsModal";
import { formatCurrency } from "@/lib/utils";
import { ShieldCheck, Search, Database, Clock, Lock, Truck, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

export default function AdminEscrowDashboard() {
    const [transactions, setTransactions] = useState<EscrowTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<EscrowStatus | "ALL">("ALL");
    const [searchQuery, setSearchQuery] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [selectedTx, setSelectedTx] = useState<EscrowTransaction | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const statusFilter = filterStatus === "ALL" ? undefined : filterStatus;
            const searchFilter = searchQuery.length > 2 ? searchQuery : undefined;
            const res = await getAllEscrowTransactionsAdmin({ status: statusFilter, limit: 100, search: searchFilter });
            if (res.success && res.data?.transactions) {
                setTransactions(res.data.transactions);
            } else {
                setError(res.error || "Failed to load ledger.");
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [filterStatus, searchQuery]);

    useEffect(() => {
        const timer = setTimeout(() => {
            loadData();
        }, 300);
        return () => clearTimeout(timer);
    }, [loadData]);

    const handleRelease = async (id: string) => {
        const res = await releaseEscrowFunds(id);
        if (res.success) {
            loadData();
            return true;
        }
        throw new Error(res.error || "Release operation rejected by backend.");
    };

    const handleRefund = async (id: string) => {
        const res = await refundEscrowToBuyer(id);
        if (res.success) {
            loadData();
            return true;
        }
        throw new Error(res.error || "Refund operation rejected by backend.");
    };

    const StatusBadge = ({ status }: { status: EscrowStatus }) => {
        const config: Record<string, { bg: string, text: string, label: string, icon: any }> = {
            pending: { bg: "bg-slate-100", text: "text-slate-600", label: "Pending", icon: Clock },
            funded: { bg: "bg-blue-100", text: "text-blue-700", label: "Secured", icon: Lock },
            in_transit: { bg: "bg-purple-100", text: "text-purple-700", label: "In Transit", icon: Truck },
            delivered: { bg: "bg-teal-100", text: "text-teal-700", label: "Delivered", icon: CheckCircle },
            released: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Released", icon: ShieldCheck },
            refunded: { bg: "bg-gray-100", text: "text-gray-700", label: "Refunded", icon: Database },
            disputed: { bg: "bg-red-100", text: "text-red-700", label: "Disputed", icon: AlertTriangle },
            cancelled: { bg: "bg-red-50", text: "text-red-500", label: "Cancelled", icon: XCircle },
            completed: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Completed", icon: CheckCircle }
        };
        const c = config[status] || config.pending;
        const Icon = c.icon;
        return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${c.bg} ${c.text}`}>
                <Icon className="w-3.5 h-3.5" />
                {c.label}
            </span>
        );
    };

    return (
        <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
            {selectedTx && (
                <EscrowDetailsModal 
                    transaction={selectedTx} 
                    onClose={() => setSelectedTx(null)} 
                    onReleaseFunds={handleRelease} 
                    onRefundBuyer={handleRefund} 
                />
            )}

            <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800">Escrow Ledger</h1>
                    <p className="text-slate-500 mt-1">Financial Oversight & Transaction Arbitration</p>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl text-sm font-medium">
                    {error}
                </div>
            )}

            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row justify-between gap-4">
                    <div className="relative w-full md:w-96">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search email, ID, or item..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl outline-none transition text-sm text-slate-700 shadow-sm"
                        />
                    </div>
                    
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as any)}
                        className="w-full md:w-48 bg-white border border-slate-300 rounded-xl px-4 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-blue-500 transition"
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="funded">💰 Secured / Funded</option>
                        <option value="disputed">⚠️ Disputed</option>
                        <option value="in_transit">🚚 In Transit</option>
                        <option value="delivered">📦 Delivered</option>
                        <option value="released">✅ Released</option>
                        <option value="refunded">🔙 Refunded</option>
                    </select>
                </div>

                <div className="overflow-x-auto min-h-[400px]">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                            <tr>
                                <th className="px-6 py-4">Transaction Details</th>
                                <th className="px-6 py-4 hidden md:table-cell">Buyer</th>
                                <th className="px-6 py-4 hidden sm:table-cell">Seller</th>
                                <th className="px-6 py-4 whitespace-nowrap text-right text-slate-800 font-bold">Value (NGN)</th>
                                <th className="px-6 py-4 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center text-slate-400">
                                        <div className="w-8 h-8 rounded-full border-2 border-[#1358ec] border-t-transparent animate-spin mx-auto mb-3" />
                                        Fetching global ledger...
                                    </td>
                                </tr>
                            ) : transactions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center text-slate-500">
                                        <Database className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                                        <div className="font-semibold text-slate-800 text-lg">No Transactions Found</div>
                                        <div>Try adjusting your filters to see historical records.</div>
                                    </td>
                                </tr>
                            ) : (
                                transactions.map((tx) => (
                                    <tr 
                                        key={tx.id} 
                                        onClick={() => setSelectedTx(tx)}
                                        className="hover:bg-blue-50/50 transition cursor-pointer group"
                                    >
                                        <td className="px-6 py-4">
                                            <div className="font-semibold text-slate-800 group-hover:text-blue-600 transition">
                                                {tx.productName || "Unnamed Item"}
                                            </div>
                                            <div className="text-xs text-slate-400 font-mono mt-0.5">#{tx.id?.slice(0, 8)}</div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 hidden md:table-cell whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]" title={tx.buyerEmail}>
                                            {tx.buyerEmail || tx.buyerId?.slice(0, 8)}
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 hidden sm:table-cell whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]" title={tx.sellerEmail}>
                                            {tx.sellerEmail || tx.sellerId?.slice(0, 8)}
                                        </td>
                                        <td className="px-6 py-4 font-bold text-slate-900 text-right whitespace-nowrap">
                                            {formatCurrency(tx.amount)}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <StatusBadge status={tx.status} />
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
