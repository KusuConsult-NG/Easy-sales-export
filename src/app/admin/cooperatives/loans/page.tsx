"use client";

import { useEffect, useState, useRef } from "react";
import { logger } from '@/lib/logger';
import {
    DollarSign, CheckCircle, XCircle, Clock,
    Search, Eye, FileText, Download
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { formatCurrency } from "@/lib/utils";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot, Unsubscribe } from "firebase/firestore";

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
    approvedBy?: string;
    approvedAt?: Date;
};

type FilterType = "all" | "pending" | "approved" | "rejected";

export default function AdminLoansPage() {
    const { showToast } = useToast();
    const [applications, setApplications] = useState<LoanApplication[]>([]);
    const [filteredApplications, setFilteredApplications] = useState<LoanApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState<FilterType>("all");
    const [selectedApplication, setSelectedApplication] = useState<LoanApplication | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const unsubscribeRef = useRef<Unsubscribe | null>(null);

    // Real-time listener — replaces manual fetch
    useEffect(() => {
        if (unsubscribeRef.current) unsubscribeRef.current();

        setIsLoading(true);

        const q = query(collection(db, "loan_applications"), orderBy("appliedAt", "desc"));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const docs = snapshot.docs.map((doc) => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        appliedAt: data.appliedAt?.toDate() || new Date(),
                        approvedAt: data.approvedAt?.toDate(),
                    } as LoanApplication;
                });
                setApplications(docs);
                setIsLoading(false);
            },
            (err) => {
                logger.error("Loan applications snapshot error:", err);
                showToast("Failed to load loan applications", "error");
                setIsLoading(false);
            }
        );

        unsubscribeRef.current = unsubscribe;

        return () => { unsubscribeRef.current?.(); };
    }, [showToast]);

    // Filter locally (no re-fetch needed)
    useEffect(() => {
        let filtered = applications;
        if (filterStatus !== "all") {
            filtered = filtered.filter(app => app.status === filterStatus);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(app =>
                app.userName?.toLowerCase().includes(q) ||
                app.userEmail?.toLowerCase().includes(q) ||
                app.productName?.toLowerCase().includes(q) ||
                app.purpose?.toLowerCase().includes(q)
            );
        }
        setFilteredApplications(filtered);
    }, [applications, searchQuery, filterStatus]);

    const handleApprove = async (applicationId: string) => {
        if (!confirm("Approve this loan application?")) return;

        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/cooperative/approve-loan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ applicationId }),
            });
            const data = await response.json();
            if (data.success) {
                showToast("Loan application approved!", "success");
                setIsDetailsModalOpen(false);
                // onSnapshot auto-updates the list
            } else {
                showToast(data.data?.message || "Failed to approve loan", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
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
                showToast("Loan application rejected", "success");
                setIsDetailsModalOpen(false);
            } else {
                showToast(data.data?.message || "Failed to reject loan", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDisburse = async (applicationId: string) => {
        if (!confirm("Disburse funds for this loan? This cannot be undone.")) return;

        setIsProcessing(true);
        try {
            const { disburseLoanAction } = await import("@/app/actions/loans");
            const result = await disburseLoanAction(applicationId);
            if (result.success) {
                showToast("Loan funds disbursed!", "success");
                setIsDetailsModalOpen(false);
            } else {
                showToast(result.error || "Failed to disburse", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleExportCSV = () => {
        if (applications.length === 0) return;
        const headers = [
            "Name", "Email", "Loan Product", "Amount (₦)",
            "Interest Rate", "Duration (months)", "Monthly Payment (₦)",
            "Purpose", "Status", "Applied Date"
        ];
        const rows = applications.map(a => [
            a.userName || "", a.userEmail || "",
            a.productName || "", a.amount,
            `${a.interestRate}%`, a.durationMonths, a.monthlyPayment,
            a.purpose || "", a.status,
            new Date(a.appliedAt).toLocaleDateString("en-NG")
        ]);
        const csv = [
            headers.join(","),
            ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
        ].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `loan_applications_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    };

    const stats = {
        total: applications.length,
        pending: applications.filter(a => a.status === "pending").length,
        approved: applications.filter(a => ["approved", "disbursed", "active"].includes(a.status)).length,
        rejected: applications.filter(a => a.status === "rejected").length,
    };

    return (
        <div className="p-8">
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Loan Applications</h1>
                    <p className="text-slate-600">Review and manage cooperative loan applications</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-slate-500">Live</span>
                </div>
                <button
                    onClick={handleExportCSV}
                    disabled={applications.length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                >
                    <Download className="w-4 h-4" /> Export CSV ({applications.length})
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                {[
                    { label: "Total", value: stats.total, icon: FileText, color: "blue" },
                    { label: "Pending", value: stats.pending, icon: Clock, color: "yellow" },
                    { label: "Approved", value: stats.approved, icon: CheckCircle, color: "green" },
                    { label: "Rejected", value: stats.rejected, icon: XCircle, color: "red" },
                ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="bg-white rounded-xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-2">
                            <div className={`w-10 h-10 bg-${color}-100 rounded-lg flex items-center justify-center`}>
                                <Icon className={`w-5 h-5 text-${color}-600`} />
                            </div>
                            <p className="text-sm text-slate-600">{label}</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900">{value}</p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl p-6 shadow-lg mb-6">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search by name, email, product..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {(["all", "pending", "approved", "rejected"] as FilterType[]).map((status) => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${filterStatus === status ? "bg-primary text-white" : "bg-slate-100 text-slate-900 hover:bg-slate-200"}`}
                            >
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Applications Table */}
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600">Loading applications...</p>
                    </div>
                ) : filteredApplications.length === 0 ? (
                    <div className="p-12 text-center">
                        <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">No Loan Applications Found</h3>
                        <p className="text-slate-600">{searchQuery || filterStatus !== "all" ? "Try adjusting filters" : "No applications submitted yet"}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {["Applicant", "Loan Product", "Amount", "Duration", "Status", "Applied", "Actions"].map(h => (
                                        <th key={h} className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {filteredApplications.map((app) => (
                                    <tr key={app.id} className="hover:bg-slate-50">
                                        <td className="px-6 py-4">
                                            <p className="font-semibold text-slate-900">{app.userName || "Unknown"}</p>
                                            <p className="text-sm text-slate-500">{app.userEmail}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-medium text-slate-900">{app.productName}</p>
                                            <p className="text-sm text-slate-500">{app.interestRate}% APR</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-bold text-slate-900">{formatCurrency(app.amount)}</p>
                                            <p className="text-xs text-slate-500">{formatCurrency(app.monthlyPayment)}/mo</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-slate-900">{app.durationMonths} months</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${app.status === "pending" ? "bg-yellow-100 text-yellow-700"
                                                : ["approved", "disbursed", "active"].includes(app.status) ? "bg-green-100 text-green-700"
                                                    : app.status === "rejected" ? "bg-red-100 text-red-700"
                                                        : "bg-blue-100 text-blue-700"
                                                }`}>
                                                {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-600">
                                            {new Date(app.appliedAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => { setSelectedApplication(app); setIsDetailsModalOpen(true); }}
                                                className="text-primary hover:text-primary/80 font-medium flex items-center gap-1"
                                            >
                                                <Eye className="w-4 h-4" /> View
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
                    <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200">
                            <h2 className="text-2xl font-bold text-slate-900">Loan Application Details</h2>
                        </div>
                        <div className="p-6 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div><p className="text-sm text-slate-600">Name</p><p className="font-semibold">{selectedApplication.userName || "Unknown"}</p></div>
                                <div><p className="text-sm text-slate-600">Email</p><p className="font-semibold">{selectedApplication.userEmail}</p></div>
                                <div><p className="text-sm text-slate-600">Product</p><p className="font-semibold">{selectedApplication.productName}</p></div>
                                <div><p className="text-sm text-slate-600">Amount</p><p className="font-semibold">{formatCurrency(selectedApplication.amount)}</p></div>
                                <div><p className="text-sm text-slate-600">Interest Rate</p><p className="font-semibold">{selectedApplication.interestRate}% APR</p></div>
                                <div><p className="text-sm text-slate-600">Duration</p><p className="font-semibold">{selectedApplication.durationMonths} months</p></div>
                                <div><p className="text-sm text-slate-600">Monthly Payment</p><p className="font-semibold text-green-600">{formatCurrency(selectedApplication.monthlyPayment)}</p></div>
                                <div><p className="text-sm text-slate-600">Applied</p><p className="font-semibold">{new Date(selectedApplication.appliedAt).toLocaleDateString()}</p></div>
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 mb-2">Purpose</h3>
                                <p className="text-slate-600">{selectedApplication.purpose}</p>
                            </div>
                            <div>
                                <span className={`inline-flex px-3 py-1 rounded-full text-sm font-bold ${selectedApplication.status === "pending" ? "bg-yellow-100 text-yellow-700"
                                    : ["approved", "disbursed", "active"].includes(selectedApplication.status) ? "bg-green-100 text-green-700"
                                        : "bg-red-100 text-red-700"
                                    }`}>
                                    {selectedApplication.status.charAt(0).toUpperCase() + selectedApplication.status.slice(1)}
                                </span>
                                {selectedApplication.rejectionReason && (
                                    <div className="mt-2 p-3 bg-red-50 rounded-lg">
                                        <p className="text-sm font-semibold text-red-900">Reason: {selectedApplication.rejectionReason}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex gap-4">
                            {selectedApplication.status === "pending" && (
                                <>
                                    <button onClick={() => handleApprove(selectedApplication.id)} disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50">
                                        <CheckCircle className="w-5 h-5 inline mr-2" />Approve Loan
                                    </button>
                                    <button onClick={() => handleReject(selectedApplication.id)} disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50">
                                        <XCircle className="w-5 h-5 inline mr-2" />Reject
                                    </button>
                                </>
                            )}
                            {selectedApplication.status === "approved" && (
                                <button onClick={() => handleDisburse(selectedApplication.id)} disabled={isProcessing}
                                    className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all disabled:opacity-50">
                                    <DollarSign className="w-5 h-5 inline mr-2" />Disburse Funds
                                </button>
                            )}
                            <button onClick={() => setIsDetailsModalOpen(false)}
                                className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-900 font-bold rounded-xl transition-all">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
