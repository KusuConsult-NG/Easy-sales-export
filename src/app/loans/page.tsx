"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
    Plus,
    FileText,
    Clock,
    CheckCircle,
    XCircle,
    DollarSign,
    Loader2
} from "lucide-react";
import { getUserLoanApplications } from "@/app/actions/loan-actions";
import { type LoanApplication, LoanStatus } from "@/types/strict";

export default function MyLoansPage() {
    const [loans, setLoans] = useState<LoanApplication[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadLoans();
    }, []);

    async function loadLoans() {
        setLoading(true);
        const result = await getUserLoanApplications();
        if (result.success) {
            setLoans(result.loans);
        }
        setLoading(false);
    }

    const getStatusColor = (status: LoanStatus) => {
        const colors = {
            [LoanStatus.PENDING]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
            [LoanStatus.APPROVED]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
            [LoanStatus.REJECTED]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
            [LoanStatus.DISBURSED]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
            [LoanStatus.REPAID]: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
            [LoanStatus.DEFAULTED]: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200',
        };
        return colors[status];
    };

    const getStatusIcon = (status: LoanStatus) => {
        if (status === LoanStatus.PENDING) return <Clock className="w-4 h-4" />;
        if (status === LoanStatus.APPROVED || status === LoanStatus.DISBURSED || status === LoanStatus.REPAID)
            return <CheckCircle className="w-4 h-4" />;
        if (status === LoanStatus.REJECTED || status === LoanStatus.DEFAULTED)
            return <XCircle className="w-4 h-4" />;
        return null;
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-8">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8 flex items-center justify-between"
                >
                    <div>
                        <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                            My Loan Applications
                        </h1>
                        <p className="text-slate-600 dark:text-slate-400">
                            Track and manage your loan applications
                        </p>
                    </div>

                    <Link
                        href="/loans/apply"
                        className="px-6 py-3 bg-[#1358ec] text-white rounded-xl font-medium hover:bg-[#1046c7] transition-colors flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        Apply for Loan
                    </Link>
                </motion.div>

                {/* Loading State */}
                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-[#1358ec]" />
                    </div>
                )}

                {/* Empty State */}
                {!loading && loans.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center"
                    >
                        <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                            No Loan Applications Yet
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            Get started by applying for your first loan
                        </p>
                        <Link
                            href="/loans/apply"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-[#1358ec] text-white rounded-xl font-medium hover:bg-[#1046c7] transition-colors"
                        >
                            <Plus className="w-5 h-5" />
                            Apply for Loan
                        </Link>
                    </motion.div>
                )}

                {/* Loans List */}
                {!loading && loans.length > 0 && (
                    <div className="space-y-6">
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
                                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                                                ₦{loan.amount.toLocaleString()}
                                            </h3>
                                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(loan.status)}`}>
                                                {getStatusIcon(loan.status)}
                                                {loan.status.replace('_', ' ').toUpperCase()}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            {loan.purpose.replace('_', ' ')} • {loan.repaymentPeriod} months
                                        </p>
                                    </div>

                                    <div className="text-right">
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Applied</p>
                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                            {new Date(loan.createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-xl">
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Collateral</p>
                                        <p className="font-semibold text-slate-900 dark:text-white text-sm">{loan.collateral.type}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Value</p>
                                        <p className="font-semibold text-slate-900 dark:text-white text-sm">
                                            ₦{loan.collateral.value.toLocaleString()}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Business</p>
                                        <p className="font-semibold text-slate-900 dark:text-white text-sm">{loan.businessDetails.name}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Application ID</p>
                                        <p className="font-mono text-xs text-slate-900 dark:text-white">
                                            {loan.id.slice(0, 12)}...
                                        </p>
                                    </div>
                                </div>

                                {/* Rejection Reason */}
                                {loan.status === LoanStatus.REJECTED && loan.rejectionReason && (
                                    <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                                        <p className="text-sm font-semibold text-red-900 dark:text-red-200 mb-1">
                                            Rejection Reason:
                                        </p>
                                        <p className="text-sm text-red-700 dark:text-red-300">{loan.rejectionReason}</p>
                                    </div>
                                )}

                                {/* Approval Notes */}
                                {(loan.status === LoanStatus.APPROVED || loan.status === LoanStatus.DISBURSED) && (
                                    <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                                        <p className="text-sm font-semibold text-green-900 dark:text-green-200">
                                            ✓ Approved {loan.approvedAt && `on ${new Date(loan.approvedAt).toLocaleDateString()}`}
                                        </p>
                                        {loan.status === LoanStatus.DISBURSED && (
                                            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                                                Funds have been disbursed to your account
                                            </p>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
