"use client";

import { useEffect, useState, useCallback } from "react";
import { logger } from '@/lib/logger';
import { Users, CheckCircle, XCircle, Clock, Eye, Search, Filter, Download, SlidersHorizontal, X, Edit2, Save } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import Modal from "@/components/ui/Modal";
import RejectionModal from "@/components/admin/RejectionModal";
import ImportLegacyModal from "@/components/admin/ImportLegacyModal";
import { useAdminData } from "@/hooks/useAdminData";
import { editApplicationAction } from "@/app/actions/admin";
import { getCooperativeStatsAction, getStandardCooperativeMembersAction } from "@/app/actions/cooperative-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { StandardPendingForm } from "@/lib/types/admin";

type MembershipApplication = {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    otherName?: string;
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
    
    // Advanced filters purely on UI
    const [stateFilter, setStateFilter] = useState("");
    const [lgaFilter, setLgaFilter] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");

    const {
        data: applications,
        loading: isLoading,
        error: fetchError,
        search: searchQuery,
        setSearch: setSearchQuery,
        filters,
        updateFilter,
        hasMore,
        setData: setApplications,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: loadApplications
    } = useAdminData<StandardPendingForm<MembershipApplication>>({
        fetchAction: async (opts) => {
            return getStandardCooperativeMembersAction(
                (opts.status as any) || "all",
                opts.lastDocId,
                opts.limit || 50
            );
        },
        limit: 50
    });

    const statusFilter = (filters.status as any) || "all";
    const paymentStatusFilter = (filters.payment || "all") as any;

    const [stats, setStats] = useState<{ totalMembers: number; paidMembers?: number; pendingMembers: number; activeMembers: number; } | null>(null);
    const [selectedApplication, setSelectedApplication] = useState<StandardPendingForm<MembershipApplication> | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    // Edit mode
    const [isEditMode, setIsEditMode] = useState(false);
    const [editFields, setEditFields] = useState<Record<string, string>>({});
    const [editNote, setEditNote] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    const NIGERIAN_STATES = [
        "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
        "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
        "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
        "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
        "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
    ];

    // Local filter on top of fetched items
    let filteredApplications = applications;


    if (paymentStatusFilter && paymentStatusFilter !== "all") {
        filteredApplications = filteredApplications.filter(a => a.data.paymentStatus === paymentStatusFilter);
    }
    if (stateFilter) {
        filteredApplications = filteredApplications.filter(a => a.data.stateOfOrigin === stateFilter);
    }
    if (lgaFilter) {
        filteredApplications = filteredApplications.filter(a => a.data.lga?.toLowerCase().includes(lgaFilter.toLowerCase()));
    }
    if (fromDate) {
        filteredApplications = filteredApplications.filter(a => new Date(a.data.createdAt) >= new Date(fromDate));
    }
    if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        filteredApplications = filteredApplications.filter(a => new Date(a.data.createdAt) <= end);
    }

    // Load Global Stats
    useEffect(() => {
        getCooperativeStatsAction().then(res => {
            if (res.success && res.data?.stats) {
                setStats(res.data.stats);
            }
        });
    }, []);

    async function handleApprove(applicationId: string) {
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
                await loadApplications();
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

    function handleReject(applicationId: string) {
        setRejectingId(applicationId);
        setRejectionModalOpen(true);
    };

    async function handleConfirmReject(reason: string) {
        if (!rejectingId) return;
        setRejectionModalOpen(false);
        const targetId = rejectingId;
        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/cooperative/reject-member", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memberId: targetId, reason }),
            });
            const data = await response.json();
            if (data.success) {
                showToast("Membership rejected successfully", "success");
                await loadApplications();
                setIsDetailsModalOpen(false);
            } else {
                showToast(data.message || "Failed to reject membership", "error");
            }
        } catch (error) {
            showToast("An error occurred while rejecting the membership", "error");
        } finally {
            setIsProcessing(false);
            setRejectingId(null);
        }
    };

    async function handleExportCSV() {
        setIsExporting(true);
        try {
            window.location.href = "/api/admin/export/cooperative-members";
        } catch (error) {
            showToast("Failed to initiate export", "error");
        } finally {
            setTimeout(() => setIsExporting(false), 2000);
        }
    };
    const viewDetails = (application: StandardPendingForm<MembershipApplication>) => {
        setSelectedApplication(application);
        setIsEditMode(false);
        setEditFields({});
        setEditNote("");
        setIsDetailsModalOpen(true);
    };

    function handleStartEdit() {
        if (!selectedApplication) return;
        setEditFields({
            firstName: selectedApplication.data.firstName || "",
            lastName: selectedApplication.data.lastName || "",
            otherName: selectedApplication.data.otherName || "",
            phone: selectedApplication.data.phone || "",
            email: selectedApplication.data.email || "",
            stateOfOrigin: selectedApplication.data.stateOfOrigin || "",
            lga: selectedApplication.data.lga || "",
            residentialAddress: selectedApplication.data.residentialAddress || "",
            occupation: selectedApplication.data.occupation || "",
            "nextOfKin.name": selectedApplication.data.nextOfKin?.name || "",
            "nextOfKin.phone": selectedApplication.data.nextOfKin?.phone || "",
            "nextOfKin.address": selectedApplication.data.nextOfKin?.address || "",
        });
        setIsEditMode(true);
    };

    async function handleSaveEdit() {
        if (!selectedApplication) return;
        setIsSaving(true);
        const result = await editApplicationAction({
            collection: COLLECTIONS.COOPERATIVE_MEMBERS,
            docId: selectedApplication.id,
            fields: editFields as any,
            editNote,
        });
        if (result.success) {
            showToast("Application updated successfully", "success");
            setIsEditMode(false);
            setEditNote("");
            setSelectedApplication(prev => prev ? {
                ...prev,
                data: {
                    ...prev.data,
                    firstName: editFields.firstName ?? prev.data.firstName,
                    lastName: editFields.lastName ?? prev.data.lastName,
                    otherName: editFields.otherName ?? prev.data.otherName,
                    phone: editFields.phone ?? prev.data.phone,
                    email: editFields.email ?? prev.data.email,
                    stateOfOrigin: editFields.stateOfOrigin ?? prev.data.stateOfOrigin,
                    lga: editFields.lga ?? prev.data.lga,
                    residentialAddress: editFields.residentialAddress ?? prev.data.residentialAddress,
                    occupation: editFields.occupation ?? prev.data.occupation,
                    nextOfKin: {
                        name: editFields["nextOfKin.name"] ?? prev.data.nextOfKin?.name ?? "",
                        phone: editFields["nextOfKin.phone"] ?? prev.data.nextOfKin?.phone ?? "",
                        address: editFields["nextOfKin.address"] ?? prev.data.nextOfKin?.address ?? "",
                    },
                },
            } : null);
            await loadApplications();
        } else {
            showToast(result.error || "Failed to update", "error");
        }
        setIsSaving(false);
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
            <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Cooperative Membership Applications
                    </h1>
                    <p className="text-slate-600">
                        Review and approve member registrations
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsImportModalOpen(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition-all"
                    >
                        <Users className="w-4 h-4" />
                        Invite Legacy Member
                    </button>
                    <button
                        onClick={handleExportCSV}
                        disabled={isExporting}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                    >
                        <Download className="w-4 h-4" />
                        {isExporting ? "Exporting..." : "Export Full CSV"}
                    </button>
                </div>
            </div>

            {/* Filters and Search */}
            <div className="bg-white rounded-2xl p-6 shadow-xl mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
                            onChange={(e) => updateFilter("status", e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All Applications</option>
                            <option value="pending">Pending</option>
                            <option value="under_review">Under Review</option>
                            <option value="approved">Approved</option>
                            <option value="suspended">Suspended</option>
                        </select>
                    </div>
                </div>

                {/* Second row of filters */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    {/* Payment Status Filter */}
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            value={paymentStatusFilter}
                            onChange={(e) => updateFilter("payment", e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All Payment Statuses</option>
                            <option value="completed">Paid Only</option>
                            <option value="pending">Unpaid Only</option>
                        </select>
                    </div>
                </div>

                {/* Advanced Filter Toggle */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowAdvancedFilters(v => !v)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition ${showAdvancedFilters || stateFilter || lgaFilter || fromDate || toDate
                            ? "bg-blue-600 text-white border-blue-600"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                        Advanced Filters
                        {(stateFilter || lgaFilter || fromDate || toDate) && (
                            <span className="bg-white text-blue-600 text-xs font-bold px-1.5 py-0.5 rounded-full">ON</span>
                        )}
                    </button>
                    {(stateFilter || lgaFilter || fromDate || toDate) && (
                        <button
                            onClick={() => { setStateFilter(""); setLgaFilter(""); setFromDate(""); setToDate(""); }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 text-sm hover:bg-red-100 transition"
                        >
                            <X className="w-3.5 h-3.5" /> Clear
                        </button>
                    )}
                </div>

                {showAdvancedFilters && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">State</label>
                            <select
                                value={stateFilter}
                                onChange={(e) => setStateFilter(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm"
                            >
                                <option value="">All States</option>
                                {NIGERIAN_STATES.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">LGA</label>
                            <input
                                type="text"
                                placeholder="e.g. Ikeja"
                                value={lgaFilter}
                                onChange={(e) => setLgaFilter(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">From Date</label>
                            <input
                                type="date"
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">To Date</label>
                            <input
                                type="date"
                                value={toDate}
                                onChange={(e) => setToDate(e.target.value)}
                                className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-yellow-600 mb-1">Pending</p>
                            <p className="text-3xl font-bold text-yellow-700">
                                {stats ? stats.pendingMembers : applications.filter(a => a.status === "pending").length}
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
                                {stats ? stats.activeMembers : applications.filter(a => a.status === "approved").length}
                            </p>
                        </div>
                        <CheckCircle className="w-12 h-12 text-green-500 opacity-50" />
                    </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600 mb-1">Total Paid Members</p>
                            <p className="text-3xl font-bold text-slate-900">
                                {stats ? stats.paidMembers : applications.filter(a => a.data.paymentStatus === "completed").length}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">Out of {stats ? stats.totalMembers : applications.length} applications</p>
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
                    <>
                        {/* Mobile Card View */}
                        <div className="md:hidden divide-y divide-slate-100">
                            {filteredApplications.map((app) => (
                                <div key={app.id} className="p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="font-semibold text-slate-900 text-sm">
                                                {app.user.name || <span className="text-amber-600 italic text-xs">Incomplete</span>}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-0.5">{app.user.email || "—"}</p>
                                        </div>
                                        <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold capitalize ${getStatusBadge(app.status)}`}>
                                            {app.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700 capitalize">
                                            {app.data.membershipTier}
                                        </span>
                                        <span className="text-xs text-slate-500">
                                            ₦{(app.data.registrationFee || 0).toLocaleString()}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => viewDetails(app)}
                                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors"
                                    >
                                        <Eye className="w-4 h-4" />
                                        View Details
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
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
                                        <tr
                                            key={app.id}
                                            className="hover:bg-slate-50 transition cursor-pointer"
                                            onClick={() => {
                                                setSelectedApplication(app);
                                                setIsDetailsModalOpen(true);
                                            }}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                                        <Users className="w-5 h-5 text-slate-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-semibold text-slate-900">{app.user.name}</div>
                                                        <div className="text-sm text-slate-500">{app.user.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm text-slate-900">{app.data.phone || "—"}</div>
                                                <div className="text-xs text-slate-500">{app.data.stateOfOrigin || "—"}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border ${app.data.membershipTier === 'premium' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                                    {app.data.membershipTier}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${app.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                        (app.status === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800')
                                                    }`}>
                                                    {app.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <div className="flex items-center justify-end gap-2">
                                                    {!isEditMode && (app.status === "pending" || app.data.membershipStatus === "pending") && (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleApprove(app.id); }}
                                                                className="text-slate-400 hover:text-green-600 transition p-1.5 hover:bg-green-50 rounded"
                                                                title="Inline Approve"
                                                            >
                                                                <CheckCircle className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleReject(app.id); }}
                                                                className="text-slate-400 hover:text-red-600 transition p-1.5 hover:bg-red-50 rounded"
                                                                title="Inline Reject"
                                                            >
                                                                <XCircle className="w-4 h-4" />
                                                            </button>
                                                        </>
                                                    )}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setSelectedApplication(app); setIsDetailsModalOpen(true); }}
                                                        className="text-slate-400 hover:text-blue-600 transition p-1.5 hover:bg-slate-100 rounded"
                                                        title="View Details"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
                {/* Pagination Controls */}
                {filteredApplications.length > 0 && (
                    <div className="flex items-center justify-between mt-4 p-4 border-t border-slate-200 bg-white">
                        <span className="text-sm font-medium text-slate-500">Page {pageIndex + 1}</span>
                        <div className="flex gap-2">
                            <button
                                onClick={onPrevPage}
                                disabled={pageIndex === 0 || isLoading}
                                className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
                            >
                                Previous
                            </button>
                            <button
                                onClick={onNextPage}
                                disabled={!hasMore || isLoading}
                                className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition flex items-center gap-2"
                            >
                                {isLoading ? <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" /> : "Next Page"}
                            </button>
                        </div>
                    </div>
                )}
            </div>


            {/* Details Modal */}
            <Modal
                isOpen={isDetailsModalOpen}
                onClose={() => { setIsDetailsModalOpen(false); setIsEditMode(false); }}
                title={
                    <div className="flex items-center justify-between w-full">
                        <span>Membership Application Details</span>
                        {!isEditMode ? (
                            <button
                                onClick={handleStartEdit}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                            >
                                <Edit2 className="w-3.5 h-3.5" /> Edit
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setIsEditMode(false); setEditNote(""); }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg transition"
                                >
                                    <X className="w-3.5 h-3.5" /> Cancel
                                </button>
                                <button
                                    onClick={handleSaveEdit}
                                    disabled={isSaving}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg transition disabled:opacity-50"
                                >
                                    <Save className="w-3.5 h-3.5" /> {isSaving ? "Saving…" : "Save"}
                                </button>
                            </div>
                        )}
                    </div>
                }
            >
                {selectedApplication && (
                    <div className="space-y-5">
                        {/* ── Status Banner ─────────────────────────────────── */}
                        <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500 font-medium">Application Status:</span>
                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold capitalize
                                    ${selectedApplication.status === "approved" || selectedApplication.status === "active" ? "bg-green-100 text-green-700" :
                                      selectedApplication.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                                      selectedApplication.status === "suspended" ? "bg-red-100 text-red-700" :
                                      "bg-slate-100 text-slate-600"}`}
                                >
                                    {selectedApplication.status || selectedApplication.data.membershipStatus || "—"}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500 font-medium">Payment:</span>
                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold capitalize
                                    ${selectedApplication.data.paymentStatus === "completed" ? "bg-emerald-100 text-emerald-700" :
                                      selectedApplication.data.paymentStatus === "failed" ? "bg-red-100 text-red-700" :
                                      "bg-amber-100 text-amber-700"}`}
                                >
                                    {selectedApplication.data.paymentStatus || "pending"}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500 font-medium">Tier:</span>
                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold capitalize
                                    ${selectedApplication.data.membershipTier === "premium" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}
                                >
                                    {selectedApplication.data.membershipTier || "basic"}
                                </span>
                            </div>
                            <div className="ml-auto text-xs text-slate-500">
                                Fee: <span className="font-bold text-slate-700">₦{(selectedApplication.data.registrationFee || 0).toLocaleString()}</span>
                            </div>
                        </div>

                        {/* ── Personal Information ───────────────────────────── */}
                        {!isEditMode ? (
                            <>
                                <div>
                                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Personal Information</h4>
                                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 bg-slate-50 rounded-xl p-4 text-sm">
                                        <div>
                                            <p className="text-xs text-slate-400 mb-0.5">Full Name</p>
                                            <p className="font-semibold text-slate-900">
                                                {[selectedApplication.data.firstName, selectedApplication.data.middleName, selectedApplication.data.lastName].filter(Boolean).join(" ") || selectedApplication.user.name || "—"}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-400 mb-0.5">Email</p>
                                            <p className="font-semibold text-slate-900 break-all">{selectedApplication.data.email || selectedApplication.user.email || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-400 mb-0.5">Phone</p>
                                            <p className="font-semibold text-slate-900">{selectedApplication.data.phone || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-400 mb-0.5">Date of Birth</p>
                                            <p className="font-semibold text-slate-900">{selectedApplication.data.dateOfBirth || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-400 mb-0.5">Gender</p>
                                            <p className="font-semibold text-slate-900 capitalize">{selectedApplication.data.gender || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-400 mb-0.5">Occupation</p>
                                            <p className="font-semibold text-slate-900">{selectedApplication.data.occupation || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-400 mb-0.5">State of Origin</p>
                                            <p className="font-semibold text-slate-900">{selectedApplication.data.stateOfOrigin || "—"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-slate-400 mb-0.5">LGA</p>
                                            <p className="font-semibold text-slate-900">{selectedApplication.data.lga || "—"}</p>
                                        </div>
                                        <div className="col-span-2">
                                            <p className="text-xs text-slate-400 mb-0.5">Residential Address</p>
                                            <p className="font-semibold text-slate-900">{selectedApplication.data.residentialAddress || "—"}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* ── Next of Kin ─────────────────────────────────── */}
                                {(selectedApplication.data.nextOfKin?.name || (selectedApplication.data as any).nextOfKinName) && (
                                    <div>
                                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Next of Kin</h4>
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-3 bg-slate-50 rounded-xl p-4 text-sm">
                                            <div>
                                                <p className="text-xs text-slate-400 mb-0.5">Name</p>
                                                <p className="font-semibold text-slate-900">{selectedApplication.data.nextOfKin?.name || (selectedApplication.data as any).nextOfKinName || "—"}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-slate-400 mb-0.5">Phone</p>
                                                <p className="font-semibold text-slate-900">{selectedApplication.data.nextOfKin?.phone || (selectedApplication.data as any).nextOfKinPhone || "—"}</p>
                                            </div>
                                            <div className="col-span-2">
                                                <p className="text-xs text-slate-400 mb-0.5">Address</p>
                                                <p className="font-semibold text-slate-900">{selectedApplication.data.nextOfKin?.address || (selectedApplication.data as any).nextOfKinAddress || "—"}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            /* Edit mode fields */
                            <div className="space-y-3">
                                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Edit Member Details</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    {[
                                        { key: "firstName", label: "First Name" },
                                        { key: "lastName", label: "Last Name" },
                                        { key: "otherName", label: "Other Name" },
                                        { key: "phone", label: "Phone" },
                                        { key: "email", label: "Email" },
                                        { key: "dateOfBirth", label: "Date of Birth" },
                                        { key: "stateOfOrigin", label: "State of Origin" },
                                        { key: "lga", label: "LGA" },
                                        { key: "occupation", label: "Occupation" },
                                        { key: "residentialAddress", label: "Residential Address" },
                                        { key: "nextOfKin.name", label: "Next of Kin Name" },
                                        { key: "nextOfKin.phone", label: "Next of Kin Phone" },
                                        { key: "nextOfKin.address", label: "Next of Kin Address" },
                                    ].map(({ key, label }) => (
                                        <div key={key} className={key === "residentialAddress" || key === "nextOfKin.address" ? "col-span-2" : ""}>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                                            <input
                                                type="text"
                                                value={editFields[key] ?? ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, [key]: e.target.value }))}
                                                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="pt-3 border-t border-slate-200">
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                        Edit Note <span className="text-slate-400 font-normal text-xs">(optional — saved to audit log)</span>
                                    </label>
                                    <textarea
                                        rows={2}
                                        value={editNote}
                                        onChange={(e) => setEditNote(e.target.value)}
                                        placeholder="e.g. Corrected typo in applicant name per phone verification"
                                        className="w-full text-sm px-3 py-2 border border-blue-300 rounded-lg bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                    />
                                </div>
                            </div>
                        )}

                        {/* ── Approve / Reject Actions ─────────────────────── */}
                        {!isEditMode && (selectedApplication.status === "pending" || selectedApplication.data.membershipStatus === "pending") && (
                            <div className="pt-4 border-t border-slate-200 space-y-3">
                                {selectedApplication.data.paymentStatus !== "completed" && (
                                    <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
                                        <Clock className="w-4 h-4 shrink-0" />
                                        Payment not yet confirmed ({selectedApplication.data.paymentStatus}). Verify payment before approving.
                                    </div>
                                )}
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => handleApprove(selectedApplication.id)}
                                        disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        <CheckCircle className="w-5 h-5" />
                                        {isProcessing ? "Processing…" : "Approve"}
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
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            {/* Rejection Modal */}
            <RejectionModal
                isOpen={rejectionModalOpen}
                onClose={() => { setRejectionModalOpen(false); setRejectingId(null); }}
                onConfirm={handleConfirmReject}
                title="Reject Membership Application"
                description="This member will receive an email notification with the reason you provide."
                isProcessing={isProcessing}
            />

            {/* Import Legacy Member Modal */}
            <ImportLegacyModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onSuccess={() => loadApplications()}
            />
        </div>
    );
}
