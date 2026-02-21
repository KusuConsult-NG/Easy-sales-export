"use client";

import { useEffect, useState, useCallback } from "react";
import { logger } from '@/lib/logger';
import { Users, CheckCircle, XCircle, Clock, Eye, Search, Filter } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import Modal from "@/components/ui/Modal";

type MembershipApplication = {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    membershipTier: "basic" | "premium";
    registrationFee: number;
    membershipStatus: "pending" | "approved" | "suspended";
    paymentStatus: "pending" | "completed" | "failed";
    onboardingCompleted?: boolean;
    createdAt: Date;
    // Full details
    middleName?: string;
    dateOfBirth?: string;
    gender?: "male" | "female" | "";
    stateOfOrigin?: string;
    lga?: string;
    residentialAddress?: string;
    occupation?: string;
    nextOfKin?: {
        name: string;
        phone: string;
        address: string;
    };
};

export default function CooperativeMembersPage() {
    const { showToast } = useToast();
    const [applications, setApplications] = useState<MembershipApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [selectedApplication, setSelectedApplication] = useState<MembershipApplication | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "suspended">("all");
    const [searchQuery, setSearchQuery] = useState("");

    // Pagination State
    const [lastCreatedAt, setLastCreatedAt] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(false);

    const fetchApplications = useCallback(async (loadMore = false) => {
        if (loadMore) {
            setIsLoadingMore(true);
        } else {
            setIsLoading(true);
        }

        try {
            const params = new URLSearchParams({
                limit: "20",
                status: statusFilter
            });

            if (loadMore && lastCreatedAt) {
                params.append("lastCreatedAt", lastCreatedAt);
            }

            const response = await fetch(`/api/admin/cooperative/members?${params.toString()}`);
            const data = await response.json();

            if (data.success) {
                if (loadMore) {
                    setApplications(prev => [...prev, ...data.members]);
                } else {
                    setApplications(data.members);
                }

                setHasMore(data.hasMore);
                setLastCreatedAt(data.lastCreatedAt);
            }
        } catch (error) {
            logger.error("Failed to fetch applications:", error);
            showToast("Failed to load members", "error");
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
        }
    }, [statusFilter, lastCreatedAt]);

    // Initial Load & Filter Change
    useEffect(() => {
        // Reset pagination when filter changes
        setLastCreatedAt(undefined);
        fetchApplications(false);
    }, [statusFilter]);

    // Client-side search (still useful for the current batch)
    // For true scalability, search should also be server-side, but that requires full text search service (e.g. Algolia)
    // or simple Firestore prefixes. For now, we filter the *loaded* users.
    const filteredApplications = applications.filter(app => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            (app.firstName || "").toLowerCase().includes(query) ||
            (app.lastName || "").toLowerCase().includes(query) ||
            (app.email || "").toLowerCase().includes(query) ||
            (app.phone || "").includes(query)
        );
    });

    const handleApprove = async (applicationId: string) => {
        if (!confirm("Are you sure you want to approve this membership application?")) {
            return;
        }

        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/cooperative/approve-member", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memberId: applicationId }),
            });

            const data = await response.json();

            if (data.success) {
                showToast("Membership approved successfully", "success");
                fetchApplications();
                setIsDetailsModalOpen(false);
            } else {
                showToast(data.message || "Failed to approve membership", "error");
            }
        } catch (error) {
            showToast("An error occurred while approving the membership", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async (applicationId: string) => {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;

        setIsProcessing(true);
        try {
            if (!selectedApplication) {
                showToast("No application selected", "error");
                return;
            }

            const response = await fetch(`/api/admin/cooperatives/members/${selectedApplication.id}/reject`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason }),
            });

            const data = await response.json();

            if (data.success) {
                showToast("Membership rejected successfully", "success");
                fetchApplications();
                setIsDetailsModalOpen(false);
            } else {
                showToast(data.message || "Failed to reject membership", "error");
            }
        } catch (error) {
            showToast("An error occurred while rejecting the membership", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const viewDetails = (application: MembershipApplication) => {
        setSelectedApplication(application);
        setIsDetailsModalOpen(true);
    };

    const getStatusBadge = (status: string) => {
        const badges = {
            pending: "bg-yellow-100 text-yellow-700",
            approved: "bg-green-100 text-green-700",
            suspended: "bg-red-100 text-red-700",
        };
        return badges[status as keyof typeof badges] || badges.pending;
    };

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    Cooperative Membership Applications
                </h1>
                <p className="text-slate-600">
                    Review and approve member registrations
                </p>
            </div>

            {/* Filters and Search */}
            <div className="bg-white rounded-2xl p-6 shadow-xl mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by name, email, or phone..."
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>

                    {/* Status Filter */}
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as "all" | "pending" | "approved" | "suspended")}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All Applications</option>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="suspended">Suspended</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-yellow-600 mb-1">Pending</p>
                            <p className="text-3xl font-bold text-yellow-700">
                                {applications.filter(a => a.membershipStatus === "pending").length}
                            </p>
                        </div>
                        <Clock className="w-12 h-12 text-yellow-500 opacity-50" />
                    </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-green-600 mb-1">Approved</p>
                            <p className="text-3xl font-bold text-green-700">
                                {applications.filter(a => a.membershipStatus === "approved").length}
                            </p>
                        </div>
                        <CheckCircle className="w-12 h-12 text-green-500 opacity-50" />
                    </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600 mb-1">Total</p>
                            <p className="text-3xl font-bold text-slate-900">
                                {applications.length}
                            </p>
                        </div>
                        <Users className="w-12 h-12 text-slate-400 opacity-50" />
                    </div>
                </div>
            </div>

            {/* Applications Table */}
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600">Loading applications...</p>
                    </div>
                ) : filteredApplications.length === 0 ? (
                    <div className="p-12 text-center">
                        <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-600">No applications found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                        Name
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                        Contact
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                        Tier
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                        Payment
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                        Status
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {filteredApplications.map((app) => (
                                    <tr key={app.id} className="hover:bg-slate-50">
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="font-semibold text-slate-900">
                                                    {app.firstName || app.lastName
                                                        ? `${app.firstName} ${app.lastName}`.trim()
                                                        : <span className="text-amber-600 italic">Incomplete registration</span>}
                                                </p>
                                                <p className="text-sm text-slate-500">
                                                    {new Date(app.createdAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="text-sm text-slate-900">{app.email || "—"}</p>
                                                <p className="text-sm text-slate-500">{app.phone || "—"}</p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700 capitalize">
                                                {app.membershipTier}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="font-semibold text-slate-900">
                                                    ₦{(app.registrationFee || 0).toLocaleString()}
                                                </p>
                                                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${app.paymentStatus === "completed"
                                                    ? "bg-green-100 text-green-700"
                                                    : "bg-yellow-100 text-yellow-700"
                                                    } `}>
                                                    {app.paymentStatus}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusBadge(app.membershipStatus)} `}>
                                                {app.membershipStatus}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => viewDetails(app)}
                                                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors"
                                            >
                                                <Eye className="w-4 h-4" />
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Load More Button */}
            {hasMore && (
                <div className="mt-8 flex justify-center">
                    <button
                        onClick={() => fetchApplications(true)}
                        disabled={isLoadingMore}
                        className="px-6 py-3 bg-white border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                    >
                        {isLoadingMore ? (
                            <>
                                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                Loading...
                            </>
                        ) : (
                            <>
                                Load More Users
                            </>
                        )}
                    </button>
                </div>
            )}


            {/* Details Modal */}
            <Modal
                isOpen={isDetailsModalOpen}
                onClose={() => setIsDetailsModalOpen(false)}
                title="Membership Application Details"
            >
                {selectedApplication && (
                    <div className="space-y-6">
                        {/* Personal Information */}
                        <div>
                            <h3 className="font-bold text-slate-900 mb-3">Personal Information</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-slate-500">Full Name</p>
                                    <p className="font-semibold text-slate-900">
                                        {selectedApplication.firstName} {selectedApplication.middleName} {selectedApplication.lastName}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Date of Birth</p>
                                    <p className="font-semibold text-slate-900">{selectedApplication.dateOfBirth}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Gender</p>
                                    <p className="font-semibold text-slate-900 capitalize">{selectedApplication.gender}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Occupation</p>
                                    <p className="font-semibold text-slate-900">{selectedApplication.occupation}</p>
                                </div>
                            </div>
                        </div>

                        {/* Contact Information */}
                        <div>
                            <h3 className="font-bold text-slate-900 mb-3">Contact Information</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-slate-500">Email</p>
                                    <p className="font-semibold text-slate-900">{selectedApplication.email}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Phone</p>
                                    <p className="font-semibold text-slate-900">{selectedApplication.phone}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-slate-500">Address</p>
                                    <p className="font-semibold text-slate-900">{selectedApplication.residentialAddress}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">State of Origin</p>
                                    <p className="font-semibold text-slate-900">{selectedApplication.stateOfOrigin}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">LGA</p>
                                    <p className="font-semibold text-slate-900">{selectedApplication.lga}</p>
                                </div>
                            </div>
                        </div>

                        {/* Next of Kin */}
                        <div>
                            <h3 className="font-bold text-slate-900 mb-3">Next of Kin</h3>
                            {selectedApplication.nextOfKin?.name ? (
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-slate-500">Name</p>
                                        <p className="font-semibold text-slate-900">{selectedApplication.nextOfKin.name}</p>
                                    </div>
                                    <div>
                                        <p className="text-slate-500">Phone</p>
                                        <p className="font-semibold text-slate-900">{selectedApplication.nextOfKin.phone || "—"}</p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-slate-500">Address</p>
                                        <p className="font-semibold text-slate-900">{selectedApplication.nextOfKin.address || "—"}</p>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sm text-amber-600 italic">Not yet provided (onboarding incomplete)</p>
                            )}
                        </div>

                        {/* Membership Details */}
                        <div>
                            <h3 className="font-bold text-slate-900 mb-3">Membership Details</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-slate-500">Tier</p>
                                    <p className="font-semibold text-slate-900 capitalize">{selectedApplication.membershipTier}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Registration Fee</p>
                                    <p className="font-semibold text-primary">₦{selectedApplication.registrationFee.toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Payment Status</p>
                                    <p className="font-semibold text-slate-900 capitalize">{selectedApplication.paymentStatus}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Application Status</p>
                                    <p className="font-semibold text-slate-900 capitalize">{selectedApplication.membershipStatus}</p>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        {selectedApplication.membershipStatus === "pending" && selectedApplication.paymentStatus === "completed" && (
                            <div className="flex gap-3 pt-4 border-t border-slate-200">
                                <button
                                    onClick={() => handleApprove(selectedApplication.id)}
                                    disabled={isProcessing}
                                    className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <CheckCircle className="w-5 h-5" />
                                    Approve
                                </button>
                                <button
                                    onClick={() => handleReject(selectedApplication.id)}
                                    disabled={isProcessing}
                                    className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <XCircle className="w-5 h-5" />
                                    Reject
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}
