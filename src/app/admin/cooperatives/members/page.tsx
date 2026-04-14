"use client";

import { useEffect, useState, useCallback } from "react";
import { logger } from '@/lib/logger';
import { Users, CheckCircle, XCircle, Clock, Eye, Search, Filter, Download, SlidersHorizontal, X, Edit2, Save } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import Modal from "@/components/ui/Modal";
import RejectionModal from "@/components/admin/RejectionModal";
import ImportLegacyModal from "@/components/admin/ImportLegacyModal";
import { editApplicationAction } from "@/app/actions/admin";
import { getCooperativeStatsAction } from "@/app/actions/cooperative-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

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
    const [applications, setApplications] = useState<MembershipApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [stats, setStats] = useState<{ totalMembers: number; pendingMembers: number; activeMembers: number; } | null>(null);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [selectedApplication, setSelectedApplication] = useState<MembershipApplication | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "under_review" | "suspended">("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    // Edit mode
    const [isEditMode, setIsEditMode] = useState(false);
    const [editFields, setEditFields] = useState<Record<string, string>>({});
    const [editNote, setEditNote] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    // Advanced filters
    const [stateFilter, setStateFilter] = useState("");
    const [lgaFilter, setLgaFilter] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    const NIGERIAN_STATES = [
        "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
        "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
        "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
        "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
        "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
    ];

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
                status: statusFilter,
                ...(stateFilter && { state: stateFilter }),
                ...(lgaFilter && { lga: lgaFilter }),
                ...(fromDate && { fromDate }),
                ...(toDate && { toDate }),
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

                setHasMore(data.data?.hasMore);
                setLastCreatedAt(data.lastCreatedAt);
            }
        } catch (error) {
            logger.error("Failed to fetch applications:", error);
            showToast("Failed to load members", "error");
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, lastCreatedAt, stateFilter, lgaFilter, fromDate, toDate]);

    // Initial Load & Filter Change
    useEffect(() => {
        setLastCreatedAt(undefined);
        fetchApplications(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, stateFilter, lgaFilter, fromDate, toDate]);

    // Load Global Stats
    useEffect(() => {
        getCooperativeStatsAction().then(res => {
            if (res.success && res.data?.stats) {
                setStats(res.data.data?.stats);
            }
        });
    }, []);

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
                showToast(data.data?.message || "Failed to approve membership", "error");
            }
        } catch (error) {
            showToast("An error occurred while approving the membership", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = (applicationId: string) => {
        setRejectingId(applicationId);
        setRejectionModalOpen(true);
    };

    const handleConfirmReject = async (reason: string) => {
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
                fetchApplications();
                setIsDetailsModalOpen(false);
            } else {
                showToast(data.data?.message || "Failed to reject membership", "error");
            }
        } catch (error) {
            showToast("An error occurred while rejecting the membership", "error");
        } finally {
            setIsProcessing(false);
            setRejectingId(null);
        }
    };

    function handleExportCSV() {
        if (filteredApplications.length === 0) return;
        const headers = [
            "Name", "Email", "Phone", "Tier", "Registration Fee (NGN)",
            "Payment Status", "Membership Status", "State", "LGA",
            "Occupation", "Date Applied"
        ];
        const rows = filteredApplications.map(app => [
            `${app.firstName || ""} ${app.lastName || ""}`.trim(),
            app.email || "",
            app.phone || "",
            app.membershipTier || "",
            (app.registrationFee || 0).toString(),
            app.paymentStatus || "",
            app.membershipStatus || "",
            app.stateOfOrigin || "",
            app.lga || "",
            app.occupation || "",
            new Date(app.createdAt).toLocaleDateString("en-NG"),
        ]);
        const csv = [
            headers.join(","),
            ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
        ].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cooperative_members_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    };

    const viewDetails = (application: MembershipApplication) => {
        setSelectedApplication(application);
        setIsEditMode(false);
        setEditFields({});
        setEditNote("");
        setIsDetailsModalOpen(true);
    };

    function handleStartEdit() {
        if (!selectedApplication) return;
        setEditFields({
            firstName: selectedApplication.firstName || "",
            lastName: selectedApplication.lastName || "",
            otherName: selectedApplication.otherName || "",
            phone: selectedApplication.phone || "",
            email: selectedApplication.email || "",
            stateOfOrigin: selectedApplication.stateOfOrigin || "",
            lga: selectedApplication.lga || "",
            residentialAddress: selectedApplication.residentialAddress || "",
            occupation: selectedApplication.occupation || "",
            "nextOfKin.name": selectedApplication.nextOfKin?.name || "",
            "nextOfKin.phone": selectedApplication.nextOfKin?.phone || "",
            "nextOfKin.address": selectedApplication.nextOfKin?.address || "",
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
                firstName: editFields.firstName ?? prev.firstName,
                lastName: editFields.lastName ?? prev.lastName,
                otherName: editFields.otherName ?? prev.otherName,
                phone: editFields.phone ?? prev.phone,
                email: editFields.email ?? prev.email,
                stateOfOrigin: editFields.stateOfOrigin ?? prev.stateOfOrigin,
                lga: editFields.lga ?? prev.lga,
                residentialAddress: editFields.residentialAddress ?? prev.residentialAddress,
                occupation: editFields.occupation ?? prev.occupation,
                nextOfKin: {
                    name: editFields["nextOfKin.name"] ?? prev.nextOfKin?.name ?? "",
                    phone: editFields["nextOfKin.phone"] ?? prev.nextOfKin?.phone ?? "",
                    address: editFields["nextOfKin.address"] ?? prev.nextOfKin?.address ?? "",
                },
            } : null);
            fetchApplications(false);
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
                        disabled={filteredApplications.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                    >
                        <Download className="w-4 h-4" />
                        Export CSV ({filteredApplications.length})
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
                            onChange={(e) => setStatusFilter(e.target.value as "all" | "pending" | "approved" | "under_review" | "suspended")}
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
                                {stats ? stats.pendingMembers : applications.filter(a => (a.membershipStatus || (a as any).status) === "pending").length}
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
                                {stats ? stats.activeMembers : applications.filter(a => (a.membershipStatus || (a as any).status) === "approved").length}
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
                                {stats ? stats.totalMembers : applications.length}
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
                    <>
                        {/* Mobile Card View */}
                        <div className="md:hidden divide-y divide-slate-100">
                            {filteredApplications.map((app) => (
                                <div key={app.id} className="p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="font-semibold text-slate-900 text-sm">
                                                {app.firstName || app.lastName
                                                    ? `${app.firstName} ${app.lastName}`.trim()
                                                    : <span className="text-amber-600 italic text-xs">Incomplete</span>}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-0.5">{app.email || "—"}</p>
                                        </div>
                                        <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold capitalize ${getStatusBadge(app.membershipStatus)}`}>
                                            {app.membershipStatus}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700 capitalize">
                                            {app.membershipTier}
                                        </span>
                                        <span className="text-xs text-slate-500">
                                            ₦{(app.registrationFee || 0).toLocaleString()}
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
                    </>
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
                    </div> as any
                }
            >
                {selectedApplication && (
                    <div className="space-y-6">
                        {/* Personal Information */}
                        <div>
                            <h3 className="font-bold text-slate-900 mb-3">Personal Information</h3>
                            {isEditMode ? (
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    {(["firstName", "lastName", "otherName", "occupation"] as const).map((key) => (
                                        <div key={key}>
                                            <label className="text-xs font-semibold text-slate-500 mb-1 block capitalize">{key.replace(/([A-Z])/g, " $1")}</label>
                                            <input
                                                type="text"
                                                value={editFields[key] ?? ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, [key]: e.target.value }))}
                                                className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-sm bg-blue-50 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                            />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-slate-500">Full Name</p>
                                        <p className="font-semibold text-slate-900">
                                            {[selectedApplication.firstName, selectedApplication.otherName, selectedApplication.lastName].filter(Boolean).join(" ")}
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
                            )}
                        </div>

                        {/* Contact Information */}
                        <div>
                            <h3 className="font-bold text-slate-900 mb-3">Contact Information</h3>
                            {isEditMode ? (
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    {(["email", "phone", "stateOfOrigin", "lga"] as const).map((key) => (
                                        <div key={key}>
                                            <label className="text-xs font-semibold text-slate-500 mb-1 block capitalize">{key.replace(/([A-Z])/g, " $1")}</label>
                                            <input
                                                type="text"
                                                value={editFields[key] ?? ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, [key]: e.target.value }))}
                                                className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-sm bg-blue-50 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                            />
                                        </div>
                                    ))}
                                    <div className="col-span-2">
                                        <label className="text-xs font-semibold text-slate-500 mb-1 block">Residential Address</label>
                                        <input
                                            type="text"
                                            value={editFields["residentialAddress"] ?? ""}
                                            onChange={(e) => setEditFields(prev => ({ ...prev, residentialAddress: e.target.value }))}
                                            className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-sm bg-blue-50 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                        />
                                    </div>
                                </div>
                            ) : (
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
                            )}
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
                        {/* Audit Note when in Edit mode */}
                        {isEditMode && (
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
                        )}

                        {!isEditMode && selectedApplication.membershipStatus === "pending" && (
                            <div className="pt-4 border-t border-slate-200 space-y-3">
                                {selectedApplication.paymentStatus !== "completed" && (
                                    <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
                                        <Clock className="w-4 h-4 shrink-0" />
                                        Payment not yet confirmed ({selectedApplication.paymentStatus}). Verify payment before approving.
                                    </div>
                                )}
                                <div className="flex gap-3">
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
                onSuccess={() => fetchApplications()}
            />
        </div>
    );
}
