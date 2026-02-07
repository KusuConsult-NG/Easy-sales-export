"use client";

import { useEffect, useState } from "react";
import {
    Store, CheckCircle, XCircle, Clock, Search,
    Filter, Eye, FileText, MapPin, CreditCard, Ban
} from "lucide-react";

type SellerVerification = {
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    businessName: string;
    businessType: string;
    businessDescription: string;
    phone: string;
    email: string;
    address: string;
    state: string;
    lga: string;
    documents: {
        businessDoc: string;
        idDoc: string;
        addressProof: string;
    };
    bankDetails: {
        bankName: string;
        accountNumber: string;
        accountName: string;
    };
    status: "pending" | "approved" | "rejected" | "suspended";
    rejectionReason?: string;
    createdAt: Date;
};

type FilterType = "all" | "pending" | "approved" | "rejected";

export default function AdminSellersPage() {
    const [verifications, setVerifications] = useState<SellerVerification[]>([]);
    const [filteredVerifications, setFilteredVerifications] = useState<SellerVerification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState<FilterType>("all");
    const [selectedVerification, setSelectedVerification] = useState<SellerVerification | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        fetchVerifications();
    }, []);

    useEffect(() => {
        filterVerifications();
    }, [verifications, searchQuery, filterStatus]);

    const fetchVerifications = async () => {
        setIsLoading(true);
        try {
            const response = await fetch("/api/admin/marketplace/seller-verifications");
            const data = await response.json();

            if (data.success) {
                setVerifications(data.verifications || []);
            }
        } catch (error) {
            console.error("Failed to fetch verifications:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const filterVerifications = () => {
        let filtered = verifications;

        if (filterStatus !== "all") {
            filtered = filtered.filter(v => v.status === filterStatus);
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(v =>
                v.businessName?.toLowerCase().includes(query) ||
                v.userName?.toLowerCase().includes(query) ||
                v.userEmail?.toLowerCase().includes(query) ||
                v.phone?.toLowerCase().includes(query)
            );
        }

        setFilteredVerifications(filtered);
    };

    const handleApprove = async (verificationId: string) => {
        if (!confirm("Are you sure you want to approve this seller?")) {
            return;
        }

        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/marketplace/approve-seller", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationId }),
            });

            const data = await response.json();

            if (data.success) {
                alert("Seller approved successfully!");
                fetchVerifications();
                setIsDetailsModalOpen(false);
            } else {
                alert(data.message || "Failed to approve seller");
            }
        } catch (error) {
            alert("An error occurred while approving the seller");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async (verificationId: string) => {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;

        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/marketplace/reject-seller", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationId, reason }),
            });

            const data = await response.json();

            if (data.success) {
                alert("Seller verification rejected");
                fetchVerifications();
                setIsDetailsModalOpen(false);
            } else {
                alert(data.message || "Failed to reject seller");
            }
        } catch (error) {
            alert("An error occurred while rejecting the seller");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSuspend = async (verificationId: string) => {
        const reason = prompt("Enter suspension reason:");
        if (!reason) return;

        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/marketplace/suspend-seller", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationId, reason }),
            });

            const data = await response.json();

            if (data.success) {
                alert("Seller suspended successfully");
                fetchVerifications();
                setIsDetailsModalOpen(false);
            } else {
                alert(data.message || "Failed to suspend seller");
            }
        } catch (error) {
            alert("An error occurred while suspending the seller");
        } finally {
            setIsProcessing(false);
        }
    };

    const stats = {
        total: verifications.length,
        pending: verifications.filter(v => v.status === "pending").length,
        approved: verifications.filter(v => v.status === "approved").length,
        rejected: verifications.filter(v => v.status === "rejected").length,
    };

    return (
        <div className="p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Seller Verifications
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Review and manage marketplace seller verification requests
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                            <Store className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Total Requests</p>
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
                                placeholder="Search by business name, email, or phone..."
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

            {/* Verifications Table */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600 dark:text-slate-400">Loading verifications...</p>
                    </div>
                ) : filteredVerifications.length === 0 ? (
                    <div className="p-12 text-center">
                        <Store className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                            No Seller Verifications Found
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            {searchQuery || filterStatus !== "all"
                                ? "Try adjusting your filters"
                                : "No verification requests have been submitted yet"}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Business
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Contact
                                    </th>
                                    <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                        Location
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
                                {filteredVerifications.map((verification) => (
                                    <tr key={verification.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-white">
                                                    {verification.businessName}
                                                </p>
                                                <p className="text-sm text-slate-500 dark:text-slate-400 capitalize">
                                                    {verification.businessType}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="text-sm text-slate-900 dark:text-white">
                                                    {verification.phone}
                                                </p>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                                    {verification.email}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="text-sm text-slate-900 dark:text-white">
                                                    {verification.state}
                                                </p>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                                    {verification.lga}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${verification.status === "pending"
                                                    ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                                    : verification.status === "approved"
                                                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                        : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                                }`}>
                                                {verification.status.charAt(0).toUpperCase() + verification.status.slice(1)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                                            {new Date(verification.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => {
                                                    setSelectedVerification(verification);
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
            {isDetailsModalOpen && selectedVerification && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Seller Verification Details
                            </h2>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Business Info */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                                    <Store className="w-5 h-5" />
                                    Business Information
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Business Name</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedVerification.businessName}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Business Type</p>
                                        <p className="font-semibold text-slate-900 dark:text-white capitalize">
                                            {selectedVerification.businessType}
                                        </p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Description</p>
                                        <p className="text-slate-900 dark:text-white">
                                            {selectedVerification.businessDescription}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Location */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                                    <MapPin className="w-5 h-5" />
                                    Contact & Location
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Phone</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedVerification.phone}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Email</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedVerification.email}
                                        </p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Address</p>
                                        <p className="text-slate-900 dark:text-white">
                                            {selectedVerification.address}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">State</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedVerification.state}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">LGA</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedVerification.lga}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Bank Details */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                                    <CreditCard className="w-5 h-5" />
                                    Bank Details
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Bank Name</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedVerification.bankDetails.bankName}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Account Number</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedVerification.bankDetails.accountNumber}
                                        </p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-sm text-slate-600 dark:text-slate-400">Account Name</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {selectedVerification.bankDetails.accountName}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Documents */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                                    <FileText className="w-5 h-5" />
                                    Uploaded Documents
                                </h3>
                                <div className="space-y-2">
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        • Business Document: {selectedVerification.documents.businessDoc}
                                    </p>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        • ID Document: {selectedVerification.documents.idDoc}
                                    </p>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        • Address Proof: {selectedVerification.documents.addressProof}
                                    </p>
                                </div>
                            </div>

                            {/* Status & Rejection Reason */}
                            {selectedVerification.rejectionReason && (
                                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                                    <p className="text-sm font-semibold text-red-900 dark:text-red-100 mb-1">
                                        Rejection Reason:
                                    </p>
                                    <p className="text-sm text-red-700 dark:text-red-300">
                                        {selectedVerification.rejectionReason}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex gap-4">
                            {selectedVerification.status === "pending" && (
                                <>
                                    <button
                                        onClick={() => handleApprove(selectedVerification.id)}
                                        disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50"
                                    >
                                        <CheckCircle className="w-5 h-5 inline mr-2" />
                                        Approve Seller
                                    </button>
                                    <button
                                        onClick={() => handleReject(selectedVerification.id)}
                                        disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50"
                                    >
                                        <XCircle className="w-5 h-5 inline mr-2" />
                                        Reject
                                    </button>
                                </>
                            )}
                            {selectedVerification.status === "approved" && (
                                <button
                                    onClick={() => handleSuspend(selectedVerification.id)}
                                    disabled={isProcessing}
                                    className="flex-1 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl transition-all disabled:opacity-50"
                                >
                                    <Ban className="w-5 h-5 inline mr-2" />
                                    Suspend Seller
                                </button>
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
