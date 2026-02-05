"use client";

import { useFormState } from "react-dom";
import { Wallet, Loader2, AlertCircle, CheckCircle, Info } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { submitWithdrawalAction, type WithdrawalActionState } from "@/app/actions/platform";
import { formatCurrency } from "@/lib/utils";

const initialState: WithdrawalActionState = { error: "Initializing...", success: false };

interface WithdrawalModalProps {
    isOpen: boolean;
    onClose: () => void;
    cooperativeId: string;
    availableBalance: number;
}

export default function WithdrawalModal({
    isOpen,
    onClose,
    cooperativeId,
    availableBalance
}: WithdrawalModalProps) {
    const [state, formAction, isPending] = useFormState(submitWithdrawalAction, initialState);

    // Close modal on success
    if (state.success && !isPending) {
        setTimeout(() => {
            onClose();
            window.location.reload(); // Refresh to show updated balance
        }, 2000);
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Request Withdrawal">
            <form action={formAction} className="space-y-6">
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
                        <div>
                            <p className="text-green-300 text-sm font-medium">{state.message}</p>
                            <p className="text-green-400/70 text-xs mt-1">
                                Your request will be reviewed within 1-2 business days
                            </p>
                        </div>
                    </div>
                )}

                {/* Available Balance Display */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Available Balance</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">
                        {formatCurrency(availableBalance)}
                    </p>
                </div>

                {/* Info Alert */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-300">
                        <p className="font-semibold mb-1">Withdrawal Processing Time</p>
                        <p className="text-blue-400/80">
                            Withdrawals are processed manually by admin and typically take 1-2 business days.
                            You'll be notified once approved.
                        </p>
                    </div>
                </div>

                {/* Withdrawal Amount */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        <Wallet className="w-4 h-4 inline mr-2" />
                        Withdrawal Amount (NGN) *
                    </label>
                    <input
                        type="number"
                        name="amount"
                        min="100"
                        max={availableBalance}
                        step="0.01"
                        required
                        placeholder="0.00"
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Maximum: {formatCurrency(availableBalance)}
                    </p>
                </div>

                {/* Bank Account Selection */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Bank Account *
                    </label>
                    <select
                        name="bankAccount"
                        required
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                    >
                        <option value="">Select bank account</option>
                        <option value="primary">Primary Account (****1234)</option>
                        <option value="secondary">Secondary Account (****5678)</option>
                    </select>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Select the account to receive funds
                    </p>
                </div>

                {/* Reason (Optional) */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Reason (Optional)
                    </label>
                    <textarea
                        name="reason"
                        rows={3}
                        placeholder="Briefly explain why you need this withdrawal..."
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                    />
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
                        disabled={isPending || availableBalance === 0}
                        className="flex-1 px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isPending ? "Submitting..." : "Request Withdrawal"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
