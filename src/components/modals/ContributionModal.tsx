"use client";

import { useState, useEffect } from "react";
import { useActionState } from "react";
import { X, DollarSign, AlertCircle, CheckCircle, TrendingUp, TrendingDown } from "lucide-react";
import Modal from "@/components/ui/Modal";
import LoadingButton from "@/components/ui/LoadingButton";
import { useToast } from "@/contexts/ToastContext";
import { makeContributionAction } from "@/app/actions/cooperative";
import type { MakeContributionState } from "@/lib/types/cooperative";

const initialState: MakeContributionState = { error: "Initializing...", success: false };

interface ContributionModalProps {
    isOpen: boolean;
    onClose: () => void;
    cooperativeId: string;
    currentBalance: number;
    loanBalance: number;
}

export default function ContributionModal({
    isOpen,
    onClose,
    cooperativeId,
    currentBalance,
    loanBalance
}: ContributionModalProps) {
    const [state, formAction, isPending] = useActionState(makeContributionAction, initialState);
    const [contributionType, setContributionType] = useState<"savings" | "loan_repayment">("savings");
    const { showToast } = useToast();

    // Handle success/error with toasts
    useEffect(() => {
        if (state.success && !isPending) {
            showToast("Contribution submitted successfully!", "success");
            setTimeout(() => {
                onClose();
                window.location.reload();
            }, 1500);
        } else if (state.error && !state.success && state.error !== "Initializing...") {
            showToast(state.error, "error");
        }
    }, [state.success, state.error, isPending, onClose, showToast]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Make Contribution">
            <form action={formAction} className="space-y-4">
                {/* Hidden cooperativeId field */}
                <input type="hidden" name="cooperativeId" value={cooperativeId} />

                {/* Error Display */}
                {state.error && !state.success && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-red-300 text-sm">{state.error}</p>
                    </div>
                )}

                {/* Success Display */}
                {state.success && state.message && (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                        <p className="text-green-300 text-sm font-medium">{state.message}</p>
                    </div>
                )}

                {/* Current Balances Display */}
                <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-xl">
                    <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Savings Balance</p>
                        <p className="text-lg font-bold text-green-600 dark:text-green-400">
                            ₦{currentBalance.toLocaleString()}
                        </p>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Loan Balance</p>
                        <p className="text-lg font-bold text-red-600 dark:text-red-400">
                            ₦{loanBalance.toLocaleString()}
                        </p>
                    </div>
                </div>

                {/* Contribution Type Selection */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Contribution Type
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setContributionType("savings")}
                            className={`px-4 py-3 rounded-xl border-2 font-semibold transition ${contributionType === "savings"
                                ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-400"
                                : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
                                }`}
                        >
                            <TrendingUp className="w-5 h-5 mx-auto mb-1" />
                            Savings
                        </button>
                        <button
                            type="button"
                            onClick={() => setContributionType("loan_repayment")}
                            disabled={loanBalance === 0}
                            className={`px-4 py-3 rounded-xl border-2 font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${contributionType === "loan_repayment"
                                ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-400"
                                : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
                                }`}
                        >
                            <TrendingDown className="w-5 h-5 mx-auto mb-1" />
                            Loan Repayment
                        </button>
                    </div>
                    <input type="hidden" name="type" value={contributionType} />
                </div>

                {/* Amount Input */}
                <div>
                    <label htmlFor="amount" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        <DollarSign className="w-4 h-4 inline mr-2" />
                        Amount (₦)
                    </label>
                    <input
                        type="number"
                        id="amount"
                        name="amount"
                        required
                        min="100"
                        step="100"
                        placeholder="e.g., 50000"
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent transition"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {contributionType === "savings"
                            ? "Minimum: ₦100"
                            : `Maximum: ₦${loanBalance.toLocaleString()} (current loan balance)`
                        }
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isPending}
                        className="flex-1 px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isPending}
                        className="flex-1 px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPending ? "Processing..." : `Make ${contributionType === "savings" ? "Savings" : "Payment"}`}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
