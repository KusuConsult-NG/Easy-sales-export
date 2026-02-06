"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, Lock, Truck, CheckCircle, AlertTriangle, X, MessageCircle } from "lucide-react";
import { EscrowStatus, type Transaction } from "@/types/strict";
import {
    getUserEscrowTransactions,
    updateEscrowStatus,
    createEscrowDispute,
    releaseEscrowFunds
} from "@/app/actions/escrow-actions";
import { formatCurrency } from "@/lib/utils";

const STEPS = [
    {
        key: EscrowStatus.PENDING,
        label: "Payment Pending",
        icon: Clock,
        description: "Waiting for payment confirmation"
    },
    {
        key: EscrowStatus.HELD,
        label: "Funds Held",
        icon: Lock,
        description: "Payment secured in escrow"
    },
    {
        key: EscrowStatus.DISPUTED,
        label: "In Delivery/Dispute",
        icon: Truck,
        description: "Product being delivered or under dispute"
    },
    {
        key: EscrowStatus.RELEASED,
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

export function EscrowStepper({ currentStatus, transactionId, onStatusChange }: EscrowStepperProps) {
    const getStepIndex = (status: EscrowStatus) =>
        STEPS.findIndex(s => s.key === status);

    const currentIndex = getStepIndex(currentStatus);

    return (
        <div className="w-full py-8">
            {/* Stepper Progress */}
            <div className="flex items-center justify-between mb-12 relative">
                {/* Progress Line */}
                <div className="absolute top-6 left-0 right-0 h-1 bg-slate-200 dark:bg-slate-700 -z-10" />
                <motion.div
                    className="absolute top-6 left-0 h-1 bg-[#1358ec] -z-10"
                    initial={{ width: "0%" }}
                    animate={{
                        width: currentStatus === EscrowStatus.CANCELLED
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
                    const isCancelled = currentStatus === EscrowStatus.CANCELLED;

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
                                        ? 'bg-gray-300 dark:bg-gray-700'
                                        : isCompleted
                                            ? 'bg-green-600 dark:bg-green-500'
                                            : isActive
                                                ? 'bg-[#1358ec] dark:bg-[#1358ec]'
                                                : 'bg-slate-200 dark:bg-slate-700'
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
                                    <Icon className={`w-7 h-7 ${isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'
                                        }`} />
                                )}
                            </motion.div>

                            {/* Step Label */}
                            <div className="mt-3 text-center">
                                <p className={`text-sm font-semibold ${isActive
                                    ? 'text-[#1358ec] dark:text-[#1358ec]'
                                    : isCompleted
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-slate-400 dark:text-slate-500'
                                    }`}>
                                    {step.label}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
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
            {currentStatus === EscrowStatus.CANCELLED && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-3"
                >
                    <X className="w-6 h-6 text-red-600 dark:text-red-400" />
                    <div>
                        <p className="font-semibold text-red-900 dark:text-red-100">Transaction Cancelled</p>
                        <p className="text-sm text-red-700 dark:text-red-300">This escrow transaction has been cancelled.</p>
                    </div>
                </motion.div>
            )}

            {/* Disputed Status */}
            {currentStatus === EscrowStatus.DISPUTED && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl flex items-center gap-3"
                >
                    <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                    <div>
                        <p className="font-semibold text-yellow-900 dark:text-yellow-100">Transaction Under Dispute</p>
                        <p className="text-sm text-yellow-700 dark:text-yellow-300">This transaction is being reviewed by our team.</p>
                    </div>
                </motion.div>
            )}
        </div>
    );
}

export default function EscrowDashboardPage() {
    const router = useRouter();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTab, setSelectedTab] = useState<'all' | 'farm-nation' | 'marketplace' | 'export'>('all');

    useEffect(() => {
        loadTransactions();
    }, []);

    async function loadTransactions() {
        setLoading(true);
        const result = await getUserEscrowTransactions();
        if (result.success && result.transactions) {
            setTransactions(result.transactions as Transaction[]);
        }
        setLoading(false);
    }

    const filteredTransactions = transactions.filter(t => {
        if (selectedTab === 'all') return true;
        // Filter by product type (would need productType field in Transaction)
        return true;
    });

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8"
                >
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Escrow Dashboard
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
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
                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
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
                        className="text-center py-12 bg-white dark:bg-slate-800 rounded-2xl"
                    >
                        <Lock className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <p className="text-slate-600 dark:text-slate-400">No escrow transactions yet</p>
                    </motion.div>
                ) : (
                    <div className="space-y-6">
                        {filteredTransactions.map((transaction, index) => (
                            <motion.div
                                key={transaction.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg"
                            >
                                <div className="flex justify-between items-start mb-6">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                                            Transaction #{transaction.id.slice(0, 8)}
                                        </h3>
                                        <p className="text-2xl font-bold text-[#1358ec]">
                                            {formatCurrency(transaction.amount)}
                                        </p>
                                    </div>
                                    <div className="text-right text-sm text-slate-500 dark:text-slate-400">
                                        <p>{transaction.createdAt?.toLocaleDateString()}</p>
                                    </div>
                                </div>

                                <EscrowStepper
                                    currentStatus={transaction.status}
                                    transactionId={transaction.id}
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
                                    {transaction.status === EscrowStatus.HELD && (
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
