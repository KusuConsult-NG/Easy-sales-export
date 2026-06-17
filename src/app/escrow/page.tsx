"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, Lock, Truck, CheckCircle, AlertTriangle, X, MessageCircle } from "lucide-react";
import {
    getUserEscrowTransactions,
    updateEscrowStatus,
    createEscrowDispute,
    releaseEscrowFunds
} from "@/app/actions/marketplace";
import { type EscrowTransaction, type EscrowStatus } from "@/types/escrow";
import { formatCurrency, formatDate } from "@/lib/utils";


const STEPS = [
    {
        key: "pending" as EscrowStatus,
        label: "Payment Pending",
        icon: Clock,
        description: "Waiting for payment confirmation"
    },
    {
        key: "funded" as EscrowStatus,
        label: "Funds Secured",
        icon: Lock,
        description: "Payment secured in escrow"
    },
    {
        key: "in_transit" as EscrowStatus,
        label: "In Transit",
        icon: Truck,
        description: "Product being delivered"
    },
    {
        key: "completed" as EscrowStatus,
        label: "Complete",
        icon: CheckCircle,
        description: "Funds released to seller"
    },
];

interface EscrowStepperProps {
    currentStatus: EscrowStatus;
    transactionId: string;
    onStatusChange?: () => void;
}

function EscrowStepper({ currentStatus, transactionId, onStatusChange }: EscrowStepperProps) {
    const getStepIndex = (status: EscrowStatus) => {
        switch (status) {
            case "pending": return 0;
            case "funded": return 1;
            case "in_transit": return 2;
            case "delivered": return 2; // Show as part of delivery phase
            case "disputed": return 2; // Show warning in delivery phase
            case "completed": return 3;
            case "cancelled": return -1;
            default: return 0;
        }
    };

    const currentIndex = getStepIndex(currentStatus);

    return (
        <div className="w-full py-8">
            {/* Stepper Progress */}
            <div className="flex items-center justify-between mb-12 relative">
                {/* Progress Line */}
                <div className="absolute top-6 left-0 right-0 h-1 bg-slate-200 -z-10" />
                <motion.div
                    className="absolute top-6 left-0 h-1 bg-[#1358ec] -z-10"
                    initial={{ width: "0%" }}
                    animate={{
                        width: currentStatus === "cancelled"
                            ? "0%"
                            : `${(currentIndex / (STEPS.length - 1)) * 100}%`
                    }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                />

                {/* Steps */}
                {STEPS.map((step, index) => {
                    const Icon = step.icon;
                    const isActive = index === currentIndex;
                    const isCompleted = index < currentIndex;
                    const isCancelled = currentStatus === "cancelled";

                    return (
                        <motion.div
                            key={step.key}
                            className="flex flex-col items-center flex-1 relative z-10"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                        >
                            {/* Step Circle */}
                            <motion.div
                                className={`
                  w-14 h-14 rounded-full flex items-center justify-center
                  transition-all duration-300 shadow-lg
                  ${isCancelled
                                        ? 'bg-gray-300'
                                        : isCompleted
                                            ? 'bg-green-600'
                                            : isActive
                                                ? 'bg-[#1358ec]'
                                                : 'bg-slate-200'
                                    }
                `}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.95 }}
                            >
                                {isCompleted ? (
                                    <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    >
                                        <Check className="w-7 h-7 text-white" />
                                    </motion.div>
                                ) : (
                                    <Icon className={`w-7 h-7 ${isActive ? 'text-white' : 'text-slate-400'
                                        }`} />
                                )}
                            </motion.div>

                            {/* Step Label */}
                            <div className="mt-3 text-center">
                                <p className={`text-sm font-semibold ${isActive
                                    ? 'text-[#1358ec]'
                                    : isCompleted
                                        ? 'text-green-600'
                                        : 'text-slate-400'
                                    }`}>
                                    {step.label}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">
                                    {step.description}
                                </p>
                            </div>

                            {/* Status Badge */}
                            {isActive && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="absolute -top-8 bg-[#1358ec] text-white px-3 py-1 rounded-full text-xs font-medium"
                                >
                                    Current
                                </motion.div>
                            )}
                        </motion.div>
                    );
                })}
            </div>

            {/* Cancelled Status */}
            {currentStatus === "cancelled" && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3"
                >
                    <X className="w-6 h-6 text-red-600" />
                    <div>
                        <p className="font-semibold text-red-900">Transaction Cancelled</p>
                        <p className="text-sm text-red-700">This escrow transaction has been cancelled.</p>
                    </div>
                </motion.div>
            )}

            {/* Disputed Status */}
            {currentStatus === "disputed" && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex items-center gap-3"
                >
                    <AlertTriangle className="w-6 h-6 text-yellow-600" />
                    <div>
                        <p className="font-semibold text-yellow-900">Transaction Under Dispute</p>
                        <p className="text-sm text-yellow-700">This transaction is being reviewed by our team.</p>
                    </div>
                </motion.div>
            )}
        </div>
    );
}

export default function EscrowDashboardPage() {
    const router = useRouter();
    const [transactions, setTransactions] = useState<EscrowTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTab, setSelectedTab] = useState<'all' | 'farm-nation' | 'marketplace' | 'export'>('all');

    const loadTransactions = useCallback(async () => {
        setTimeout(() => setLoading(true), 0);
        const result = await getUserEscrowTransactions();
        if (result.success && result.data?.transactions) {
            setTransactions(result.data.transactions);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
         
        loadTransactions();
    }, [loadTransactions]);

    const filteredTransactions = transactions.filter(t => {
        if (selectedTab === 'all') return true;
        // Filter by product type (would need productType field in Transaction)
        return true;
    });

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8"
                >
                    <h1 className="text-4xl font-bold text-slate-900 mb-2">
                        Escrow Dashboard
                    </h1>
                    <p className="text-slate-600">
                        Secure payment protection for Farm Nation, Marketplace, and Export Windows
                    </p>
                </motion.div>

                {/* Tabs */}
                <div className="flex gap-2 mb-8 overflow-x-auto">
                    {[
                        { key: 'all', label: 'All Transactions' },
                        { key: 'farm-nation', label: 'Farm Nation' },
                        { key: 'marketplace', label: 'Marketplace' },
                        { key: 'export', label: 'Export Windows' },
                    ].map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setSelectedTab(tab.key as typeof selectedTab)}
                            className={`px-6 py-3 rounded-xl font-medium transition-all ${selectedTab === tab.key
                                ? 'bg-[#1358ec] text-white shadow-lg'
                                : 'bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Transactions List */}
                {loading ? (
                    <div className="text-center py-12">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#1358ec]" />
                    </div>
                ) : filteredTransactions.length === 0 ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-12 bg-white rounded-2xl"
                    >
                        <Lock className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-600">No escrow transactions yet</p>
                    </motion.div>
                ) : (
                    <div className="space-y-6">
                        {filteredTransactions.map((transaction, index) => (
                            <motion.div
                                key={transaction.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="bg-white rounded-2xl p-6 shadow-lg"
                            >
                                <div className="flex justify-between items-start mb-6">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-900 mb-1">
                                            Transaction #{transaction.id ? transaction.id.slice(0, 8) : '...'}
                                        </h3>
                                        <p className="text-2xl font-bold text-[#1358ec]">
                                            {formatCurrency(transaction.amount ?? transaction.grossAmount)}
                                        </p>
                                    </div>
                                    <div className="text-right text-sm text-slate-500">
                                        <p>{formatDate(transaction.createdAt)}</p>
                                    </div>
                                </div>

                                <EscrowStepper
                                    currentStatus={transaction.status}
                                    transactionId={transaction.id || ""}
                                    onStatusChange={loadTransactions}
                                />

                                {/* Action Buttons */}
                                <div className="flex gap-3 mt-6">
                                    <button
                                        onClick={() => router.push(`/escrow/${transaction.id}/chat`)}
                                        className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition flex items-center justify-center space-x-2"
                                    >
                                        <MessageCircle className="w-4 h-4" />
                                        <span>Chat</span>
                                    </button>
                                    {["funded", "in_transit", "delivered"].includes(transaction.status) && (
                                        <button
                                            onClick={() => router.push(`/escrow/${transaction.id}/dispute`)}
                                            className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl font-medium transition flex items-center justify-center space-x-2"
                                        >
                                            <AlertTriangle className="w-4 h-4" />
                                            <span>Create Dispute</span>
                                        </button>
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
