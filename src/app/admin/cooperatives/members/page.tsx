"use client";

import { useEffect, useState } from "react";
import { Users, CheckCircle, XCircle, Clock, Eye, Search, Filter } from "lucide-react";
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
    createdAt: Date;
    // Full details
    middleName?: string;
    dateOfBirth: string;
    gender: "male" | "female";
    stateOfOrigin: string;
    lga: string;
    residentialAddress: string;
    occupation: string;
    nextOfKin: {
        name: string;
        phone: string;
        address: string;
    };
};

export default function CooperativeMembersPage() {
    const [applications, setApplications] = useState<MembershipApplication[]>([]);
    const [filteredApplications, setFilteredApplications] = useState<MembershipApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedApplication, setSelectedApplication] = useState<MembershipApplication | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "suspended">("all");
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        fetchApplications();
    }, []);

    useEffect(() => {
        filterApplications();
    }, [applications, statusFilter, searchQuery]);

    const fetchApplications = async () => {
        try {
            const response = await fetch("/api/admin/cooperative/members");
            const data = await response.json();

            if (data.success) {
                setApplications(data.members);
            }
        } catch (error) {
            console.error("Failed to fetch applications:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const filterApplications = () => {
        let filtered = applications;

        // Filter by status
        if (statusFilter !== "all") {
            filtered = filtered.filter(app => app.membershipStatus === statusFilter);
        }

        // Filter by search query
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(app =>
                app.firstName.toLowerCase().includes(query) ||
                app.lastName.toLowerCase().includes(query) ||
                app.email.toLowerCase().includes(query) ||
                app.phone.includes(query)
            );
        }

        setFilteredApplications(filtered);
    };

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
                alert("Membership approved successfully!");
                fetchApplications();
                setIsDetailsModalOpen(false);
            } else {
                alert(data.message || "Failed to approve membership");
            }
        } catch (error) {
            alert("An error occurred while approving the membership");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async (applicationId: string) => {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;

        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/cooperative/reject-member", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memberId: applicationId, reason }),
            });

            const data = await response.json();

            if (data.success) {
                alert("Membership rejected");
                fetchApplications();
                setIsDetailsModalOpen(false);
            } else {
                alert(data.message || "Failed to reject membership");
            }
        } catch (error) {
            alert("An error occurred while rejecting the membership");
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
            pending: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
            approved: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
            suspended: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
        };
        return badges[status as keyof typeof badges] || badges.pending;
    };

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Cooperative Membership Applications
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Review and approve member registrations
                </p>
            </div>

            {/* Filters and Search */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by name, email, or phone..."
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>

                    {/* Status Filter */}
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as any)}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
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
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-yellow-600 dark:text-yellow-400 mb-1">Pending</p>
                            <p className="text-3xl font-bold text-yellow-700 dark:text-yellow-300">
                                {applications.filter(a => a.membershipStatus === "pending").length}
                            </p>
                        </div>
                        <Clock className="w-12 h-12 text-yellow-500 opacity-50" />
                    </div>
                </div>

                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-green-600 dark:text-green-400 mb-1">Approved</p>
                            <p className="text-3xl font-bold text-green-700 dark:text-green-300">
                                {applications.filter(a => a.membershipStatus === "approved").length}
                            </p>
                        </div>
                        <CheckCircle className="w-12 h-12 text-green-500 opacity-50" />
                    </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Total</p>
                            <p className="text-3xl font-bold text-slate-900 dark:text-white">
                                {applications.length}
                            </p>
                        </div>
                        <Users className="w-12 h-12 text-slate-400 opacity-50" />
                    </div>
                </div>
            </div>

            {/* Applications Table */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600 dark:text-slate-400">Loading applications...</p>
                    </div>
                ) : filteredApplications.length === 0 ? (
                    <div className="p-12 text-center">
                        <Users className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                        <p className="text-slate-600 dark:text-slate-400">No applications found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                        Name
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                        Contact
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                        Tier
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                        Payment
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
                                        Status
                                    </th>
                                    <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900 dark:text-white">
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
                                                    {app.firstName} {app.lastName}
                                                </p>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                                    {new Date(app.createdAt).toLocaleDateString()}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="text-sm text-slate-900 dark:text-white">{app.email}</p>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">{app.phone}</p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 capitalize">
                                                {app.membershipTier}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div>
                                                <p className="font-semibold text-slate-900 dark:text-white">
                                                    ₦{app.registrationFee.toLocaleString()}
                                                </p>
                                                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${app.paymentStatus === "completed"
                                                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                        : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                                    }`}>
                                                    {app.paymentStatus}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusBadge(app.membershipStatus)}`}>
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
                            <h3 className="font-bold text-slate-900 dark:text-white mb-3">Personal Information</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Full Name</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">
                                        {selectedApplication.firstName} {selectedApplication.middleName} {selectedApplication.lastName}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Date of Birth</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.dateOfBirth}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Gender</p>
                                    <p className="font-semibold text-slate-900 dark:text-white capitalize">{selectedApplication.gender}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Occupation</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.occupation}</p>
                                </div>
                            </div>
                        </div>

                        {/* Contact Information */}
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white mb-3">Contact Information</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Email</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.email}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Phone</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.phone}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-slate-500 dark:text-slate-400">Address</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.residentialAddress}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">State of Origin</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.stateOfOrigin}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">LGA</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.lga}</p>
                                </div>
                            </div>
                        </div>

                        {/* Next of Kin */}
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white mb-3">Next of Kin</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Name</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.nextOfKin.name}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Phone</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.nextOfKin.phone}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-slate-500 dark:text-slate-400">Address</p>
                                    <p className="font-semibold text-slate-900 dark:text-white">{selectedApplication.nextOfKin.address}</p>
                                </div>
                            </div>
                        </div>

                        {/* Membership Details */}
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white mb-3">Membership Details</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Tier</p>
                                    <p className="font-semibold text-slate-900 dark:text-white capitalize">{selectedApplication.membershipTier}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Registration Fee</p>
                                    <p className="font-semibold text-primary">₦{selectedApplication.registrationFee.toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Payment Status</p>
                                    <p className="font-semibold text-slate-900 dark:text-white capitalize">{selectedApplication.paymentStatus}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400">Application Status</p>
                                    <p className="font-semibold text-slate-900 dark:text-white capitalize">{selectedApplication.membershipStatus}</p>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        {selectedApplication.membershipStatus === "pending" && selectedApplication.paymentStatus === "completed" && (
                            <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
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
