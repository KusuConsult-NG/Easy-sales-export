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
import { type LoanApplication, LoanPurpose } from "@/types/strict";

export default function LoanApprovalPage() {
    const [loans, setLoans] = useState<LoanApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedLoan, setSelectedLoan] = useState<LoanApplication | null>(null);
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        loadLoans();
    }, []);

    async function loadLoans() {
        setLoading(true);
        const result = await getPendingLoanApplications();
        if (result.success) {
            setLoans(result.loans);
        }
        setLoading(false);
    }

    async function handleApproval(loanId: string, approved: boolean, notes?: string, rejectionReason?: string) {
        setProcessing(true);
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
        }

        setProcessing(false);
    }

    const getPurposeColor = (purpose: LoanPurpose) => {
        const colors = {
            [LoanPurpose.AGRICULTURE]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
            [LoanPurpose.EQUIPMENT]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
            [LoanPurpose.LAND]: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
            [LoanPurpose.WORKING_CAPITAL]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
            [LoanPurpose.OTHER]: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200',
        };
        return colors[purpose];
    };

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
                        Loan Applications
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Review and approve pending loan applications
                    </p>
                </motion.div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900 rounded-full flex items-center justify-center">
                                <FileText className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white">{loans.length}</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Pending</p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                                <DollarSign className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white">
                                    ₦{loans.reduce((sum, loan) => sum + loan.amount, 0).toLocaleString()}
                                </p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Total Requested</p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white">
                                    ₦{loans.length > 0 ? Math.round(loans.reduce((sum, loan) => sum + loan.amount, 0) / loans.length).toLocaleString() : 0}
                                </p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Average Amount</p>
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

                {/* Loans List */}
                {!loading && loans.length === 0 && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center">
                        <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                            No Pending Applications
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            All loan applications have been reviewed
                        </p>
                    </div>
                )}

                {!loading && loans.length > 0 && (
                    <div className="grid grid-cols-1 gap-6">
                        {loans.map((loan, index) => (
                            <motion.div
                                key={loan.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow"
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
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            Application ID: <code className="font-mono">{loan.id.slice(0, 12)}...</code>
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Repayment Period</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">{loan.repaymentPeriod} months</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Business</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">{loan.businessDetails.name}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Years Operating</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">{loan.businessDetails.yearsInOperation} years</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Applied</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {new Date(loan.createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>

                                <details className="mb-4">
                                    <summary className="text-sm text-[#1358ec] cursor-pointer hover:underline">
                                        View Collateral & Business Details
                                    </summary>
                                    <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-xl space-y-3 text-sm">
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-white">Collateral</p>
                                            <p className="text-slate-600 dark:text-slate-400">
                                                Type: {loan.collateral.type} | Value: ₦{loan.collateral.value.toLocaleString()}
                                            </p>
                                            <p className="text-slate-600 dark:text-slate-400">{loan.collateral.description}</p>
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-white">Business Details</p>
                                            <p className="text-slate-600 dark:text-slate-400">
                                                Type: {loan.businessDetails.type} | Revenue: ₦{loan.businessDetails.annualRevenue.toLocaleString()}
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
