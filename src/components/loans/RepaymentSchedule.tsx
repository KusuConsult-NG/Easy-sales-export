"use client";

import { useEffect, useState } from "react";
import { Calendar, DollarSign, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import { getRepaymentScheduleAction, type RepaymentInstallment } from "@/app/actions/cooperative";

interface RepaymentScheduleProps {
    loanId: string;
    loanAmount: number;
    monthlyPayment: number;
}

export default function RepaymentSchedule({ loanId, loanAmount, monthlyPayment }: RepaymentScheduleProps) {
    const [schedule, setSchedule] = useState<RepaymentInstallment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchSchedule = async () => {
            setLoading(true);
            setError(null);
            /**
             *   #409 NOT IMPORTED ANYWHERE — AND ONE LINE FROM SHIPPING TWO
             *   DEFECTS.
             *
             *   Nothing renders this component. The live repayment schedules are
             *   drawn by /cooperatives/my-loans and RecordRepaymentModal, both of
             *   which handle a failed read properly. This copy did not, and it
             *   carried a second fault the live ones do not:
             *
             *     progressPercent = (paidCount / schedule.length) * 100
             *
             *   which is 0/0 = NaN on an empty schedule, rendered as `NaN%` and
             *   as `style={{ width: "NaN%" }}`.
             *
             *   Both faults only appear together, and both appear the moment a
             *   failed read leaves the schedule empty — so an importer would get
             *   a borrower staring at "0 of 0 installments paid" and a broken
             *   progress bar, on their loan. Fixed rather than left: a component
             *   is one import away from live, which is #403's rule ("not reached
             *   is not unreachable") in its cheapest form.
             */
            try {
            const result = await getRepaymentScheduleAction(loanId);
            if (result.success && result.data?.schedule) {
                // Update status based on current date
                const updatedSchedule = result.data.schedule.map((inst: RepaymentInstallment) => {
                    const now = new Date();
                    const dueDate = new Date(inst.dueDate);

                    if (inst.status === "paid") return inst;

                    if (now > dueDate) {
                        return { ...inst, status: "overdue" as const };
                    }

                    return inst;
                });

                setSchedule(updatedSchedule);
            } else {
                setSchedule([]);
                setError(result.error || "Could not load the repayment schedule");
            }
            } catch {
                setSchedule([]);
                setError("Could not reach the server. This is not a statement that you owe nothing.");
            } finally {
                setLoading(false);
            }
        };

        fetchSchedule();
    }, [loanId]);

    if (loading) {
        return (
            <div className="bg-white rounded-xl p-6 shadow-lg">
                <div className="animate-pulse">
                    <div className="h-6 bg-slate-200 rounded w-1/3 mb-4"></div>
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-16 bg-slate-200 rounded"></div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    /**
     * #409. Rendered, not merely stored — an error state nothing displays is a
     * field written and never read (#100's class), and would leave this
     * component showing "0 of 0 installments paid" exactly as before.
     */
    if (error) {
        return (
            <div className="bg-white rounded-xl p-6 shadow-lg border border-red-200">
                <div className="flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-red-500 shrink-0" />
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 mb-1">
                            Repayment schedule unavailable
                        </h3>
                        <p className="text-sm text-slate-600">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    const paidCount = schedule.filter((inst) => inst.status === "paid").length;
    const overdueCount = schedule.filter((inst) => inst.status === "overdue").length;
    // #409. 0/0 is NaN, which React renders as "NaN%" and as
    // style={{ width: "NaN%" }}. Zero instalments means zero progress.
    const progressPercent = schedule.length > 0 ? (paidCount / schedule.length) * 100 : 0;

    return (
        <div className="bg-white rounded-xl p-6 shadow-lg border border-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-1">
                        Repayment Schedule
                    </h3>
                    <p className="text-sm text-slate-600">
                        {paidCount} of {schedule.length} installments paid
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-sm text-slate-500">Monthly Payment</p>
                    <p className="text-2xl font-bold text-blue-600">
                        ₦{monthlyPayment.toLocaleString()}
                    </p>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-900">
                        Payment Progress
                    </span>
                    <span className="text-sm font-bold text-blue-600">
                        {progressPercent.toFixed(0)}%
                    </span>
                </div>
                <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-linear-to-r from-green-500 to-blue-600 rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* Overdue Warning */}
            {overdueCount > 0 && (
                <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-200 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    <p className="text-sm text-red-700 font-medium">
                        {overdueCount} overdue payment{overdueCount > 1 ? "s" : ""} - penalties may apply after 7-day grace period
                    </p>
                </div>
            )}

            {/* Installments List */}
            <div className="space-y-3">
                {schedule.map((installment) => {
                    const StatusIcon = installment.status === "paid" ? CheckCircle2 :
                        installment.status === "overdue" ? AlertCircle : Clock;

                    const statusColors = {
                        paid: "bg-green-100 text-green-700 border-green-200",
                        overdue: "bg-red-100 text-red-700 border-red-200",
                        partial: "bg-yellow-100 text-yellow-700 border-yellow-200",
                        pending: "bg-slate-100 text-slate-900 border-slate-200",
                    };

                    return (
                        <div
                            key={installment.id}
                            className={`p-4 rounded-lg border transition-all ${statusColors[installment.status]}`}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <StatusIcon className="w-5 h-5" />
                                    <div>
                                        <p className="font-semibold">
                                            Installment #{installment.installmentNumber}
                                        </p>
                                        <p className="text-xs flex items-center gap-1 mt-1">
                                            <Calendar className="w-3 h-3" />
                                            Due: {new Date(installment.dueDate).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold">
                                        ₦{installment.totalAmount.toLocaleString()}
                                    </p>
                                    {installment.status === "paid" && (
                                        <p className="text-xs mt-1">Paid ✓</p>
                                    )}
                                    {installment.status === "partial" && (
                                        <p className="text-xs mt-1">
                                            Paid: ₦{installment.paidAmount.toLocaleString()}
                                        </p>
                                    )}
                                    {installment.penaltyAmount && installment.penaltyAmount > 0 && (
                                        <p className="text-xs mt-1 text-red-600">
                                            Penalty: ₦{installment.penaltyAmount.toLocaleString()}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Breakdown */}
                            <div className="mt-2 pt-2 border-t border-current/20 flex gap-4 text-xs">
                                <span>Principal: ₦{installment.principalAmount.toLocaleString()}</span>
                                <span>Interest: ₦{installment.interestAmount.toLocaleString()}</span>
                                {installment.daysOverdue && installment.daysOverdue > 0 && (
                                    <span className="font-bold">Overdue: {installment.daysOverdue} days</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Summary */}
            <div className="mt-6 pt-4 border-t border-slate-200 grid grid-cols-3 gap-4">
                <div>
                    <p className="text-xs text-slate-500 mb-1">Total Loan</p>
                    <p className="font-bold text-slate-900">
                        ₦{loanAmount.toLocaleString()}
                    </p>
                </div>
                <div>
                    <p className="text-xs text-slate-500 mb-1">Paid</p>
                    <p className="font-bold text-green-600">
                        {paidCount}/{schedule.length}
                    </p>
                </div>
                <div>
                    <p className="text-xs text-slate-500 mb-1">Remaining</p>
                    <p className="font-bold text-blue-600">
                        {schedule.length - paidCount}
                    </p>
                </div>
            </div>
        </div>
    );
}
