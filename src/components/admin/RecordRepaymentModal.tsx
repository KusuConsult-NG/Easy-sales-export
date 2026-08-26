"use client";

/**
 * Record a loan repayment that arrived as a bank transfer.
 *
 * WHY THIS EXISTS
 * ---------------
 * Repayments are collected by bank transfer and reconciled by hand.
 * `submitRepaymentAction` was written for exactly that — it claims the bank
 * reference through claimPaymentOnce, so recording the same transfer twice is a
 * no-op rather than crediting the borrower twice — but nothing called it, and
 * its authorisation was self-only, so the admin doing the reconciling could not
 * reach it. The action was hardened and unreachable at the same time.
 *
 * The reference field is the important one. It is the idempotency key, so it
 * must be the actual bank reference: two different transfers need two different
 * references, and re-entering one transfer must reuse its own. A made-up value
 * per attempt would defeat the guard entirely.
 *
 *   #286 THE SCREEN KNEW THE NUMBER IT WAS NOT ENFORCING.
 *
 *        This modal computed `Math.max(0, totalAmount - paidAmount)` and
 *        DISPLAYED it beside the input — "₦50,000 outstanding on this
 *        instalment" — and then validated only `value > 0`. Typing 500,000
 *        against it was accepted, and the server had no upper bound either, so
 *        the instalment went to `paid` with paidAmount far above what was owed
 *        and the excess simply disappeared.
 *
 *        The bound now comes from lib/loan-repayment-amount.ts, which is the
 *        same expression submitRepaymentAction checks. Two spellings of one
 *        quantity is how the displayed figure and the enforced figure drift
 *        apart, and the penalty term makes that easy — which is why the owed
 *        figure shown here also includes the penalty the server settles
 *        against, rather than the subtraction this file used to do inline.
 */

import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { formatLocalDate } from "@/lib/date-utils";
import { amountOwedOn, checkRepaymentAmount } from "@/lib/loan-repayment-amount";
import { getRepaymentScheduleAction, submitRepaymentAction } from "@/app/actions/cooperative";
import { useToast } from "@/contexts/ToastContext";

interface Installment {
    id?: string;
    installmentNumber: number;
    dueDate: any;
    totalAmount: number;
    paidAmount: number;
    status: "pending" | "paid" | "overdue" | "partial";
}

interface Props {
    loanId: string;
    borrowerId: string;
    borrowerName: string;
    onClose: () => void;
    onRecorded: () => void;
}

export default function RecordRepaymentModal({
    loanId,
    borrowerId,
    borrowerName,
    onClose,
    onRecorded,
}: Props) {
    const { showToast } = useToast();
    const [schedule, setSchedule] = useState<Installment[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [installmentId, setInstallmentId] = useState("");
    const [amount, setAmount] = useState("");
    const [reference, setReference] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res: any = await getRepaymentScheduleAction(loanId);
                if (cancelled) return;
                const rows: Installment[] = res?.data?.schedule ?? [];
                setSchedule(rows);
                // Default to the earliest instalment that still owes something,
                // which is the one a hand-reconciled transfer almost always
                // belongs to.
                const next = rows.find((i) => i.status !== "paid");
                if (next?.id) {
                    setInstallmentId(next.id);
                    const owed = amountOwedOn(next);
                    if (owed > 0) setAmount(String(owed));
                }
            } catch {
                if (!cancelled) showToast("Could not load the repayment schedule", "error");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [loanId, showToast]);

    const selected = schedule.find((i) => i.id === installmentId);
    const outstanding = selected ? amountOwedOn(selected) : 0;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!installmentId) return showToast("Choose an instalment", "error");
        if (!selected) return showToast("Choose an instalment", "error");

        // #286. The same rule the action applies, so what the screen refuses and
        // what the server refuses cannot disagree. Refuses rather than capping:
        // quietly reducing what somebody typed is its own surprise, and an admin
        // reconciling a transfer needs to know the figure does not match.
        const bound = checkRepaymentAmount(amount, selected);
        if (!bound.ok) return showToast(bound.message, "error");

        const value = Number(amount);

        if (!reference.trim()) return showToast("Enter the bank reference", "error");

        setSaving(true);
        try {
            const res: any = await submitRepaymentAction({
                loanId,
                installmentId,
                // The BORROWER's id, not the admin's. The action claims the
                // payment against the person who owes the money, and records
                // the row under them.
                userId: borrowerId,
                amount: value,
                paymentReference: reference.trim(),
            });

            if (res?.success) {
                // A duplicate reference also returns success — that is the point
                // of claiming it, and the message says so rather than implying a
                // second payment was credited.
                showToast("Repayment recorded", "success");
                onRecorded();
                onClose();
            } else {
                showToast(res?.error || "Could not record the repayment", "error");
            }
        } catch {
            showToast("Could not record the repayment", "error");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">Record Repayment</h2>
                        <p className="text-sm text-slate-500">{borrowerName}</p>
                    </div>
                    <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                ) : schedule.length === 0 ? (
                    <div className="px-6 py-10 text-center text-sm text-slate-600">
                        This loan has no repayment schedule yet. A schedule is created when the loan
                        is disbursed.
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
                        <div>
                            <label htmlFor="installment" className="mb-1 block text-sm font-semibold text-slate-700">
                                Instalment
                            </label>
                            <select
                                id="installment"
                                value={installmentId}
                                onChange={(e) => setInstallmentId(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            >
                                {schedule.map((i) => {
                                    const owed = amountOwedOn(i);
                                    return (
                                        <option key={i.id} value={i.id} disabled={i.status === "paid"}>
                                            #{i.installmentNumber} · due {formatLocalDate(i.dueDate)} ·{" "}
                                            {i.status === "paid" ? "paid" : `${formatCurrency(owed)} outstanding`}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>

                        <div>
                            <label htmlFor="amount" className="mb-1 block text-sm font-semibold text-slate-700">
                                Amount received
                            </label>
                            <input
                                id="amount"
                                type="number"
                                min="1"
                                max={outstanding || undefined}
                                step="any"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            />
                            {selected && (
                                <p className="mt-1 text-xs text-slate-500">
                                    {formatCurrency(outstanding)} outstanding on this instalment,
                                    including any penalty. A smaller amount is recorded as a partial
                                    payment; a larger one is refused, because nothing carries an
                                    overpayment to the next instalment.
                                </p>
                            )}
                        </div>

                        <div>
                            <label htmlFor="reference" className="mb-1 block text-sm font-semibold text-slate-700">
                                Bank reference
                            </label>
                            <input
                                id="reference"
                                type="text"
                                value={reference}
                                onChange={(e) => setReference(e.target.value)}
                                placeholder="e.g. FT26081012345678"
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            />
                            <div className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>
                                    Use the real reference from the transfer. It is what stops the
                                    same payment being credited twice — recording it again is
                                    harmless, but a made-up reference would let a genuine duplicate
                                    through.
                                </span>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
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
                                Record Repayment
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
