"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { 
    Shield, CheckCircle, Search, RefreshCw, XCircle, AlertCircle, FileText, ArrowRight
} from "lucide-react";
import { getFarmNationTransactionsAction, releaseFarmNationEscrowAction } from "@/app/actions/farm-nation-admin";

export default function EscrowManagementPage() {
    const { data: session } = useSession();
    const router = useRouter();
    
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState("all");

    useEffect(() => {
        loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter]);

    async function loadTransactions() {
        setLoading(true);
        try {
            const result = await getFarmNationTransactionsAction({
                limit: 100,
                status: statusFilter === "all" ? undefined : statusFilter
            });
            if (result.success && result.data) {
                setTransactions(result.data);
            } else {
                setError(result.error || "Failed to load transactions");
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleReleaseEscrow(transactionId: string) {
        if (!confirm("Are you sure you want to release the escrow? This will transfer property ownership to the buyer and initiate a payout to the seller. This action cannot be undone.")) return;
        
        setProcessingId(transactionId);
        try {
            const result = await releaseFarmNationEscrowAction(transactionId);
            if (result.success && result.data) {
                alert(result.data.message);
                loadTransactions();
            } else {
                alert("Error: " + result.error);
            }
        } catch (err: any) {
            alert("Error: " + err.message);
        } finally {
            setProcessingId(null);
        }
    }

    const getStatusBadge = (status: string, escrowStatus: string) => {
        if (escrowStatus === "held") return <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700 font-medium">Escrow Held</span>;
        if (escrowStatus === "released") return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700 font-medium">Released</span>;
        if (status === "pending_payment") return <span className="px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-700 font-medium">Awaiting Payment</span>;
        if (status === "cancelled") return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700 font-medium">Cancelled</span>;
        return <span className="px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-700 font-medium">{status}</span>;
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Shield className="w-6 h-6 text-blue-600" />
                        Escrow & Transactions
                    </h1>
                    <p className="text-slate-600">Manage Farm Nation real estate payments and title transfers</p>
                </div>
                <button 
                    onClick={loadTransactions}
                    className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition flex items-center gap-2"
                >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                </button>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-red-800">{error}</p>
                </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-200 flex gap-2">
                    {["all", "payment_confirmed", "completed", "pending_payment"].map(filter => (
                        <button
                            key={filter}
                            onClick={() => setStatusFilter(filter)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                                statusFilter === filter 
                                ? "bg-blue-600 text-white" 
                                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                            }`}
                        >
                            {filter === "payment_confirmed" ? "Held in Escrow" : 
                             filter === "completed" ? "Completed" : 
                             filter === "pending_payment" ? "Pending Payment" : "All Transactions"}
                        </button>
                    ))}
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="p-4 text-sm font-semibold text-slate-600">Property</th>
                                <th className="p-4 text-sm font-semibold text-slate-600">Buyer</th>
                                <th className="p-4 text-sm font-semibold text-slate-600">Seller</th>
                                <th className="p-4 text-sm font-semibold text-slate-600">Amount (₦)</th>
                                <th className="p-4 text-sm font-semibold text-slate-600">Status</th>
                                <th className="p-4 text-sm font-semibold text-slate-600">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-slate-500">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                                        Loading transactions...
                                    </td>
                                </tr>
                            ) : transactions.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-slate-500">
                                        No transactions found matching your criteria.
                                    </td>
                                </tr>
                            ) : (
                                transactions.map((tx) => (
                                    <tr key={tx.id} className="border-b border-slate-100 hover:bg-slate-50">
                                        <td className="p-4">
                                            <div className="font-medium text-slate-900">{tx.propertyName}</div>
                                            <div className="text-xs text-slate-500 font-mono mt-1">ID: {tx.propertyId.substring(0,8)}</div>
                                        </td>
                                        <td className="p-4">
                                            <div className="font-medium text-slate-900">{tx.buyerName}</div>
                                            <div className="text-xs text-slate-500">{tx.buyerEmail}</div>
                                            <div className="text-xs text-slate-500">{tx.buyerPhone}</div>
                                        </td>
                                        <td className="p-4">
                                            <div className="font-medium text-slate-900">{tx.sellerName}</div>
                                        </td>
                                        <td className="p-4">
                                            <div className="font-medium text-slate-900">₦{tx.escrowAmount?.toLocaleString()}</div>
                                        </td>
                                        <td className="p-4">
                                            {getStatusBadge(tx.status, tx.escrowStatus)}
                                        </td>
                                        <td className="p-4">
                                            {tx.escrowStatus === "held" && tx.status === "payment_confirmed" && (
                                                <button
                                                    onClick={() => handleReleaseEscrow(tx.id)}
                                                    disabled={processingId === tx.id}
                                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition flex items-center gap-1"
                                                >
                                                    {processingId === tx.id ? (
                                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                                    ) : (
                                                        <CheckCircle className="w-3 h-3" />
                                                    )}
                                                    Release Escrow
                                                </button>
                                            )}
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
