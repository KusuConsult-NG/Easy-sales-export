/**
 * Wallet Dashboard — /dashboard/wallet
 * 
 * Displays balance, fund/withdraw actions, and transaction history
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Wallet, ArrowDownCircle, ArrowUpCircle, Plus, History,
    Loader2, AlertCircle, CheckCircle, Clock, XCircle, RefreshCw,
} from "lucide-react";
import {
    getWalletAction,
    getWalletTransactionsAction,
    fundWalletViaPaystackAction,
    withdrawFromWalletAction,
} from "@/app/actions/wallet";
import { useToast } from "@/contexts/ToastContext";

const fmt = (n: number = 0) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n || 0);

const fmtDate = (val: any) => {
    if (!val) return "—";
    const d = val?.toDate ? val.toDate() : new Date(val);
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        completed: "bg-green-100 text-green-700",
        pending: "bg-yellow-100 text-yellow-700",
        failed: "bg-red-100 text-red-700",
    };
    return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${map[status] || "bg-slate-100 text-slate-600"}`}>
            {status}
        </span>
    );
}

export default function WalletPage() {
    const { showToast } = useToast();

    const [wallet, setWallet] = useState<{ balance: number; currency: string } | null>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [txLoading, setTxLoading] = useState(false);
    const [lastId, setLastId] = useState<string | undefined>();

    /* ─── Fund modal state ───────────────────────────────── */
    const [showFund, setShowFund] = useState(false);
    const [fundAmount, setFundAmount] = useState("");
    const [fundLoading, setFundLoading] = useState(false);

    /* ─── Withdraw modal state ──────────────────────────── */
    const [showWithdraw, setShowWithdraw] = useState(false);
    const [wdAmount, setWdAmount] = useState("");
    const [wdBank, setWdBank] = useState({ accountNumber: "", bankCode: "", accountName: "", bankName: "" });
    const [wdLoading, setWdLoading] = useState(false);

    const loadWallet = useCallback(async () => {
        setLoading(true);
        const res = await getWalletAction();
        if (res.success && res.wallet) setWallet(res.wallet);
        else showToast(res.error || "Failed to load wallet", "error");
        setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadTransactions = useCallback(async (reset = false) => {
        setTxLoading(true);
        const cursor = reset ? undefined : lastId;
        const res = await getWalletTransactionsAction({ limit: 15, startAfter: cursor });
        if (res.success && res.transactions) {
            setTransactions(prev => reset ? res.transactions! : [...prev, ...res.transactions!]);
            setHasMore(!!res.hasMore);
            if (res.transactions.length > 0)
                setLastId(res.transactions[res.transactions.length - 1].id);
        }
        setTxLoading(false);
    }, [lastId]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadWallet(); loadTransactions(true); }, []);

    async function handleFund() {
        const amount = Number(fundAmount);
        if (!amount || amount < 100) return showToast("Minimum ₦100", "error");
        setFundLoading(true);
        const res = await fundWalletViaPaystackAction(amount);
        setFundLoading(false);
        if (res.success && res.authorizationUrl) {
            showToast("Redirecting to Paystack…", "info");
            window.location.href = res.authorizationUrl;
        } else {
            showToast(res.error || "Failed", "error");
        }
    };

    async function handleWithdraw() {
        const amount = Number(wdAmount);
        if (!amount || amount < 5000) return showToast("Minimum withdrawal is ₦5,000", "error");
        if (!wdBank.accountNumber || !wdBank.bankName || !wdBank.accountName)
            return showToast("All bank details are required", "error");
        setWdLoading(true);
        const res = await withdrawFromWalletAction(amount, wdBank);
        setWdLoading(false);
        if (res.success) {
            showToast("Withdrawal request submitted. Admin will process it shortly.", "success");
            setShowWithdraw(false);
            setWdAmount("");
            loadWallet();
            loadTransactions(true);
        } else {
            showToast(res.error || "Failed", "error");
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-green-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-6 py-6">
                    <h1 className="text-3xl font-bold text-slate-900 mb-1">My Wallet</h1>
                    <p className="text-slate-600">Fund your wallet and pay for orders instantly</p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
                {/* Balance Card */}
                <div className="relative overflow-hidden bg-linear-to-br from-green-600 to-emerald-700 rounded-2xl p-8 text-white shadow-xl shadow-green-600/20">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
                    <div className="relative">
                        <div className="flex items-center gap-2 mb-4 opacity-80">
                            <Wallet className="w-5 h-5" />
                            <span className="text-sm font-medium">Available Balance</span>
                        </div>
                        <p className="text-5xl font-bold tracking-tight mb-6">
                            {fmt(wallet?.balance || 0)}
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowFund(true)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-white text-green-700 font-bold rounded-xl hover:bg-green-50 transition shadow"
                            >
                                <Plus className="w-4 h-4" /> Fund Wallet
                            </button>
                            <button
                                onClick={() => setShowWithdraw(true)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-white/20 text-white font-bold rounded-xl hover:bg-white/30 transition border border-white/30"
                            >
                                <ArrowUpCircle className="w-4 h-4" /> Withdraw
                            </button>
                            <button
                                onClick={() => { loadWallet(); loadTransactions(true); }}
                                className="p-2.5 bg-white/20 text-white rounded-xl hover:bg-white/30 transition border border-white/30"
                                title="Refresh"
                            >
                                <RefreshCw className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-3 gap-4">
                    {[
                        {
                            label: "Total Funded",
                            value: fmt(transactions.filter(t => t.type === "funding" && t.status === "completed").reduce((s: number, t: any) => s + t.amount, 0)),
                            icon: ArrowDownCircle, color: "text-green-600 bg-green-50",
                        },
                        {
                            label: "Total Spent",
                            value: fmt(Math.abs(transactions.filter(t => t.type === "purchase").reduce((s: number, t: any) => s + t.amount, 0))),
                            icon: ArrowUpCircle, color: "text-orange-600 bg-orange-50",
                        },
                        {
                            label: "Pending Withdrawals",
                            value: fmt(Math.abs(transactions.filter(t => t.type === "withdrawal" && t.status === "pending").reduce((s: number, t: any) => s + t.amount, 0))),
                            icon: Clock, color: "text-yellow-600 bg-yellow-50",
                        },
                    ].map(({ label, value, icon: Icon, color }) => (
                        <div key={label} className="bg-white rounded-xl border border-slate-200 p-5">
                            <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center mb-3`}>
                                <Icon className="w-5 h-5" />
                            </div>
                            <p className="text-xl font-bold text-slate-900">{value}</p>
                            <p className="text-sm text-slate-500 mt-0.5">{label}</p>
                        </div>
                    ))}
                </div>

                {/* Transaction History */}
                <div className="bg-white rounded-2xl border border-slate-200">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                            <History className="w-5 h-5 text-slate-600" />
                            <h2 className="text-lg font-bold text-slate-900">Transaction History</h2>
                        </div>
                    </div>

                    {txLoading && transactions.length === 0 ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-green-600" />
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="text-center py-16">
                            <Wallet className="w-14 h-14 text-slate-300 mx-auto mb-3" />
                            <p className="text-slate-500 font-medium">No transactions yet</p>
                            <p className="text-slate-400 text-sm">Fund your wallet to get started</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {transactions.map((txn) => {
                                const isDebit = txn.amount < 0;
                                const TypeIcon = txn.type === "funding" ? ArrowDownCircle :
                                    txn.type === "withdrawal" ? ArrowUpCircle :
                                        txn.status === "failed" ? XCircle : ArrowUpCircle;
                                return (
                                    <div key={txn.id} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition">
                                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isDebit ? "bg-red-50" : "bg-green-50"}`}>
                                            <TypeIcon className={`w-5 h-5 ${isDebit ? "text-red-500" : "text-green-600"}`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-slate-900 text-sm truncate">{txn.description}</p>
                                            <p className="text-xs text-slate-400 mt-0.5">{fmtDate(txn.createdAt)}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className={`font-bold text-sm ${isDebit ? "text-red-600" : "text-green-600"}`}>
                                                {isDebit ? "-" : "+"}{fmt(Math.abs(txn.amount))}
                                            </p>
                                            <StatusBadge status={txn.status} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {hasMore && (
                        <div className="px-6 py-4 border-t border-slate-100">
                            <button
                                onClick={() => loadTransactions(false)}
                                disabled={txLoading}
                                className="w-full py-2.5 border border-slate-300 rounded-xl text-slate-700 font-semibold text-sm hover:bg-slate-50 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {txLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                Load More
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Fund Wallet Modal ─────────────────────────── */}
            {showFund && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowFund(false)}>
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-slate-900 mb-1">Fund Wallet</h3>
                        <p className="text-slate-500 text-sm mb-6">You'll be redirected to Paystack to complete the payment.</p>

                        <label className="block text-sm font-semibold text-slate-700 mb-2">Amount (₦)</label>
                        <input
                            type="number"
                            value={fundAmount}
                            onChange={(e) => setFundAmount(e.target.value)}
                            placeholder="e.g. 5000"
                            className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent mb-1"
                        />
                        <p className="text-xs text-slate-400 mb-6">Minimum: ₦100</p>

                        <div className="grid grid-cols-3 gap-2 mb-6">
                            {[1000, 5000, 10000].map((v) => (
                                <button
                                    key={v}
                                    onClick={() => setFundAmount(String(v))}
                                    className="py-2 border border-green-300 text-green-700 rounded-lg text-sm font-semibold hover:bg-green-50 transition"
                                >
                                    {fmt(v)}
                                </button>
                            ))}
                        </div>

                        <div className="flex gap-3">
                            <button onClick={() => setShowFund(false)} className="flex-1 py-3 border border-slate-300 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 transition">Cancel</button>
                            <button
                                onClick={handleFund}
                                disabled={fundLoading}
                                className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {fundLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                Fund Now
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Withdraw Modal ────────────────────────────── */}
            {showWithdraw && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowWithdraw(false)}>
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-slate-900 mb-1">Withdraw Funds</h3>
                        <p className="text-slate-500 text-sm mb-5">Minimum withdrawal: ₦5,000. Processed within 24 hours.</p>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Amount (₦)</label>
                                <input type="number" value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} placeholder="Min ₦5,000"
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Bank Name</label>
                                <input type="text" value={wdBank.bankName} onChange={(e) => setWdBank(b => ({ ...b, bankName: e.target.value }))} placeholder="e.g. Access Bank"
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Account Number</label>
                                <input type="text" value={wdBank.accountNumber} onChange={(e) => setWdBank(b => ({ ...b, accountNumber: e.target.value }))} placeholder="10-digit account number"
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Account Name</label>
                                <input type="text" value={wdBank.accountName} onChange={(e) => setWdBank(b => ({ ...b, accountName: e.target.value }))} placeholder="As it appears on bank account"
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                            </div>
                        </div>

                        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mt-4 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
                            <p className="text-xs text-yellow-800">The withdrawal amount will be immediately reserved from your balance pending admin processing.</p>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setShowWithdraw(false)} className="flex-1 py-3 border border-slate-300 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 transition">Cancel</button>
                            <button
                                onClick={handleWithdraw}
                                disabled={wdLoading}
                                className="flex-1 py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {wdLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
                                Request Withdrawal
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
