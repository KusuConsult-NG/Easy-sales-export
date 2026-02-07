"use client";

import { useEffect, useState } from "react";
import {
    DollarSign, Users, CheckCircle, XCircle, Clock,
    Search, Filter, Eye, FileText, TrendingUp, Calendar
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type LoanApplication = {
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    productId: string;
    productName: string;
    amount: number;
    purpose: string;
    interestRate: number;
    durationMonths: number;
    monthlyPayment: number;
    status: "pending" | "approved" | "rejected" | "disbursed" | "active" | "completed";
    appliedAt: Date;
    rejectionReason?: string;
};

type FilterType = "all" | "pending" | "approved" | "rejected";

export default function AdminLoansPage() {
    const [applications, setApplications] = useState<LoanApplication[]>([]);
    const [filteredApplications, setFilteredApplications] = useState<LoanApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState<FilterType>("all");
    const [selectedApplication, setSelectedApplication] = useState<LoanApplication | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        fetchApplications();
    }, []);

    useEffect(() => {
        filterApplications();
    }, [applications, searchQuery, filterStatus]);

    const fetchApplications = async () => {
        setIsLoading(true);
        try {
            const response = await fetch("/api/admin/cooperative/loan-applications");
            const data = await response.json();

            if (data.success) {
                setApplications(data.applications || []);
            }
        } catch (error) {
            console.error("Failed to fetch loan applications:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const filterApplications = () => {
        let filtered = applications;

        // Filter by status
        if (filterStatus !== "all") {
            filtered = filtered.filter(app => app.status === filterStatus);
        }

        // Filter by search query
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(app =>
                app.userName?.toLowerCase().includes(query) ||
                app.userEmail?.toLowerCase().includes(query) ||
                app.productName?.toLowerCase().includes(query) ||
                app.purpose?.toLowerCase().includes(query)
            );
        }

        setFilteredApplications(filtered);
    };

    const handleApprove = async (applicationId: string) => {
        if (!confirm("Are you sure you want to approve this loan application?")) {
            return;
        }

        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/cooperative/approve-loan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ applicationId }),
            });

            const data = await response.json();

            if (data.success) {
                alert("Loan application approved successfully!");
                fetchApplications();
                setIsDetailsModalOpen(false);
            } else {
                alert(data.message || "Failed to approve loan");
            }
        } catch (error) {
            alert("An error occurred while approving the loan");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async (applicationId: string) => {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;

        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/cooperative/reject-loan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ applicationId, reason }),
            });

            const data = await response.json();

            if (data.success) {
                alert("Loan application rejected");
                fetchApplications();
                setIsDetailsModalOpen(false);
            } else {
                alert(data.message || "Failed to reject loan");
            }
        } catch (error) {
            alert("An error occurred while rejecting the loan");
        } finally {
            setIsProcessing(false);
        }
    };

    const stats = {
        total: applications.length,
        pending: applications.filter(a => a.status === "pending").length,
        approved: applications.filter(a => a.status === "approved" || a.status === "disbursed" || a.status === "active").length,
        rejected: applications.filter(a => a.status === "rejected").length,
    };

    return (
        <div className="p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Loan Applications
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Review and manage cooperative loan applications
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Total Applications</p>
                    </div>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
                            <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Pending Review</p>
                    </div>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">{stats.pending}</p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Approved</p>
                    </div>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">{stats.approved}</p>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Rejected</p>
                    </div>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">{stats.rejected}</p>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg mb-6">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search by name, email, product, or purpose..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {(["all", "pending", "approved", "rejected"] as FilterType[]).map((status) => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${filterStatus === status
                                        ? "bg-primary text-white"
                                        : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                                    }`}
                            >
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Applications Table */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600 dark:text-slate-400">Loading applications...</p>
                    </div>
                ) : filteredApplications.length === 0 ? (
                    <div className="p-12 text-center">
                        <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                            No Loan Applications Found
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            {searchQuery || filterStatus !== "all"
                                ? "Try adjusting your filters"
                                : "No loan applications have been submitted yet"}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Applicant
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Loan Product
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Amount
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Duration
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Applied
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                {filteredApplications.map((app) => (
                                    <tr key={app.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-white">
                                                    {app.userName || "Unknown"}
                                                </p>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                                    {app.userEmail}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-medium text-slate-900 dark:text-white">
                                                {app.productName}
                                            </p>
                                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                                {app.interestRate}% APR
                                            </p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-bold text-slate-900 dark:text-white">
                                                {formatCurrency(app.amount)}
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                {formatCurrency(app.monthlyPayment)}/month
                                            </p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-slate-900 dark:text-white">
                                                {app.durationMonths} months
                                            </p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${app.status === "pending"
                                                    ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                                    : app.status === "approved" || app.status === "disbursed" || app.status === "active"
                                                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                        : app.status === "rejected"
                                                            ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                                            : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                                                }`}>
                                                {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                                            {new Date(app.appliedAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => {
                                                    setSelectedApplication(app);
                                                    setIsDetailsModalOpen(true);
                                                }}
                                                className="text-primary hover:text-primary/80 font-medium"
                                            >
                                                View Details
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Details Modal */}
            {isDetailsModalOpen && selectedApplication && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Loan Application Details
                            </h2>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Applicant Info */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">
                                    Applicant Information
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Name</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedApplication.userName || "Unknown"}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Email</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedApplication.userEmail}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Loan Details */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">
                                    Loan Details
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Product</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedApplication.productName}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Amount</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {formatCurrency(selectedApplication.amount)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Interest Rate</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedApplication.interestRate}% APR
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Duration</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedApplication.durationMonths} months
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Monthly Payment</p>
                                        <p className="font-semibold text-green-600 dark:text-green-400">
                                            {formatCurrency(selectedApplication.monthlyPayment)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Application Date</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {new Date(selectedApplication.appliedAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Purpose */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                    Purpose
                                </h3>
                                <p className="text-slate-600 dark:text-slate-400">
                                    {selectedApplication.purpose}
                                </p>
                            </div>

                            {/* Status & Rejection Reason */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                    Status
                                </h3>
                                <span className={`inline-flex px-3 py-1 rounded-full text-sm font-bold ${selectedApplication.status === "pending"
                                        ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                        : selectedApplication.status === "approved" || selectedApplication.status === "disbursed" || selectedApplication.status === "active"
                                            ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                            : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                    }`}>
                                    {selectedApplication.status.charAt(0).toUpperCase() + selectedApplication.status.slice(1)}
                                </span>
                                {selectedApplication.rejectionReason && (
                                    <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                                        <p className="text-sm font-semibold text-red-900 dark:text-red-100 mb-1">
                                            Rejection Reason:
                                        </p>
                                        <p className="text-sm text-red-700 dark:text-red-300">
                                            {selectedApplication.rejectionReason}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex gap-4">
                            {selectedApplication.status === "pending" && (
                                <>
                                    <button
                                        onClick={() => handleApprove(selectedApplication.id)}
                                        disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50"
                                    >
                                        <CheckCircle className="w-5 h-5 inline mr-2" />
                                        Approve Loan
                                    </button>
                                    <button
                                        onClick={() => handleReject(selectedApplication.id)}
                                        disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50"
                                    >
                                        <XCircle className="w-5 h-5 inline mr-2" />
                                        Reject
                                    </button>
                                </>
                            )}
                            <button
                                onClick={() => setIsDetailsModalOpen(false)}
                                className="px-6 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-bold rounded-xl transition-all"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
