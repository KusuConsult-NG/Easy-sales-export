"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
    CheckCircle,
    XCircle,
    DollarSign,
    FileText,
    Building2,
    Calendar,
    TrendingUp,
    Loader2
} from "lucide-react";
import { getPendingLoanApplications, approveLoanApplication } from "@/app/actions/loan-actions";
import { useToast } from "@/contexts/ToastContext";
import { type LoanApplication, LoanPurpose } from "@/types/strict";

export default function LoanApprovalPage() {
    /**
     * #407. The `error` state below belongs to the LOAD path and renders in
     * place of the queue, so it cannot carry a decision failure — using it
     * would blank the list an approver is working through. A toast says what
     * happened without taking the queue away.
     */
    const { showToast } = useToast();
    const [loans, setLoans] = useState<LoanApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedLoan, setSelectedLoan] = useState<LoanApplication | null>(null);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     *   #384 A REFUSAL RENDERED AS AN EMPTY QUEUE.
     *
     *        This kept `if (result.success && result.data)` and nothing else, so
     *        a caller without `cooperatives:approve_loans` — or any read that
     *        failed — fell through to the empty-state card below:
     *
     *            "No Pending Applications — All loan applications have been
     *             reviewed"
     *
     *        On a queue of business loan applications that is the worst possible
     *        wrong answer: it tells an approver the work is done. #307's shape,
     *        and #296's lesson that a refusal read as a clean bill of health is
     *        worse than a refusal.
     *
     *        The list is also cleared on failure rather than left showing the
     *        previous page's rows beside an error, which would be two
     *        contradictory statements on one screen.
     */
    async function loadLoans() {
        setLoading(true);
        setError(null);
        /**
         * #408. #384 taught this loader to distinguish a refusal from an empty
         * queue, which is why the else-branch below exists. It did not give it a
         * try: a REJECTED promise — a dropped connection, a 500 — skipped both
         * branches, so `loading` stayed true and the screen span forever with no
         * error and no queue.
         *
         * A stopped spinner is not a better answer than a wrong one, it is the
         * same answer with no way to act on it. The catch reuses the error state
         * #384 built, so a network failure and a refusal now look alike to the
         * approver: a message, and the reason.
         */
        try {
            const result = await getPendingLoanApplications();
            if (result.success && result.data) {
                setLoans(result.data);
            } else {
                setLoans([]);
                setError(result.error || "Could not load loan applications");
            }
        } catch {
            setLoans([]);
            setError("Could not reach the server. The queue below is not the full list — reload before deciding.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadLoans();
     
    }, []);

    async function handleApproval(loanId: string, approved: boolean, notes?: string, rejectionReason?: string) {
        setProcessing(true);
        // #407. There was no try, and setProcessing(false) sat after the await —
        // so a rejected promise left the approve/reject controls disabled on the
        // loan decision screen, with nothing said. A refusal was also silent:
        // result.success === false did nothing at all.
        try {
            const result = await approveLoanApplication({
                loanId,
                approved,
                notes,
                rejectionReason,
            });

            if (result.success) {
                // Refresh list
                await loadLoans();
                setSelectedLoan(null);
            } else {
                showToast(result.error || "The decision was not recorded", "error");
            }
        } catch {
            showToast("Could not confirm the decision. Reload before deciding again.", "error");
        } finally {
            setProcessing(false);
        }
    }

    const getPurposeColor = (purpose: LoanPurpose) => {
        const colors: Record<string, string> = {
            [LoanPurpose.AGRICULTURE]: 'bg-green-100 text-green-800',
            [LoanPurpose.EQUIPMENT]: 'bg-blue-100 text-blue-800',
            [LoanPurpose.LAND]: 'bg-purple-100 text-purple-800',
            [LoanPurpose.WORKING_CAPITAL]: 'bg-orange-100 text-orange-800',
            [LoanPurpose.OTHER]: 'bg-slate-100 text-slate-800',
            [LoanPurpose.SEEDS]: 'bg-emerald-100 text-emerald-800',
            [LoanPurpose.FERTILIZER]: 'bg-lime-100 text-lime-800',
            [LoanPurpose.IRRIGATION]: 'bg-cyan-100 text-cyan-800',
            [LoanPurpose.LABOR]: 'bg-gray-100 text-gray-800',
            [LoanPurpose.PROCESSING]: 'bg-indigo-100 text-indigo-800',
            [LoanPurpose.MARKETING]: 'bg-pink-100 text-pink-800',
            [LoanPurpose.EXPANSION]: 'bg-violet-100 text-violet-800',
        };
        return colors[purpose] || 'bg-slate-100 text-slate-800';
    };

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
                        Loan Applications
                    </h1>
                    <p className="text-slate-600">
                        Review and approve pending loan applications
                    </p>
                </motion.div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="bg-white rounded-xl p-6 shadow-lg"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                                <FileText className="w-6 h-6 text-yellow-600" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-slate-900">{loans.length}</p>
                                <p className="text-sm text-slate-600">Pending</p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-white rounded-xl p-6 shadow-lg"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                                <DollarSign className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-slate-900">
                                    ₦{loans.reduce((sum, loan) => sum + loan.amount, 0).toLocaleString()}
                                </p>
                                <p className="text-sm text-slate-600">Total Requested</p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="bg-white rounded-xl p-6 shadow-lg"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-green-600" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-slate-900">
                                    ₦{loans.length > 0 ? Math.round(loans.reduce((sum, loan) => sum + loan.amount, 0) / loans.length).toLocaleString() : 0}
                                </p>
                                <p className="text-sm text-slate-600">Average Amount</p>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Loading State */}
                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-[#1358ec]" />
                    </div>
                )}

                {/* A failed or refused read says so, rather than showing "all reviewed". */}
                {!loading && error && (
                    <div className="bg-white rounded-2xl p-12 text-center border border-red-200">
                        <XCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">
                            Could not load the queue
                        </h3>
                        <p className="text-slate-600">{error}</p>
                    </div>
                )}

                {/* Loans List */}
                {!loading && !error && loans.length === 0 && (
                    <div className="bg-white rounded-2xl p-12 text-center">
                        <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">
                            No Pending Applications
                        </h3>
                        <p className="text-slate-600">
                            All loan applications have been reviewed
                        </p>
                    </div>
                )}

                {!loading && !error && loans.length > 0 && (
                    <div className="grid grid-cols-1 gap-6">
                        {loans.map((loan, index) => (
                            <motion.div
                                key={loan.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <h3 className="text-2xl font-bold text-[#1358ec]">
                                                ₦{loan.amount.toLocaleString()}
                                            </h3>
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${getPurposeColor(loan.purpose)}`}>
                                                {loan.purpose.replace('_', ' ')}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-600">
                                            Application ID: <code className="font-mono">{loan.id.slice(0, 12)}...</code>
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Repayment Period</p>
                                        <p className="font-semibold text-slate-900">{loan.repaymentPeriod} months</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Business</p>
                                        <p className="font-semibold text-slate-900">{loan.businessDetails?.name || 'N/A'}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Years Operating</p>
                                        <p className="font-semibold text-slate-900">{loan.businessDetails?.yearsInOperation || 0} years</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1">Applied</p>
                                        <p className="font-semibold text-slate-900">
                                            {new Date(loan.createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>

                                <details className="mb-4">
                                    <summary className="text-sm text-[#1358ec] cursor-pointer hover:underline">
                                        View Collateral & Business Details
                                    </summary>
                                    <div className="mt-4 p-4 bg-slate-50 rounded-xl space-y-3 text-sm">
                                        <div>
                                            <p className="font-semibold text-slate-900">Collateral</p>
                                            <p className="text-slate-600">
                                                Type: {loan.collateral?.type || 'N/A'} | Value: ₦{loan.collateral?.value?.toLocaleString() || '0'}
                                            </p>
                                            <p className="text-slate-600">{loan.collateral?.description || 'No description'}</p>
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900">Business Details</p>
                                            <p className="text-slate-600">
                                                Type: {loan.businessDetails?.type || 'N/A'} | Revenue: ₦{loan.businessDetails?.annualRevenue?.toLocaleString() || '0'}
                                            </p>
                                        </div>
                                    </div>
                                </details>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => handleApproval(loan.id, true, "Approved by admin")}
                                        disabled={processing}
                                        className="flex-1 px-6 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <CheckCircle className="w-5 h-5" />
                                        {processing ? 'Processing...' : 'Approve'}
                                    </button>

                                    <button
                                        onClick={() => handleApproval(loan.id, false, undefined, "Insufficient collateral")}
                                        disabled={processing}
                                        className="flex-1 px-6 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <XCircle className="w-5 h-5" />
                                        {processing ? 'Processing...' : 'Reject'}
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
