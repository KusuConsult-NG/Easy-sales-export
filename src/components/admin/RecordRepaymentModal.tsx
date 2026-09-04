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
 *
 *   #212 ONE TRANSFER COVERING TWO INSTALMENTS COULD NOT BE RECORDED.
 *
 *        #286's bound is right and it left this screen unable to express the
 *        ordinary case: a member transfers ₦120,000 that settles instalment 3
 *        and part of instalment 4. One instalment, one amount could not say
 *        that, and the bank reference can only be claimed once, so there was no
 *        second submission to make either.
 *
 *        The screen now records a TRANSFER and how it is ALLOCATED. The
 *        allocation is checked by checkRepaymentAllocations — the same call
 *        submitRepaymentAction makes, on the same schedule rows — and its
 *        verdict is both what is shown under the lines and what the submit
 *        button refuses on. One predicate, read twice, so the figure displayed
 *        and the figure enforced cannot drift; a second client-side spelling of
 *        "does this add up" is precisely the shape #286 was.
 */

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, AlertCircle, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { formatLocalDate } from "@/lib/date-utils";
import { amountOwedOn } from "@/lib/loan-repayment-amount";
import {
    checkRepaymentAllocations,
    MAX_ALLOCATIONS_PER_TRANSFER,
    type AllocatableInstallment,
} from "@/lib/repayment-allocation";
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

/** One line of the split, as the form holds it. Amounts are strings while typed. */
interface AllocationLine {
    key: number;
    installmentId: string;
    amount: string;
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
    const [transferAmount, setTransferAmount] = useState("");
    const [lines, setLines] = useState<AllocationLine[]>([{ key: 1, installmentId: "", amount: "" }]);
    const [nextKey, setNextKey] = useState(2);
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
                // starts at. The transfer defaults to that same figure, so the
                // one-instalment case — still the common one — opens balanced
                // and needs only the reference.
                const next = rows.find((i) => i.status !== "paid");
                if (next?.id) {
                    const owed = amountOwedOn(next);
                    setLines([{ key: 1, installmentId: next.id, amount: owed > 0 ? String(owed) : "" }]);
                    if (owed > 0) setTransferAmount(String(owed));
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

    const installmentsById = useMemo(() => {
        const map: Record<string, AllocatableInstallment | undefined> = {};
        for (const row of schedule) {
            if (row.id) map[row.id] = { ...row, id: row.id };
        }
        return map;
    }, [schedule]);

    const allocations = useMemo(
        () => lines.map((line) => ({ installmentId: line.installmentId, amount: Number(line.amount) })),
        [lines],
    );

    // THE verdict — not a copy of it. What the lines below display and what
    // handleSubmit refuses on are this one value, and it is produced by the same
    // function the server calls on the same rows.
    const verdict = checkRepaymentAllocations(allocations, installmentsById, transferAmount);

    const allocated = lines.reduce((sum, line) => {
        const value = Number(line.amount);
        return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    const transferValue = Number(transferAmount);
    const unallocated = Number.isFinite(transferValue) ? transferValue - allocated : 0;

    function setLine(key: number, patch: Partial<AllocationLine>) {
        setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    }

    function addLine() {
        // Defaults to the first instalment not already on a line, for the amount
        // that is still unallocated or what that instalment owes, whichever is
        // smaller — the allocation a reconciling admin was about to type.
        const taken = new Set(lines.map((line) => line.installmentId));
        const candidate = schedule.find((row) => row.id && row.status !== "paid" && !taken.has(row.id));
        const remaining = unallocated > 0 ? unallocated : 0;
        const owed = candidate ? amountOwedOn(candidate) : 0;
        const suggested = Math.min(remaining, owed);

        setLines((current) => [
            ...current,
            {
                key: nextKey,
                installmentId: candidate?.id ?? "",
                amount: suggested > 0 ? String(suggested) : "",
            },
        ]);
        setNextKey((key) => key + 1);
    }

    function removeLine(key: number) {
        setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        // #286 and #212. The same rule the action applies, so what the screen
        // refuses and what the server refuses cannot disagree. Refuses rather
        // than capping or auto-balancing: quietly changing what somebody typed
        // is its own surprise, and an admin reconciling a transfer needs to know
        // the figures do not match.
        if (!verdict.ok) return showToast(verdict.message, "error");

        if (!reference.trim()) return showToast("Enter the bank reference", "error");

        setSaving(true);
        try {
            const res: any = await submitRepaymentAction({
                loanId,
                // The BORROWER's id, not the admin's. The action claims the
                // payment against the person who owes the money, and records
                // the row under them.
                userId: borrowerId,
                // The TRANSFER, and how it is split. The server re-checks that
                // the split sums to it; sending an `installmentId` as well would
                // be a second spelling of what `allocations` already says.
                amount: verdict.total,
                allocations,
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
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
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
                            <label htmlFor="transferAmount" className="mb-1 block text-sm font-semibold text-slate-700">
                                Amount received
                            </label>
                            <input
                                id="transferAmount"
                                type="number"
                                min="1"
                                step="any"
                                value={transferAmount}
                                onChange={(e) => setTransferAmount(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            />
                            <p className="mt-1 text-xs text-slate-500">
                                The total of the bank transfer, exactly as it landed. Allocate all of
                                it below — one transfer can settle more than one instalment.
                            </p>
                        </div>

                        <div>
                            <p className="mb-1 block text-sm font-semibold text-slate-700">Allocation</p>
                            <div className="space-y-2">
                                {lines.map((line) => {
                                    const chosen = line.installmentId ? installmentsById[line.installmentId] : undefined;
                                    const owed = chosen ? amountOwedOn(chosen) : 0;
                                    return (
                                        <div key={line.key} className="flex items-start gap-2">
                                            <select
                                                aria-label="Instalment"
                                                value={line.installmentId}
                                                onChange={(e) => setLine(line.key, { installmentId: e.target.value })}
                                                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                            >
                                                <option value="">Choose an instalment</option>
                                                {schedule.map((i) => (
                                                    <option key={i.id} value={i.id} disabled={i.status === "paid"}>
                                                        #{i.installmentNumber} · due {formatLocalDate(i.dueDate)} ·{" "}
                                                        {i.status === "paid"
                                                            ? "paid"
                                                            : `${formatCurrency(amountOwedOn(i))} outstanding`}
                                                    </option>
                                                ))}
                                            </select>
                                            <input
                                                aria-label="Amount allocated"
                                                type="number"
                                                min="1"
                                                max={owed || undefined}
                                                step="any"
                                                value={line.amount}
                                                onChange={(e) => setLine(line.key, { amount: e.target.value })}
                                                className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeLine(line.key)}
                                                disabled={lines.length === 1}
                                                aria-label="Remove instalment"
                                                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            <button
                                type="button"
                                onClick={addLine}
                                disabled={lines.length >= MAX_ALLOCATIONS_PER_TRANSFER}
                                className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-green-700 hover:bg-green-50 disabled:opacity-40"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                Add another instalment
                            </button>

                            <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                <p>
                                    {formatCurrency(allocated)} allocated
                                    {Number.isFinite(transferValue) && transferValue > 0
                                        ? ` of ${formatCurrency(transferValue)}`
                                        : ""}
                                    {Math.abs(unallocated) >= 0.005
                                        ? unallocated > 0
                                            ? ` · ${formatCurrency(unallocated)} still to allocate`
                                            : ` · ${formatCurrency(-unallocated)} over`
                                        : ""}
                                </p>
                                {!verdict.ok && (
                                    <p className="mt-1 font-semibold text-amber-700">{verdict.message}</p>
                                )}
                            </div>

                            <p className="mt-2 text-xs text-slate-500">
                                Each line is bounded by what its instalment owes, including any
                                penalty. Every naira of the transfer has to be allocated before it
                                can be recorded — the bank reference is spent once, so a part-recorded
                                transfer could never be finished.
                            </p>
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
