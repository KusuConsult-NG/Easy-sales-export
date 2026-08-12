"use client";

import { useEffect, useState, useCallback } from "react";
import { logger } from '@/lib/logger';
import { Users, CheckCircle, XCircle, Clock, Eye, Search, Filter, Download, SlidersHorizontal, X, Edit2, Save, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import Modal from "@/components/ui/Modal";
import RejectionModal from "@/components/admin/RejectionModal";
import ImportLegacyModal from "@/components/admin/ImportLegacyModal";
import { useAdminData } from "@/hooks/useAdminData";
import { editApplicationAction } from "@/app/actions/admin";
import { getCooperativeStatsAction, getStandardCooperativeMembersAction } from "@/app/actions/cooperative";
import { COLLECTIONS } from "@/lib/types/firestore";
import { StandardPendingForm } from "@/lib/types/admin";
import DateRangeFilter, { type DateRange } from "@/components/admin/DateRangeFilter";
import DynamicDetailModal from "@/components/admin/DynamicDetailModal";

type MembershipApplication = {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    otherName?: string;
    email: string;
    phone: string;
    membershipTier: "Member";
    registrationFee: number;
    membershipStatus: "pending" | "approved" | "suspended";
    paymentStatus: "pending" | "completed" | "failed";
    onboardingCompleted?: boolean;
    isLegacy?: boolean;
    createdAt: Date;
    // Full details
    middleName?: string;
    dateOfBirth?: string;
    gender?: "male" | "female" | "";
    stateOfOrigin?: string;
    lga?: string;
    ward?: string;
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
    
    // Advanced filters
    const [stateFilter, setStateFilter] = useState("");
    const [lgaFilter, setLgaFilter] = useState("");
    const [dateRange, setDateRange] = useState<DateRange>({ from: "", to: "" });
    const [registryFilter, setRegistryFilter] = useState<"all" | "legacy" | "regular">("all");
    const [sortBy, setSortBy] = useState<"date-desc" | "date-asc" | "name-asc" | "name-desc" | "legacy-first" | "regular-first" | "gender-asc" | "gender-desc">("date-desc");

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
        refresh: loadApplications,
        meta
    } = useAdminData<StandardPendingForm<MembershipApplication>>({
        fetchAction: async (opts) => {
            const mappedSortBy = sortBy.startsWith("gender")
                ? "gender"
                : "createdAt";
            const mappedSortOrder = sortBy.endsWith("-asc") || sortBy === "gender-asc"
                ? "asc"
                : "desc";
            return getStandardCooperativeMembersAction({
                status: (opts.status as any) || "all",
                paymentStatus: (opts.payment as any) || "all",
                cursorId: opts.lastDocId,
                limit: opts.limit || 50,
                search: opts.search ? opts.search.trim() : undefined,
                dateFrom: dateRange.from || undefined,
                dateTo: dateRange.to || undefined,
                state: stateFilter || undefined,
                lga: lgaFilter || undefined,
                registry: registryFilter || undefined,
                sortBy: mappedSortBy,
                sortOrder: mappedSortOrder,
            });
        },
        limit: 50,
        dependencies: [dateRange, stateFilter, lgaFilter, registryFilter, sortBy]
    });

    const statusFilter = (filters.status as any) || "all";
    const paymentStatusFilter = (filters.payment || "all") as any;

    const [stats, setStats] = useState<{ totalMembers: number; paidMembers?: number; unpaidMembers?: number; pendingMembers: number; activeMembers: number; } | null>(null);
    const [selectedApplication, setSelectedApplication] = useState<StandardPendingForm<MembershipApplication> | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isRawDetailOpen, setIsRawDetailOpen] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectingId, setRejectingId] = useState<string | null>(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    // Edit mode
    const [isEditMode, setIsEditMode] = useState(false);
    const [editFields, setEditFields] = useState<Record<string, string>>({});
    const [editNote, setEditNote] = useState("");
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

    // Sort applications
    filteredApplications = [...filteredApplications].sort((a, b) => {
        if (sortBy === "date-desc") {
            const da = a.data?.createdAt ? new Date(a.data.createdAt).getTime() : 0;
            const db = b.data?.createdAt ? new Date(b.data.createdAt).getTime() : 0;
            return db - da;
        }
        if (sortBy === "date-asc") {
            const da = a.data?.createdAt ? new Date(a.data.createdAt).getTime() : 0;
            const db = b.data?.createdAt ? new Date(b.data.createdAt).getTime() : 0;
            return da - db;
        }
        if (sortBy === "name-asc") {
            const nameA = a.user?.name || `${a.data?.firstName || ''} ${a.data?.lastName || ''}`.trim() || "";
            const nameB = b.user?.name || `${b.data?.firstName || ''} ${b.data?.lastName || ''}`.trim() || "";
            return nameA.localeCompare(nameB);
        }
        if (sortBy === "name-desc") {
            const nameA = a.user?.name || `${a.data?.firstName || ''} ${a.data?.lastName || ''}`.trim() || "";
            const nameB = b.user?.name || `${b.data?.firstName || ''} ${b.data?.lastName || ''}`.trim() || "";
            return nameB.localeCompare(nameA);
        }
        if (sortBy === "legacy-first") {
            const la = a.data?.isLegacy ? 1 : 0;
            const lb = b.data?.isLegacy ? 1 : 0;
            return lb - la;
        }
        if (sortBy === "regular-first") {
            const la = a.data?.isLegacy ? 1 : 0;
            const lb = b.data?.isLegacy ? 1 : 0;
            return la - lb;
        }
        if (sortBy === "gender-asc") {
            const ga = a.user?.gender || a.data?.gender || "";
            const gb = b.user?.gender || b.data?.gender || "";
            return ga.localeCompare(gb);
        }
        if (sortBy === "gender-desc") {
            const ga = a.user?.gender || a.data?.gender || "";
            const gb = b.user?.gender || b.data?.gender || "";
            return gb.localeCompare(ga);
        }
        return 0;
    });

    // Load Global Stats
    useEffect(() => {
        getCooperativeStatsAction().then(res => {
            if (res.success && res.data?.stats) {
                setStats(res.data.stats);
            }
        });
    }, []);

    // Check if any cohort filter is active
    const isFiltered = !!(searchQuery || dateRange.from || dateRange.to || stateFilter || lgaFilter || registryFilter !== "all");
    const displayStats = isFiltered && meta?.stats ? meta.stats : stats;

    async function handleApprove(applicationId: string) {
        if (!confirm("Are you sure you want to approve this membership application?")) {
            return;
        }

        setProcessingId(applicationId + "_approve");
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
            setProcessingId(null);
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
        setProcessingId(targetId + "_reject");
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
            setProcessingId(null);
            setRejectingId(null);
        }
    };

    async function handleExportCSV() {
        setProcessingId("export");
        try {
            const params = new URLSearchParams();
            if (stateFilter) params.append('state', stateFilter);
            if (lgaFilter) params.append('lga', lgaFilter);
            if (dateRange.from) params.append('fromDate', dateRange.from);
            if (dateRange.to) params.append('toDate', dateRange.to);
            if (searchQuery) params.append('search', searchQuery);
            window.location.href = `/api/admin/export/cooperative-members?${params.toString()}`;
        } catch (error) {
            showToast("Failed to initiate export", "error");
        } finally {
            setTimeout(() => setProcessingId(null), 2000);
        }
    }
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
            ward: selectedApplication.data.ward || "",
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
        setProcessingId(selectedApplication.id + "_save");
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
                    ward: editFields.ward ?? prev.data.ward,
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
        setProcessingId(null);
    };

    const getStatusBadge = (status: string) => {
        const badges = {
            pending: "bg-yellow-100 text-yellow-700",
            approved: "bg-green-100 text-green-700",
            active: "bg-green-100 text-green-700",
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
                        Onboard Legacy Member
                    </button>
                    {/* Temporarily removed Export CSV button */}
                    {/* <button
                        onClick={handleExportCSV}
                        disabled={processingId === "export"}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                    >
                        <Download className="w-4 h-4" />
                        {processingId === "export" ? "Exporting..." : "Export Full CSV"}
                    </button> */}
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
                            placeholder="Search by name, email, phone, or member ID..."
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
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
                            <option value="unpaid">Unpaid Only</option>
                        </select>
                    </div>

                    {/* Registry Type Filter */}
                    <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            value={registryFilter}
                            onChange={(e) => setRegistryFilter(e.target.value as "all" | "legacy" | "regular")}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All Registry Types</option>
                            <option value="legacy">Legacy Members Only</option>
                            <option value="regular">Regular Members Only</option>
                        </select>
                    </div>

                    {/* Sort By Filter */}
                    <div className="relative">
                        <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as any)}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="date-desc">Newest First</option>
                            <option value="date-asc">Oldest First</option>
                            <option value="name-asc">Name (A-Z)</option>
                            <option value="name-desc">Name (Z-A)</option>
                            <option value="gender-asc">Gender (A-Z)</option>
                            <option value="gender-desc">Gender (Z-A)</option>
                            <option value="legacy-first">Legacy First</option>
                            <option value="regular-first">Regular First</option>
                        </select>
                    </div>
                </div>

                {/* Advanced Filter Toggle */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowAdvancedFilters(v => !v)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition ${showAdvancedFilters || stateFilter || lgaFilter || dateRange.from || dateRange.to || registryFilter !== "all"
                            ? "bg-blue-600 text-white border-blue-600"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                        Advanced Filters
                        {(stateFilter || lgaFilter || dateRange.from || dateRange.to || registryFilter !== "all") && (
                            <span className="bg-white text-blue-600 text-xs font-bold px-1.5 py-0.5 rounded-full">ON</span>
                        )}
                    </button>
                    {(stateFilter || lgaFilter || dateRange.from || dateRange.to || registryFilter !== "all") && (
                        <button
                            onClick={() => { setStateFilter(""); setLgaFilter(""); setDateRange({ from: "", to: "" }); setRegistryFilter("all"); }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 text-sm hover:bg-red-100 transition"
                        >
                            <X className="w-3.5 h-3.5" /> Clear
                        </button>
                    )}
                </div>

                {showAdvancedFilters && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
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
                            <label className="block text-xs font-semibold text-slate-500 mb-1">Date Range</label>
                            <DateRangeFilter
                                value={dateRange}
                                onChange={setDateRange}
                                label="All dates"
                            />
                        </div>
                    </div>
                )}

            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                {isFiltered && (
                    <div className="col-span-full bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-700 font-medium flex flex-wrap gap-x-4 gap-y-1">
                        <span>ℹ️ Showing stats matching active cohort filters:</span>
                        {searchQuery && <span>🔍 Search: "{searchQuery}"</span>}
                        {(dateRange.from || dateRange.to) && <span>📅 Dates: {dateRange.from || "—"} → {dateRange.to || "—"}</span>}
                        {stateFilter && <span>📍 State: {stateFilter}</span>}
                        {lgaFilter && <span>📍 LGA: {lgaFilter}</span>}
                        {registryFilter !== "all" && <span>🗂️ Registry: {registryFilter}</span>}
                    </div>
                )}
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-yellow-600 mb-1">Pending</p>
                            <p className="text-3xl font-bold text-yellow-700">
                                {displayStats ? (
                                    displayStats.pendingMembers
                                ) : (
                                    <span className="inline-block w-16 h-8 bg-yellow-200/50 animate-pulse rounded-lg mt-1" />
                                )}
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
                                {displayStats ? (
                                    displayStats.activeMembers
                                ) : (
                                    <span className="inline-block w-16 h-8 bg-green-200/50 animate-pulse rounded-lg mt-1" />
                                )}
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
                                {displayStats ? (
                                    displayStats.paidMembers
                                ) : (
                                    <span className="inline-block w-16 h-8 bg-slate-200/50 animate-pulse rounded-lg mt-1" />
                                )}
                            </p>
                            {displayStats ? (
                                <p className="text-xs text-slate-500 mt-1">Out of {displayStats.totalMembers} applications</p>
                            ) : (
                                <span className="inline-block w-28 h-4 bg-slate-200/40 animate-pulse rounded mt-1.5" />
                            )}
                        </div>
                        <Users className="w-12 h-12 text-slate-400 opacity-50" />
                    </div>
                </div>

                <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-red-600 mb-1">Unpaid Members</p>
                            <p className="text-3xl font-bold text-red-700">
                                {displayStats ? (
                                    displayStats.unpaidMembers
                                ) : (
                                    <span className="inline-block w-16 h-8 bg-red-200/50 animate-pulse rounded-lg mt-1" />
                                )}
                            </p>
                        </div>
                        <Users className="w-12 h-12 text-red-500 opacity-50" />
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
                                            <p className="font-semibold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
                                                {app.user.name || <span className="text-amber-600 italic text-xs">Incomplete</span>}
                                                {app.data.isLegacy && (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                                        Legacy
                                                    </span>
                                                )}
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                                    {`ESE-COOP-${app.id.slice(-4).toUpperCase()}`}
                                                </span>
                                                {app.user.gender && (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 capitalize">
                                                        {app.user.gender}
                                                    </span>
                                                )}
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
                                                        <div className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                                                            {app.user.name}
                                                            {app.data.isLegacy && (
                                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                                                    Legacy
                                                                </span>
                                                            )}
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                                                {`ESE-COOP-${app.id.slice(-4).toUpperCase()}`}
                                                            </span>
                                                            {app.user.gender && (
                                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 capitalize">
                                                                    {app.user.gender}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm text-slate-500">{app.user.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm text-slate-900">{app.data.phone || "—"}</div>
                                                <div className="text-xs text-slate-500">{app.data.stateOfOrigin || "—"}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border bg-blue-50 text-blue-700 border-blue-200`}>
                                                    {app.data.membershipTier}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                                    app.data.paymentStatus === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                                                    app.data.paymentStatus === 'failed' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                                                }`}>
                                                    {app.data.paymentStatus || 'pending'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${(app.status === 'approved' || app.status === 'active') ? 'bg-green-100 text-green-800' :
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
                                                                disabled={!!processingId && processingId.startsWith(app.id)}
                                                                className="text-slate-400 hover:text-green-600 transition p-1.5 hover:bg-green-50 rounded disabled:opacity-50"
                                                                title="Inline Approve"
                                                            >
                                                                {processingId === app.id + "_approve" ? (
                                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                                ) : (
                                                                    <CheckCircle className="w-4 h-4" />
                                                                )}
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleReject(app.id); }}
                                                                disabled={!!processingId && processingId.startsWith(app.id)}
                                                                className="text-slate-400 hover:text-red-600 transition p-1.5 hover:bg-red-50 rounded disabled:opacity-50"
                                                                title="Inline Reject"
                                                            >
                                                                {processingId === app.id + "_reject" ? (
                                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                                ) : (
                                                                    <XCircle className="w-4 h-4" />
                                                                )}
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
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setSelectedApplication(app); setIsRawDetailOpen(true); }}
                                                        className="text-slate-400 hover:text-slate-900 transition p-1.5 hover:bg-slate-100 rounded"
                                                        title="Full Raw Details"
                                                    >
                                                        <FileText className="w-4 h-4" />
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
                                    disabled={!!processingId && !!selectedApplication && processingId.startsWith(selectedApplication.id)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg transition disabled:opacity-50"
                                >
                                    {processingId === (selectedApplication?.id || "") + "_save" ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Save className="w-3.5 h-3.5" />
                                    )}
                                    {processingId === (selectedApplication?.id || "") + "_save" ? "Saving…" : "Save"}
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
                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold capitalize bg-blue-100 text-blue-700`}
                                >
                                    {selectedApplication.data.membershipTier || "Member"}
                                </span>
                            </div>
                            {selectedApplication.data.isLegacy && (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-500 font-medium">Registry:</span>
                                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                        Legacy
                                    </span>
                                </div>
                            )}
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
                                            <p className="text-xs text-slate-400 mb-0.5">Member Number</p>
                                            <p className="font-semibold text-slate-900">{`ESE-COOP-${selectedApplication.id.slice(-4).toUpperCase()}`}</p>
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
                                        <div>
                                            <p className="text-xs text-slate-400 mb-0.5">Ward</p>
                                            <p className="font-semibold text-slate-900">{selectedApplication.data.ward || "—"}</p>
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
                                        { key: "ward", label: "Ward" },
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
                                        disabled={!!processingId && processingId.startsWith(selectedApplication.id)}
                                        className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {processingId === selectedApplication.id + "_approve" ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <CheckCircle className="w-5 h-5" />
                                        )}
                                        {processingId === selectedApplication.id + "_approve" ? "Approving…" : "Approve"}
                                    </button>
                                    <button
                                        onClick={() => handleReject(selectedApplication.id)}
                                        disabled={!!processingId && processingId.startsWith(selectedApplication.id)}
                                        className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {processingId === selectedApplication.id + "_reject" ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : (
                                            <XCircle className="w-5 h-5" />
                                        )}
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
                isProcessing={!!processingId && processingId.endsWith("_reject")}
            />

            <ImportLegacyModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onSuccess={() => loadApplications()}
                module="cooperative"
            />

            {selectedApplication && (
                <DynamicDetailModal
                    isOpen={isRawDetailOpen}
                    onClose={() => setIsRawDetailOpen(false)}
                    data={selectedApplication.data}
                    title={`Raw Details: ${selectedApplication.user.name}`}
                    collectionName="cooperative_onboarding_applications"
                    onVerified={() => loadApplications()}
                />
            )}
        </div>
    );
}
