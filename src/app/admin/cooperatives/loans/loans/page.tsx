"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { Briefcase, CheckCircle, XCircle, Loader2, AlertCircle, Search, Filter, DollarSign, Calendar, Eye, FileText } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { getPendingLoanApplications, approveLoanApplication, rejectLoanApplication } from "@/app/actions/admin";
import type { LoanApplication } from "@/app/actions/loans";

export default function AdminLoansPage() {
    const { showToast } = useToast();
    const [loans, setLoans] = useState<LoanApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedLoan, setSelectedLoan] = useState<LoanApplication | null>(null);
    const [actionLoading, setActionLoading] = useState(false); // Renamed to isProcessing in the diff, but keeping original for now
    const [rejectionReason, setRejectionReason] = useState("");
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false); // New state from diff
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false); // New state from diff

    async function loadPendingLoans() {
        setLoading(true);
        const result = await getPendingLoanApplications();
        if (result.success && result.applications) {
            setLoans(result.applications);
            // Auto-select first loan if available
            if (result.applications.length > 0 && !selectedLoan) {
                setSelectedLoan(result.applications[0]);
            }
        } else {
            // If API fails/returns empty, ensure we have an empty array to avoid crashes
            setLoans([]);
        }
        setLoading(false);
    }

    useEffect(() => {
        let mounted = true;

        async function loadLoansOnMount() {
            setLoading(true);
            try {
                const result = await getPendingLoanApplications();
                if (mounted) {
                    if (result.success && result.applications) {
                        setLoans(result.applications);
                        // Auto-select first loan if available
                        if (result.applications.length > 0 && !selectedLoan) {
                            setSelectedLoan(result.applications[0]);
                        }
                    } else {
                        setLoans([]);
                    }
                }
            } catch (error) {
                logger.error("Failed to load pending loans:", error);
                if (mounted) {
                    setLoans([]);
                }
            } finally {
                if (mounted) setLoading(false);
            }
        }

        loadLoansOnMount();
        return () => { mounted = false; };
    }, []);

    const handleApproveLoan = async () => {
        if (!selectedLoan) return;

        // Validate tier eligibility (kept from original handleApprove)
        const tierMultiplier = selectedLoan.tier === "Premium" ? 5 : 2.5;
        const maxLoanAmount = selectedLoan.contributionAmount * tierMultiplier;

        if (selectedLoan.amount > maxLoanAmount) {
            showToast(
                `Loan amount (₦${selectedLoan.amount.toLocaleString()}) exceeds maximum for ${selectedLoan.tier} tier (₦${maxLoanAmount.toLocaleString()})`,
                "error"
            );
            return;
        }

        setIsProcessing(true);
        const result = await approveLoanApplication(selectedLoan.id || ""); // Using original action name

        if (result.success) {
            showToast("Loan approved successfully! Applicant has been notified.", "success");
            setLoans(loans.map(l => l.id === selectedLoan.id ? { ...l, status: "approved" } : l));
            setIsDetailsModalOpen(false);
            setSelectedLoan(null); // Clear selected loan after action
        } else {
            showToast(result.error || "Failed to approve loan", "error");
        }
        setIsProcessing(false);
    };

    const handleRejectLoan = async () => {
        if (!selectedLoan) return;

        if (!rejectionReason.trim()) {
            showToast("Please provide a reason for rejection", "error");
            return;
        }

        setIsProcessing(true);
        const result = await rejectLoanApplication(selectedLoan.id || "", rejectionReason); // Using original action name

        if (result.success) {
            showToast("Loan rejected. Applicant has been notified.", "success");
            setLoans(loans.map(l => l.id === selectedLoan.id ? { ...l, status: "rejected" } : l));
            setIsDetailsModalOpen(false);
            setRejectionReason("");
            setShowRejectModal(false);
            setSelectedLoan(null); // Clear selected loan after action
        } else {
            showToast(result.error || "Failed to reject loan", "error");
        }
        setIsProcessing(false);
    };

    const getStatusColor = (status: string) => {
        const colors = {
            pending: "bg-amber-100 text-amber-800",
            approved: "bg-emerald-100 text-emerald-800",
            rejected: "bg-red-100 text-red-800",
            disbursed: "bg-blue-100 text-blue-800",
        };
        return colors[status as keyof typeof colors] || colors.pending;
    };

    const calculateEligibility = (contribution: number, tier: string, loanAmount: number) => {
        const multiplier = tier === "Premium" ? 5 : 2.5;
        const maxLoan = contribution * multiplier;
        const isEligible = loanAmount <= maxLoan;
        return { maxLoan, isEligible };
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 mb-2">
                        Loan Applications
                    </h1>
                    <p className="text-slate-600">
                        Review and approve pending loan requests
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white rounded-lg p-6 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Pending</p>
                                <p className="text-2xl font-bold text-slate-900 mt-1">
                                    {loans.filter((l) => l.status === "pending").length}
                                </p>
                            </div>
                            <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
                                <AlertCircle className="w-6 h-6 text-amber-600" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg p-6 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Total Value</p>
                                <p className="text-2xl font-bold text-slate-900 mt-1">
                                    ₦{loans.reduce((sum, l) => sum + l.amount, 0).toLocaleString()}
                                </p>
                            </div>
                            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                                <span className="text-xl font-bold text-blue-600">₦</span>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg p-6 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-600">Avg Amount</p>
                                <p className="text-2xl font-bold text-slate-900 mt-1">
                                    ₦
                                    {loans.length > 0
                                        ? Math.round(
                                            loans.reduce((sum, l) => sum + l.amount, 0) / loans.length
                                        ).toLocaleString()
                                        : 0}
                                </p>
                            </div>
                            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                                <CheckCircle className="w-6 h-6 text-green-600" />
                            </div>
                        </div>
                    </div>
                </div>

                {loans.length === 0 ? (
                    <div className="bg-white rounded-lg p-12 text-center">
                        <AlertCircle className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 mb-2">
                            No Pending Loans
                        </h3>
                        <p className="text-slate-600">
                            All loan applications have been reviewed
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Loan List */}
                        <div className="lg:col-span-2 space-y-4">
                            {loans.map((loan) => {
                                const { maxLoan, isEligible } = calculateEligibility(
                                    loan.contributionAmount,
                                    loan.tier,
                                    loan.amount
                                );

                                return (
                                    <div
                                        key={loan.id}
                                        onClick={() => setSelectedLoan(loan)}
                                        className={`bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition cursor-pointer ${selectedLoan?.id === loan.id ? "ring-2 ring-blue-500" : ""
                                            }`}
                                    >
                                        <div className="flex items-start justify-between mb-4">
                                            <div>
                                                <h3 className="font-semibold text-lg text-slate-900">
                                                    {loan.fullName}
                                                </h3>
                                                <p className="text-sm text-slate-500">{loan.userEmail}</p>
                                            </div>
                                            <div className="flex flex-col items-end space-y-2">
                                                <span
                                                    className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(
                                                        loan.status
                                                    )}`}
                                                >
                                                    {loan.status}
                                                </span>
                                                {!isEligible && (
                                                    <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">
                                                        Exceeds Limit
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-4 mb-4">
                                            <div>
                                                <p className="text-xs text-slate-500 mb-1">Amount</p>
                                                <p className="font-bold text-slate-900">
                                                    ₦{loan.amount.toLocaleString()}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-slate-500 mb-1">Duration</p>
                                                <p className="font-bold text-slate-900">
                                                    {loan.durationMonths} months
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-slate-500 mb-1">Tier</p>
                                                <p className="font-bold text-slate-900">
                                                    {loan.tier}
                                                </p>
                                            </div>
                                        </div>

                                        <p className="text-sm text-slate-600 line-clamp-2">
                                            {loan.purpose}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Loan Details */}
                        {selectedLoan && (
                            <div className="bg-white rounded-xl p-6 shadow-lg h-fit sticky top-8">
                                <h3 className="text-xl font-bold text-slate-900 mb-6">
                                    Loan Details
                                </h3>

                                <div className="space-y-4 mb-6">
                                    <div>
                                        <p className="text-sm text-slate-500 mb-1">Loan Amount</p>
                                        <p className="text-2xl font-bold text-slate-900">
                                            ₦{selectedLoan.amount.toLocaleString()}
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm text-slate-500 mb-1">Duration</p>
                                            <p className="font-semibold text-slate-900">
                                                {selectedLoan.durationMonths} months
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-slate-500 mb-1">Interest Rate</p>
                                            <p className="font-semibold text-slate-900">
                                                {selectedLoan.interestRate}%/month
                                            </p>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-sm text-slate-500 mb-1">Monthly Repayment</p>
                                        <p className="text-lg font-bold text-blue-600">
                                            ₦{Math.round(selectedLoan.monthlyPayment).toLocaleString()}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-sm text-slate-500 mb-1">Total Repayment</p>
                                        <p className="font-semibold text-slate-900">
                                            ₦{Math.round(selectedLoan.totalRepayment).toLocaleString()}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-sm text-slate-500 mb-1">Purpose</p>
                                        <p className="text-slate-900">
                                            {selectedLoan.purpose}
                                        </p>
                                    </div>

                                    <div>
                                        <p className="text-sm text-slate-500 mb-1">Contribution & Tier</p>
                                        <p className="font-semibold text-slate-900">
                                            ₦{selectedLoan.contributionAmount.toLocaleString()} ({selectedLoan.tier})
                                        </p>
                                    </div>

                                    {/* Eligibility Check */}
                                    {(() => {
                                        const { maxLoan, isEligible } = calculateEligibility(
                                            selectedLoan.contributionAmount,
                                            selectedLoan.tier,
                                            selectedLoan.amount
                                        );
                                        return (
                                            <div
                                                className={`p-3 rounded-lg ${isEligible
                                                    ? "bg-green-50"
                                                    : "bg-red-50"
                                                    }`}
                                            >
                                                <p className="text-sm font-medium mb-1">Eligibility Check</p>
                                                <p
                                                    className={`text-xs ${isEligible
                                                        ? "text-green-700"
                                                        : "text-red-700"
                                                        }`}
                                                >
                                                    {isEligible ? "✓ " : "✗ "}
                                                    Max allowed: ₦{maxLoan.toLocaleString()} (
                                                    {selectedLoan.tier === "Premium" ? "5x" : "2.5x"} contribution)
                                                </p>
                                                {!isEligible && (
                                                    <p className="text-xs text-red-600 mt-1">
                                                        Exceeds {selectedLoan.tier} tier limit by ₦
                                                        {(selectedLoan.amount - maxLoan).toLocaleString()}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {selectedLoan.status === "pending" && (
                                    <div className="space-y-3">
                                        <button
                                            onClick={handleApproveLoan}
                                            disabled={actionLoading}
                                            className="w-full flex items-center justify-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {actionLoading ? (
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                            ) : (
                                                <CheckCircle className="w-5 h-5" />
                                            )}
                                            <span>Approve Loan</span>
                                        </button>
                                        <button
                                            onClick={() => setShowRejectModal(true)}
                                            disabled={actionLoading}
                                            className="w-full flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <XCircle className="w-5 h-5" />
                                            <span>Reject Loan</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Reject Modal */}
            {showRejectModal && selectedLoan && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
                        <div className="p-6 border-b border-slate-200">
                            <h2 className="text-xl font-bold text-slate-900">
                                Reject Loan Application
                            </h2>
                            <p className="text-sm text-slate-600 mt-1">
                                For {selectedLoan.fullName}
                            </p>
                        </div>

                        <div className="p-6">
                            <label className="block text-sm font-medium text-slate-900 mb-2">
                                Rejection Reason *
                            </label>
                            <textarea
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                placeholder="Provide a detailed reason for rejection..."
                                className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                rows={4}
                            />
                        </div>

                        <div className="p-6 border-t border-slate-200 flex items-center justify-end space-x-3">
                            <button
                                onClick={() => {
                                    setShowRejectModal(false);
                                    setRejectionReason("");
                                }}
                                disabled={actionLoading}
                                className="px-4 py-2 text-slate-900 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRejectLoan}
                                disabled={actionLoading}
                                className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {actionLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <XCircle className="w-4 h-4" />
                                )}
                                <span>Confirm Rejection</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
