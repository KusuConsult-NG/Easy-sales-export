"use client";

/**
 * Repay a loan instalment out of cooperative savings.
 *
 * WHY THIS EXISTS
 * ---------------
 * The only repayment affordance a member had on this page was a "Pay Now"
 * button pointing at /cooperatives/payment — which is the membership
 * REGISTRATION FEE page. A borrower trying to pay an instalment was sent to a
 * page asking them for a different payment entirely.
 *
 * THE FLOOR IS SHOWN, NOT JUST ENFORCED
 * -------------------------------------
 * A member may not repay below the ₦5,000 minimum balance. The server applies
 * that under a row lock and is the only thing that decides it; this component
 * shows the same number from the same constant so the refusal is not a surprise
 * that arrives after pressing the button.
 *
 * The button is NOT disabled on the client's arithmetic alone — the balance
 * here was read when the page loaded and may be stale. It submits, and the
 * server's answer is the one that counts.
 */

import { useState } from "react";
import { X, Loader2, PiggyBank, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { repayLoanFromSavingsAction } from "@/app/actions/cooperative";
import {
    COOPERATIVE_MINIMUM_BALANCE,
    availableAboveFloor,
} from "@/lib/cooperative-limits";
import { useToast } from "@/contexts/ToastContext";

interface Props {
    loanId: string;
    installmentId: string;
    installmentNumber: number;
    amountDue: number;
    userId: string;
    savingsBalance: number;
    onClose: () => void;
    onRepaid: () => void;
}

export default function RepayFromSavingsModal({
    loanId,
    installmentId,
    installmentNumber,
    amountDue,
    userId,
    savingsBalance,
    onClose,
    onRepaid,
}: Props) {
    const { showToast } = useToast();
    const [amount, setAmount] = useState(String(amountDue));
    const [saving, setSaving] = useState(false);

    const available = availableAboveFloor(savingsBalance);
    const value = Number(amount);
    const wouldBreachFloor = Number.isFinite(value) && value > 0 && value > available;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!Number.isFinite(value) || value <= 0) {
            return showToast("Enter a valid amount", "error");
        }

        setSaving(true);
        try {
            const res: any = await repayLoanFromSavingsAction({
                loanId,
                installmentId,
                userId,
                amount: value,
            });

            if (res?.success) {
                showToast("Repayment made from your savings", "success");
                onRepaid();
                onClose();
            } else {
                // The server's message already explains the floor in the
                // member's own numbers, so it is shown rather than replaced.
                showToast(res?.error || "Could not make the repayment", "error");
            }
        } catch {
            showToast("Could not make the repayment", "error");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                    <div className="flex items-center gap-2">
                        <PiggyBank className="h-5 w-5 text-green-600" />
                        <h2 className="text-lg font-bold text-slate-900">Repay from Savings</h2>
                    </div>
                    <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                        <div className="flex justify-between py-1">
                            <span className="text-slate-600">Instalment</span>
                            <span className="font-semibold text-slate-900">#{installmentNumber}</span>
                        </div>
                        <div className="flex justify-between py-1">
                            <span className="text-slate-600">Outstanding</span>
                            <span className="font-semibold text-slate-900">{formatCurrency(amountDue)}</span>
                        </div>
                        <div className="flex justify-between py-1">
                            <span className="text-slate-600">Your savings</span>
                            <span className="font-semibold text-slate-900">{formatCurrency(savingsBalance)}</span>
                        </div>
                        <div className="mt-1 flex justify-between border-t border-slate-200 pt-2">
                            <span className="text-slate-600">Available to use</span>
                            <span className="font-bold text-green-700">{formatCurrency(available)}</span>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="repay-amount" className="mb-1 block text-sm font-semibold text-slate-700">
                            Amount to repay
                        </label>
                        <input
                            id="repay-amount"
                            type="number"
                            min="1"
                            step="any"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <p className="mt-1 text-xs text-slate-500">
                            A smaller amount is recorded as a partial payment.
                        </p>
                    </div>

                    <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                            {formatCurrency(COOPERATIVE_MINIMUM_BALANCE)} must remain in your
                            savings, so you can use up to {formatCurrency(available)} of it
                            {wouldBreachFloor ? " — the amount above is more than that." : "."}
                        </span>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                        >
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            Repay {formatCurrency(Number.isFinite(value) && value > 0 ? value : 0)}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
