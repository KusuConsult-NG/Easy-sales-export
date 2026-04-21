"use client";

import { useState } from "react";
import { type EscrowTransaction } from "@/types/escrow";
import { X, AlertTriangle, CheckCircle, ShieldAlert, FileText, ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface EscrowDetailsModalProps {
    transaction: EscrowTransaction;
    onClose: () => void;
    onReleaseFunds: (id: string) => Promise<boolean>;
    onRefundBuyer: (id: string) => Promise<boolean>;
}

export function EscrowDetailsModal({ transaction, onClose, onReleaseFunds, onRefundBuyer }: EscrowDetailsModalProps) {
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleRelease = async () => {
        if (!confirm("Are you highly certain you wish to RELEASE these Escrow funds to the Seller? This cannot be undone.")) return;
        setActionLoading(true);
        setError(null);
        try {
            const success = await onReleaseFunds(transaction.id!);
            if (success) onClose();
        } catch (e: any) {
            setError(e.message || "Failed to release funds");
        } finally {
            setActionLoading(false);
        }
    };

    const handleRefund = async () => {
        if (!confirm("Are you highly certain you wish to REFUND this Escrow back to the Buyer? This terminates the transaction.")) return;
        setActionLoading(true);
        setError(null);
        try {
            const success = await onRefundBuyer(transaction.id!);
            if (success) onClose();
        } catch (e: any) {
            setError(e.message || "Failed to refund buyer");
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
                            <ShieldAlert className="w-5 h-5 text-[#1358ec]" />
                            Escrow Ledger Arbitration
                        </h2>
                        <span className="text-xs text-slate-400 font-mono">ID: {transaction.id}</span>
                    </div>
                    <button 
                        onClick={onClose} 
                        disabled={actionLoading}
                        className="p-2 hover:bg-slate-200 rounded-full transition-colors disabled:opacity-50"
                    >
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                <div className="p-6 space-y-8">
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Financial Summary */}
                    <div className="bg-[#1358ec] rounded-xl p-6 text-white text-center shadow-md">
                        <div className="text-blue-100 text-sm font-medium uppercase tracking-wider mb-1">Locked Value</div>
                        <div className="text-4xl font-bold">{formatCurrency(transaction.amount)}</div>
                        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-white text-xs font-semibold uppercase tracking-widest backdrop-blur-sm">
                            Status: {transaction.status}
                        </div>
                    </div>

                    {/* Parties Involved */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 border border-slate-100 rounded-xl bg-slate-50/50">
                            <div className="text-xs text-slate-400 font-semibold mb-1 uppercase tracking-wide">Buyer (Funder)</div>
                            <div className="font-medium text-slate-800 break-all">{transaction.buyerEmail || transaction.buyerId}</div>
                        </div>
                        <div className="p-4 border border-slate-100 rounded-xl bg-slate-50/50 relative">
                            <ArrowRight className="absolute -left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-300 hidden md:block" />
                            <div className="text-xs text-slate-400 font-semibold mb-1 uppercase tracking-wide">Seller (Recipient)</div>
                            <div className="font-medium text-slate-800 break-all">{transaction.sellerEmail || transaction.sellerId}</div>
                        </div>
                    </div>

                    {/* Product Summary */}
                    <div className="p-4 bg-yellow-50/50 border border-yellow-100 rounded-xl text-sm">
                        <div className="flex items-center gap-2 text-yellow-800 font-semibold mb-2">
                            <FileText className="w-4 h-4" /> Item Description
                        </div>
                        <div className="text-slate-700 font-medium">{transaction.productName || "N/A"}</div>
                        {transaction.productDescription && (
                            <div className="text-slate-500 mt-1">{transaction.productDescription}</div>
                        )}
                    </div>
                </div>

                {/* Destructive Arbitrations */}
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                    <button 
                        onClick={onClose}
                        disabled={actionLoading}
                        className="px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition"
                    >
                        Keep in Escrow
                    </button>
                    <div className="flex gap-3">
                        <button
                            onClick={handleRefund}
                            disabled={actionLoading || ["refunded", "released", "cancelled", "completed"].includes(transaction.status)}
                            className="px-4 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 font-semibold rounded-lg shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Refund Buyer
                        </button>
                        <button
                            onClick={handleRelease}
                            disabled={actionLoading || ["refunded", "released", "cancelled", "completed", "pending"].includes(transaction.status)}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-sm transition disabled:opacity-50 flex items-center gap-2 disabled:cursor-not-allowed"
                        >
                            <CheckCircle className="w-4 h-4" />
                            {actionLoading ? "Processing..." : "Release to Seller"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
