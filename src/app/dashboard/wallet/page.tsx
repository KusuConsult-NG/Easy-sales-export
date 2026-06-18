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
    ChevronDown, Download, Share2, Image as ImageIcon
} from "lucide-react";
import {
    getWalletAction,
    getWalletTransactionsAction,
    fundWalletViaPaystackAction,
    withdrawFromWalletAction,
} from "@/app/actions/wallet";
import { getFeatureTogglesAction } from "@/app/actions/health";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";

const fmt = (n: number = 0) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n || 0);

const fmtDate = (val: any) => {
    if (!val) return "—";
    const d = val?.toDate ? val.toDate() : new Date(val);
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

const NIGERIAN_BANKS = [
    { name: "Access Bank", code: "044" },
    { name: "Zenith Bank", code: "057" },
    { name: "GTBank", code: "058" },
    { name: "First Bank", code: "011" },
    { name: "UBA", code: "033" },
    { name: "Fidelity Bank", code: "070" },
    { name: "FCMB", code: "214" },
    { name: "Stanbic IBTC", code: "221" },
    { name: "Sterling Bank", code: "232" },
    { name: "Wema Bank", code: "035" },
];

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
    const { data: session } = useSession();
    const userName = session?.user?.name || "User";
    const userEmail = session?.user?.email;

    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [receiptTxn, setReceiptTxn] = useState<any | null>(null);

    const [wallet, setWallet] = useState<{
        balance: number;
        currency: string;
        stats?: {
            totalFunded: number;
            totalSpent: number;
            pendingWithdrawals: number;
        };
        bankDetails?: {
            accountNumber: string;
            bankCode: string;
            accountName: string;
            bankName: string;
        } | null;
    } | null>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
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
    const [toggles, setToggles] = useState<Record<string, boolean>>({});

    const [bankSearch, setBankSearch] = useState("");
    const [showBankDropdown, setShowBankDropdown] = useState(false);

    const downloadAsPDF = async (txn: any) => {
        const cardElement = document.getElementById("receipt-download-card");
        if (!cardElement) return showToast("Receipt element not found", "error");

        try {
            const html2canvasModule = await import("html2canvas");
            const html2canvas = html2canvasModule.default || html2canvasModule;
            const jspdfModule = await import("jspdf");
            const jsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;

            const canvas = await html2canvas(cardElement, {
                scale: 2,
                backgroundColor: "#ffffff",
                useCORS: true,
            });

            const imgData = canvas.toDataURL("image/jpeg", 1.0);
            const pdf = new jsPDF({
                orientation: "portrait",
                unit: "px",
                format: [canvas.width / 2, canvas.height / 2],
            });

            pdf.addImage(imgData, "JPEG", 0, 0, canvas.width / 2, canvas.height / 2);
            pdf.save(`receipt-${txn.id}.pdf`);
            showToast("PDF receipt downloaded", "success");
        } catch (error: any) {
            console.error("Failed to download PDF:", error);
            showToast(`Could not generate PDF: ${error?.message || error}`, "error");
        }
    };

    const downloadAsJPEG = async (txn: any) => {
        const cardElement = document.getElementById("receipt-download-card");
        if (!cardElement) return showToast("Receipt element not found", "error");

        try {
            const html2canvasModule = await import("html2canvas");
            const html2canvas = html2canvasModule.default || html2canvasModule;
            const canvas = await html2canvas(cardElement, {
                scale: 2,
                backgroundColor: "#ffffff",
                useCORS: true,
            });

            const link = document.createElement("a");
            link.download = `receipt-${txn.id}.jpg`;
            link.href = canvas.toDataURL("image/jpeg", 0.95);
            link.click();
            showToast("JPEG receipt downloaded", "success");
        } catch (error: any) {
            console.error("Failed to download JPEG:", error);
            showToast(`Could not generate image: ${error?.message || error}`, "error");
        }
    };

    const shareReceipt = async (txn: any) => {
        const cardElement = document.getElementById("receipt-download-card");
        if (!cardElement) return showToast("Receipt element not found", "error");

        try {
            const html2canvasModule = await import("html2canvas");
            const html2canvas = html2canvasModule.default || html2canvasModule;
            const canvas = await html2canvas(cardElement, {
                scale: 2,
                backgroundColor: "#ffffff",
                useCORS: true,
            });

            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
            if (!blob) throw new Error("Failed to create blob");

            const file = new File([blob], `receipt-${txn.id}.jpg`, { type: "image/jpeg" });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: "Transaction Receipt",
                    text: `Transaction receipt for ${fmt(Math.abs(txn.amount))}`,
                });
            } else if (navigator.share) {
                await navigator.share({
                    title: "Transaction Receipt",
                    text: `Easy Sales transaction receipt for ${fmt(Math.abs(txn.amount))}. ID: ${txn.id}`,
                });
            } else {
                const link = document.createElement("a");
                link.download = `receipt-${txn.id}.jpg`;
                link.href = canvas.toDataURL("image/jpeg", 0.95);
                link.click();
                showToast("Sharing not supported, downloading instead", "info");
            }
        } catch (error: any) {
            console.error("Error sharing receipt:", error);
            showToast(`Could not share receipt: ${error?.message || error}`, "error");
        }
    };

    useEffect(() => {
        setBankSearch(wdBank.bankName || "");
    }, [wdBank.bankName]);

    const loadToggles = useCallback(async () => {
        const res = await getFeatureTogglesAction();
        if (res.success && res.data) setToggles(res.data);
    }, []);

    const loadWallet = useCallback(async () => {
        setLoading(true);
        const res = await getWalletAction();
        if (res.success && res.data) {
            setWallet(res.data);
            if (res.data.bankDetails) {
                setWdBank(res.data.bankDetails);
            }
        }
        else showToast(res.error || "Failed to load wallet", "error");
        setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadTransactions = useCallback(async (reset = false) => {
        setTxLoading(true);
        const cursor = reset ? undefined : lastId;
        const res = await getWalletTransactionsAction({ limit: 15, startAfter: cursor });
        if (res.success && res.data?.transactions) {
            setTransactions(prev => reset ? res.data!.transactions : [...prev, ...res.data!.transactions]);
            setHasMore(!!res.data.hasMore);
            if (res.data.transactions.length > 0)
                setLastId(res.data.transactions[res.data.transactions.length - 1].id);
        }
        setTxLoading(false);
    }, [lastId]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadToggles(); loadWallet(); loadTransactions(true); }, []);

    async function handleFund() {
        const amount = Number(fundAmount);
        if (!amount || amount < 100) return showToast("Minimum ₦100", "error");
        setFundLoading(true);
        const res = await fundWalletViaPaystackAction(amount);
        if (res.success && res.data?.authorizationUrl) {
            showToast("Redirecting to payment...", "success");
            window.location.href = res.data.authorizationUrl;
        } else {
            showToast(res.error || "Funding failed", "error");
            setFundLoading(false);
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
                            {toggles.wallet_deposits && (
                                <button
                                    onClick={() => setShowFund(true)}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-white text-green-700 font-bold rounded-xl hover:bg-green-50 transition shadow"
                                >
                                    <Plus className="w-4 h-4" /> Fund Wallet
                                </button>
                            )}
                            
                            {toggles.wallet_withdrawals && (
                                <button
                                    onClick={() => setShowWithdraw(true)}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-white/20 text-white font-bold rounded-xl hover:bg-white/30 transition border border-white/30"
                                >
                                    <ArrowUpCircle className="w-4 h-4" /> Withdraw
                                </button>
                            )}
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
                            value: fmt(wallet?.stats?.totalFunded || 0),
                            icon: ArrowDownCircle, color: "text-green-600 bg-green-50",
                        },
                        {
                            label: "Total Spent",
                            value: fmt(wallet?.stats?.totalSpent || 0),
                            icon: ArrowUpCircle, color: "text-orange-600 bg-orange-50",
                        },
                        {
                            label: "Pending Withdrawals",
                            value: fmt(wallet?.stats?.pendingWithdrawals || 0),
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
                                    <div
                                        key={txn.id}
                                        onClick={() => setExpandedTxId(expandedTxId === txn.id ? null : txn.id)}
                                        className="px-6 py-4 hover:bg-slate-50 transition cursor-pointer border-b border-slate-100 last:border-0"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isDebit ? "bg-red-50" : "bg-green-50"}`}>
                                                <TypeIcon className={`w-5 h-5 ${isDebit ? "text-red-500" : "text-green-600"}`} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-slate-900 text-sm truncate">{txn.description}</p>
                                                <p className="text-xs text-slate-400 mt-0.5">{fmtDate(txn.createdAt)}</p>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="text-right">
                                                    <p className={`font-bold text-sm ${isDebit ? "text-red-600" : "text-green-600"}`}>
                                                        {isDebit ? "-" : "+"}{fmt(Math.abs(txn.amount))}
                                                    </p>
                                                    <StatusBadge status={txn.status} />
                                                </div>
                                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${expandedTxId === txn.id ? "rotate-180" : ""}`} />
                                            </div>
                                        </div>

                                        {/* Expanded details */}
                                        {expandedTxId === txn.id && (
                                            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl">
                                                <div>
                                                    <p className="text-slate-500 font-semibold mb-0.5">Transaction ID</p>
                                                    <p className="font-mono text-slate-800 select-all">{txn.id}</p>
                                                </div>
                                                {txn.reference && (
                                                    <div>
                                                        <p className="text-slate-500 font-semibold mb-0.5">Reference</p>
                                                        <p className="font-mono text-slate-800">{txn.reference}</p>
                                                    </div>
                                                )}
                                                {txn.orderId && (
                                                    <div>
                                                        <p className="text-slate-500 font-semibold mb-0.5">Order ID</p>
                                                        <p className="font-mono text-slate-800">{txn.orderId}</p>
                                                    </div>
                                                )}
                                                <div>
                                                    <p className="text-slate-500 font-semibold mb-0.5">Transaction Type</p>
                                                    <p className="text-slate-800 capitalize font-medium">{txn.type}</p>
                                                </div>
                                                {(txn.balanceBefore !== undefined || txn.balanceAfter !== undefined) && (
                                                    <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-4">
                                                        <div>
                                                            <p className="text-slate-500 font-semibold mb-0.5">Balance Before</p>
                                                            <p className="text-slate-800 font-medium">{fmt(txn.balanceBefore)}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-slate-500 font-semibold mb-0.5">Balance After</p>
                                                            <p className="text-slate-800 font-medium">{fmt(txn.balanceAfter)}</p>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="col-span-1 md:col-span-2 border-t border-slate-200/60 pt-3 mt-1 flex flex-wrap gap-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setReceiptTxn(txn);
                                                            setShowReceiptModal(true);
                                                        }}
                                                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition font-semibold text-xs"
                                                    >
                                                        <Share2 className="w-3.5 h-3.5" /> View & Share Receipt
                                                    </button>
                                                </div>
                                            </div>
                                        )}
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
                        <p className="text-slate-500 text-sm mb-5">Minimum withdrawal: ₦5,000. Withdrawals are subject to a 24-hour processing hold.</p>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Amount (₦)</label>
                                <input type="number" value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} placeholder="Min ₦5,000"
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                            </div>
                            <div className="relative">
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Bank Name</label>
                                <input
                                    type="text"
                                    value={bankSearch}
                                    onFocus={() => setShowBankDropdown(true)}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        setBankSearch(val);
                                        setShowBankDropdown(true);
                                        if (!val) {
                                            setWdBank(b => ({ ...b, bankName: "", bankCode: "" }));
                                        }
                                    }}
                                    placeholder="Type to search bank... (e.g. Access Bank)"
                                    className="w-full px-4 py-3 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                />
                                {showBankDropdown && (
                                    <>
                                        <div 
                                            className="fixed inset-0 z-40" 
                                            onClick={() => setShowBankDropdown(false)} 
                                        />
                                        <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg divide-y divide-slate-100">
                                            {NIGERIAN_BANKS.filter(bank =>
                                                bank.name.toLowerCase().includes(bankSearch.toLowerCase())
                                            ).length === 0 ? (
                                                <div className="p-3 text-slate-500 text-sm">No banks found</div>
                                            ) : (
                                                NIGERIAN_BANKS.filter(bank =>
                                                    bank.name.toLowerCase().includes(bankSearch.toLowerCase())
                                                ).map(bank => (
                                                    <button
                                                        key={bank.code}
                                                        type="button"
                                                        onClick={() => {
                                                            setWdBank(b => ({
                                                                ...b,
                                                                bankCode: bank.code,
                                                                bankName: bank.name
                                                            }));
                                                            setBankSearch(bank.name);
                                                            setShowBankDropdown(false);
                                                        }}
                                                        className="w-full text-left px-4 py-3 text-slate-900 hover:bg-slate-50 text-sm transition"
                                                    >
                                                        {bank.name}
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    </>
                                )}
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
                            <p className="text-xs text-yellow-800">The withdrawal amount will be reserved from your balance. Withdrawals are subject to a 24-hour security hold before they can be approved.</p>
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

            {/* Receipt Preview Modal */}
            {showReceiptModal && receiptTxn && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in" onClick={() => setShowReceiptModal(false)}>
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-6 relative" onClick={(e) => e.stopPropagation()}>
                        <button 
                            onClick={() => setShowReceiptModal(false)}
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition"
                        >
                            <XCircle className="w-6 h-6" />
                        </button>

                        <h3 className="text-lg font-bold text-slate-900 text-center">Transaction Receipt</h3>

                        {/* The visible preview card to be captured */}
                        <div className="border border-slate-100 rounded-xl p-1 bg-slate-50 flex justify-center overflow-x-auto">
                            <div 
                                id="receipt-download-card" 
                                className="w-[360px] bg-white text-slate-800 p-6 flex flex-col font-sans shrink-0"
                            >
                                {/* Brand Header */}
                                <div className="flex items-center justify-between border-b-2 border-emerald-500 pb-3 mb-5">
                                    <div>
                                        <h2 className="text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-1.5">
                                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                                            EASY SALES
                                        </h2>
                                        <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Export & Agro-Allied</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                            Receipt
                                        </span>
                                    </div>
                                </div>

                                {/* Transaction Amount & Status */}
                                <div className="text-center bg-slate-50 rounded-xl py-5 px-3 mb-5 border border-slate-100">
                                    <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1">Amount</p>
                                    <p className={`text-xl font-black ${receiptTxn.amount < 0 ? 'text-slate-900' : 'text-emerald-600'}`}>
                                        {receiptTxn.amount < 0 ? '-' : '+'}{fmt(Math.abs(receiptTxn.amount))}
                                    </p>
                                    <div className="mt-1.5 inline-block">
                                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${
                                            receiptTxn.status === 'completed' ? 'bg-green-100 text-green-700' :
                                            receiptTxn.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                            'bg-red-100 text-red-700'
                                        }`}>
                                            {receiptTxn.status}
                                        </span>
                                    </div>
                                </div>

                                {/* Transaction Details */}
                                <div className="space-y-2.5 text-[10px] pb-5 border-b border-dashed border-slate-200">
                                    <div className="flex justify-between items-start gap-4">
                                        <span className="text-slate-400 font-medium">Date & Time</span>
                                        <span className="text-slate-800 font-semibold text-right">{fmtDate(receiptTxn.createdAt)}</span>
                                    </div>
                                    <div className="flex justify-between items-start gap-4">
                                        <span className="text-slate-400 font-medium">Transaction ID</span>
                                        <span className="text-slate-800 font-mono font-medium text-right select-all truncate max-w-[140px]">{receiptTxn.id}</span>
                                    </div>
                                    {receiptTxn.reference && (
                                        <div className="flex justify-between items-start gap-4">
                                            <span className="text-slate-400 font-medium">Reference</span>
                                            <span className="text-slate-800 font-mono font-medium text-right truncate max-w-[140px]">{receiptTxn.reference}</span>
                                        </div>
                                    )}
                                    {receiptTxn.orderId && (
                                        <div className="flex justify-between items-start gap-4">
                                            <span className="text-slate-400 font-medium">Order ID</span>
                                            <span className="text-slate-800 font-mono font-medium text-right truncate max-w-[140px]">{receiptTxn.orderId}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-start gap-4">
                                        <span className="text-slate-400 font-medium">Type</span>
                                        <span className="text-slate-800 font-semibold capitalize text-right">{receiptTxn.type}</span>
                                    </div>
                                    <div className="flex justify-between items-start gap-4">
                                        <span className="text-slate-400 font-medium">Description</span>
                                        <span className="text-slate-800 font-semibold text-right max-w-[150px] truncate">{receiptTxn.description}</span>
                                    </div>

                                    {/* Customer Details */}
                                    <div className="pt-2.5 border-t border-slate-100 mt-2 space-y-2.5">
                                        <div className="flex justify-between items-start gap-4">
                                            <span className="text-slate-400 font-medium">Customer</span>
                                            <span className="text-slate-800 font-semibold text-right">{userName}</span>
                                        </div>
                                        {userEmail && (
                                            <div className="flex justify-between items-start gap-4">
                                                <span className="text-slate-400 font-medium">Email</span>
                                                <span className="text-slate-800 font-semibold text-right truncate max-w-[150px]">{userEmail}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="text-center mt-5">
                                    <p className="text-[8px] text-slate-400 font-medium">
                                        Thank you for transacting with Easy Sales & Export.
                                    </p>
                                    <p className="text-[7px] text-slate-300 mt-1">
                                        This is an official computer-generated receipt and requires no signature.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col sm:flex-row gap-2 pt-2">
                            <button
                                onClick={() => downloadAsPDF(receiptTxn)}
                                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition flex items-center justify-center gap-2 shadow cursor-pointer"
                            >
                                <Download className="w-4 h-4" /> PDF
                            </button>
                            <button
                                onClick={() => downloadAsJPEG(receiptTxn)}
                                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition flex items-center justify-center gap-2 shadow cursor-pointer"
                            >
                                <ImageIcon className="w-4 h-4" /> JPEG
                            </button>
                            <button
                                onClick={() => shareReceipt(receiptTxn)}
                                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <Share2 className="w-4 h-4" /> Share
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
