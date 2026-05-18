"use client";

import { useState } from "react";
import { Users, CheckCircle, XCircle, Loader2, Edit, Shield, FileCheck, FileX, SlidersHorizontal, X, MapPin, Download, Layers } from "lucide-react";
import { toggleUserVerificationAction, toggleUserKycVerificationAction, updateUserRolesAction, getUsersAction, manualAcademyEnrollmentAction, updateUserGenderAction } from "@/app/actions/admin";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/contexts/ToastContext";
import AdminDataTable from "@/components/admin/AdminDataTable";
import { useAdminData } from "@/hooks/useAdminData";
import { formatDate } from "@/lib/utils";

interface User {
    id: string;
    name: string;
    email: string;
    phone?: string;
    role: string;
    roles?: string[];
    isVerified: boolean;
    createdAt: Date;
    verifiedAt?: Date;
    bankDetails?: any;
    bvn?: string;
    bvnVerified?: boolean;
    nin?: string;
    ninVerified?: boolean;
    kycStatus?: string;
    idType?: string;
    taxId?: string;
    tinVerified?: boolean;
    cacNumber?: string;
    cacVerified?: boolean;
    state?: string;
    lga?: string;
    address?: any;
    accountType?: string;
    gender?: string;
    serviceRegistrations?: Record<string, any>;
    activeModules?: string[];
    moduleCount?: number;
}

const ROLES_LIST = [
    "general_user", "buyer", "seller", "farmer", "land_owner", "investor",
    "export_participant", "cooperative_member", "wave_participant", "academy_participant",
    "field_officer", "admin", "super_admin"
];

// Major Nigerian states
const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
    "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
    "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
    "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
    "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];

export default function AdminUsersPage() {
    const { showToast } = useToast();
    const [selectedUserForModal, setSelectedUserForModal] = useState<User | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isUpdatingRoles, setIsUpdatingRoles] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [kycProcessingId, setKycProcessingId] = useState<string | null>(null);
    const [bulkProcessing, setBulkProcessing] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [isEnrollingAcademy, setIsEnrollingAcademy] = useState(false);
    const [academyPlan, setAcademyPlan] = useState<"foundation" | "standard" | "elite">("foundation");
    
    // UI state for date filters so they don't apply immediately on first click
    const [tempFromDate, setTempFromDate] = useState("");
    const [tempToDate, setTempToDate] = useState("");

    // Use standardized hook
    const {
        data: users,
        loading,
        error,
        search, // Note: This comes from the hook's internal state
        setSearch, // Function to update search state in the hook
        filters,
        updateFilter,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh,
        setData
    } = useAdminData<User>({
        fetchAction: getUsersAction,
        limit: 20
    });

    const hasActiveFilters = !!(filters.state || filters.lga || filters.fromDate || filters.toDate ||
        (filters.role && filters.role !== "all") || (filters.status && filters.status !== "all") ||
        (filters.sortOrder && filters.sortOrder !== "desc") || (filters.modules && filters.modules !== "all"));

    const clearFilters = () => {
        updateFilter("state", "all");
        updateFilter("lga", "");
        updateFilter("fromDate", "");
        updateFilter("toDate", "");
        updateFilter("role", "all");
        updateFilter("status", "all");
        updateFilter("sortOrder", "desc");
        updateFilter("modules", "all");
        setTempFromDate("");
        setTempToDate("");
    };

    async function handleToggleVerification(userId: string) {
        setProcessingId(userId);
        const result = await toggleUserVerificationAction(userId);

        if (result.success) {
            setData(prev => prev.map(u => u.id === userId ? { 
                ...u, 
                isVerified: !u.isVerified,
                kycStatus: !u.isVerified ? 'verified' : 'pending' 
            } : u));
            showToast(result.message, "success");
        } else {
            showToast(result.error, "error");
        }
        setProcessingId(null);
    };

    async function handleBulkVerify() {
        if (selectedIds.size === 0 || !confirm(`Verify ${selectedIds.size} user(s)?`)) return;
        setBulkProcessing(true);

        for (const userId of selectedIds) {
            await toggleUserVerificationAction(userId);
        }

        // Optimistic update
        setData(prev => prev.map(u => selectedIds.has(u.id) ? { ...u, isVerified: true, verifiedAt: new Date() } : u));
        setSelectedIds(new Set());
        setBulkProcessing(false);
        showToast("Bulk verification completed", "success");
    };

    function handleManageUser(user: User) {
        setSelectedUserForModal(user);
        setIsModalOpen(true);
    };

    async function handleUpdateRoles(formData: FormData) {
        if (!selectedUserForModal) return;
        setIsUpdatingRoles(true);

        const newRoles = ROLES_LIST.filter(role => formData.get(`role_${role}`) === "on");
        const result = await updateUserRolesAction(selectedUserForModal.id, newRoles);

        if (result.success) {
            showToast("Roles updated successfully", "success");
            setData(prev => prev.map(u => u.id === selectedUserForModal.id ? { ...u, roles: newRoles, role: newRoles[0] || u.role } : u));
            setIsModalOpen(false);
        } else {
            showToast(result.error || "Failed to update roles", "error");
        }
        setIsUpdatingRoles(false);
    };

    async function handleAcademyEnrollment() {
        if (!selectedUserForModal) return;
        setIsEnrollingAcademy(true);
        const result = await manualAcademyEnrollmentAction(selectedUserForModal.id, academyPlan);
        if (result.success) {
            showToast(`Successfully enrolled user into ${academyPlan} academy plan`, "success");
            // Optionally auto-add the role in local state to reflect UI change instantly
            setData(prev => prev.map(u => 
                u.id === selectedUserForModal.id 
                    ? { ...u, roles: Array.from(new Set([...(u.roles || []), "academy_participant"])) } 
                    : u
            ));
            setIsModalOpen(false);
        } else {
            showToast(result.error || "Failed to enroll user", "error");
        }
        setIsEnrollingAcademy(false);
    };



    async function handleExportCSV() {
        setIsExporting(true);
        try {
            // Use the full DB exact endpoint instead of local pagination to satisfy Data Consistency 
            window.location.href = "/api/admin/export/users";
        } catch (error) {
            showToast("Failed to initiate export", "error");
        } finally {
            setTimeout(() => setIsExporting(false), 2000);
        }
    };

    // Module pill colours
    const MODULE_COLORS: Record<string, string> = {
        marketplace:   "bg-orange-100 text-orange-700 border-orange-200",
        academy:       "bg-violet-100 text-violet-700 border-violet-200",
        wave:          "bg-pink-100 text-pink-700 border-pink-200",
        cooperatives:  "bg-cyan-100 text-cyan-700 border-cyan-200",
        export:        "bg-indigo-100 text-indigo-700 border-indigo-200",
        "farm-nation": "bg-green-100 text-green-700 border-green-200",
    };

    const getRoleBadge = (role: string) => {
        const colors: Record<string, string> = {
            admin: "bg-purple-100 text-purple-700",
            farmer: "bg-green-100 text-green-700",
            buyer: "bg-blue-100 text-blue-700",
            seller: "bg-orange-100 text-orange-700",
            exporter: "bg-indigo-100 text-indigo-700",
            vendor: "bg-pink-100 text-pink-700",
            member: "bg-cyan-100 text-cyan-700",
        };
        return colors[role] || "bg-slate-100 text-slate-900";
    };

    const columns = [
        {
            header: "User",
            accessor: (user: User) => (
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                            {user.name}
                            {user.isVerified && <Shield className="w-3 h-3 text-green-600" />}
                        </div>
                        <div className="text-xs text-slate-500">{user.email}</div>
                    </div>
                </div>
            )
        },
        {
            header: "Role",
            accessor: (user: User) => (
                <div className="flex flex-col gap-1 items-start">
                    <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${getRoleBadge(user.role)}`}>
                        {user.role}
                    </span>
                    {user.accountType && (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border capitalize ${
                            user.accountType === 'seller' ? 'border-orange-200 text-orange-600 bg-orange-50' : 
                            user.accountType === 'buyer' ? 'border-blue-200 text-blue-600 bg-blue-50' : 
                            'border-indigo-200 text-indigo-600 bg-indigo-50'
                        }`}>
                            Mkt: {user.accountType}
                        </span>
                    )}
                </div>
            ),
            hideOnMobile: true
        },
        {
            header: "KYC",
            accessor: (user: User) => (
                <div className="flex gap-1.5 flex-wrap w-32">
                    {/* NIN badge */}
                    {user.nin ? (
                        <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.ninVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                }`}
                            title={`NIN: ${user.ninVerified ? 'Verified' : 'Pending'}`}
                        >NIN</span>
                    ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-400" title="NIN not provided">NIN</span>
                    )}
                    {/* BVN badge */}
                    {user.bvn ? (
                        <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.bvnVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                }`}
                            title={`BVN: ${user.bvnVerified ? 'Verified' : 'Pending'}`}
                        >BVN</span>
                    ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-400" title="BVN not provided">BVN</span>
                    )}
                    {user.taxId && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.tinVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`} title="TIN">TIN</span>
                    )}
                    {user.cacNumber && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.cacVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`} title="CAC">CAC</span>
                    )}
                </div>
            ),
            hideOnMobile: true
        },
        {
            header: "Modules",
            accessor: (user: User) => (
                <div className="flex flex-wrap gap-1 max-w-[160px]">
                    {(user.activeModules && user.activeModules.length > 0) ? (
                        <>
                            {user.activeModules.map(mod => (
                                <span
                                    key={mod}
                                    className={`px-1.5 py-0.5 rounded border text-[10px] font-bold capitalize ${
                                        MODULE_COLORS[mod] || "bg-slate-100 text-slate-600 border-slate-200"
                                    }`}
                                >
                                    {mod}
                                </span>
                            ))}
                            {(user.moduleCount ?? 0) >= 2 && (
                                <span className="px-1.5 py-0.5 rounded border text-[10px] font-bold bg-amber-100 text-amber-700 border-amber-200 flex items-center gap-0.5">
                                    <Layers className="w-2.5 h-2.5" />{user.moduleCount}
                                </span>
                            )}
                        </>
                    ) : (
                        <span className="text-[10px] text-slate-400 italic">None</span>
                    )}
                </div>
            ),
            hideOnMobile: true
        },
        {
            header: "Joined",
            accessor: (user: User) => formatDate(user.createdAt),
            hideOnMobile: true
        },
        {
            header: "Location",
            accessor: (user: User) => (
                <div className="text-xs text-slate-600">
                    {user.state ? (
                        <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            <span>{user.state}{user.lga ? `, ${user.lga}` : ""}</span>
                        </div>
                    ) : <span className="text-slate-400 italic">—</span>}
                </div>
            ),
            hideOnMobile: true
        },
        {
            header: "Actions",
            accessor: (user: User) => (
                <div className="flex items-center gap-2 justify-end">
                    <button
                        onClick={(e) => { e.stopPropagation(); handleToggleVerification(user.id); }}
                        disabled={processingId === user.id}
                        className={`p-1.5 rounded-lg transition disabled:opacity-50 ${user.isVerified
                            ? "text-red-600 hover:bg-red-50"
                            : "text-green-600 hover:bg-green-50"
                            }`}
                        title={user.isVerified ? "Unverify" : "Verify"}
                    >
                        {processingId === user.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : user.isVerified ? (
                            <XCircle className="w-4 h-4" />
                        ) : (
                            <CheckCircle className="w-4 h-4" />
                        )}
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); handleManageUser(user); }}
                        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                        title="Manage Roles"
                    >
                        <Edit className="w-4 h-4" />
                    </button>
                </div>
            )
        }
    ];

    const toggleSelectAll = () => {
        if (selectedIds.size === users.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(users.map(u => u.id)));
        }
    };

    const toggleSelectRow = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
            <div className="mb-6 sm:mb-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
                    User Management
                </h1>
                <p className="text-sm sm:text-base text-slate-600">
                    Manage user verification and access control
                </p>
            </div>

            {/* Specific access/session error with actionable guidance */}
            {error && (error.includes("Unauthorized") || error.includes("session") || error.includes("expired")) && (
                <div className="mb-6 bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1">
                        <p className="font-semibold text-amber-800">Access Error: {error}</p>
                        <p className="text-sm text-amber-700 mt-1">
                            Your session may not have the correct admin roles. Please <strong>sign out and sign back in</strong> to refresh your permissions.
                        </p>
                    </div>
                    <a
                        href="/auth/signout"
                        className="shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition text-center"
                    >
                        Sign Out &amp; Refresh
                    </a>
                </div>
            )}

            <AdminDataTable
                columns={columns}
                data={users}
                loading={loading}
                error={error}
                searchTerm={search}
                onSearch={setSearch}
                hasMore={hasMore}
                onNextPage={onNextPage}
                onPrevPage={onPrevPage}
                pageIndex={pageIndex}
                selectable={true}
                selectedIds={selectedIds}
                onSelectAll={toggleSelectAll}
                onSelectRow={toggleSelectRow}
                actionButtons={
                    <div className="flex items-center gap-2 flex-wrap">
                        {selectedIds.size > 0 && (
                            <button
                                onClick={handleBulkVerify}
                                disabled={bulkProcessing}
                                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 flex items-center gap-2"
                            >
                                {bulkProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                Bulk Verify ({selectedIds.size})
                            </button>
                        )}
                        <button
                            onClick={handleExportCSV}
                            disabled={isExporting}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
                        >
                            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            Export CSV
                        </button>
                    </div>
                }
                filters={
                    <div className="flex flex-col gap-3 w-full">
                        {/* Filter toggle bar */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <button
                                onClick={() => setIsFilterOpen(v => !v)}
                                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition ${isFilterOpen || hasActiveFilters
                                    ? "bg-blue-600 text-white border-blue-600"
                                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    }`}
                            >
                                <SlidersHorizontal className="w-4 h-4" />
                                Filters
                                {hasActiveFilters && (
                                    <span className="bg-white text-blue-600 text-xs font-bold px-1.5 py-0.5 rounded-full">ON</span>
                                )}
                            </button>

                            {/* Quick: Role */}
                            <select
                                value={filters.role || "all"}
                                onChange={(e) => updateFilter("role", e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                            >
                                <option value="all">All Roles</option>
                                {ROLES_LIST.map(r => (
                                    <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                                ))}
                            </select>

                            {/* Quick: Module Enrolment */}
                            <select
                                value={filters.modules || "all"}
                                onChange={(e) => updateFilter("modules", e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                            >
                                <option value="all">All Modules</option>
                                <option value="marketplace">Marketplace</option>
                                <option value="academy">Academy</option>
                                <option value="wave">WAVE</option>
                                <option value="cooperatives">Cooperatives</option>
                                <option value="export">Export</option>
                                <option value="farm-nation">Farm Nation</option>
                            </select>

                            {/* Quick: Verification */}
                            <select
                                value={filters.status || "all"}
                                onChange={(e) => updateFilter("status", e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                            >
                                <option value="all">All Status</option>
                                <option value="verified">Verified</option>
                                <option value="unverified">Unverified</option>
                            </select>

                            {/* Quick: Sort Date */}
                            <select
                                value={filters.sortOrder || "desc"}
                                onChange={(e) => updateFilter("sortOrder", e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                            >
                                <option value="desc">Newest First</option>
                                <option value="asc">Oldest First</option>
                            </select>

                            {hasActiveFilters && (
                                <button
                                    onClick={clearFilters}
                                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-600 text-sm hover:bg-red-100 transition"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    Clear filters
                                </button>
                            )}
                        </div>

                        {/* Expanded filter panel: State / LGA / Date range */}
                        {isFilterOpen && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                                {/* State */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">State</label>
                                    <select
                                        value={filters.state || "all"}
                                        onChange={(e) => {
                                            updateFilter("state", e.target.value);
                                            updateFilter("lga", "all"); // Reset LGA when state changes
                                        }}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm"
                                    >
                                        <option value="all">All States</option>
                                        {NIGERIAN_STATES.map(s => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* LGA — free-text because LGAs vary widely */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">LGA</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Ikeja"
                                        value={filters.lga || ""}
                                        onChange={(e) => updateFilter("lga", e.target.value)}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm"
                                    />
                                </div>

                                {/* From date */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Joined from</label>
                                    <input
                                        type="date"
                                        value={tempFromDate}
                                        onChange={(e) => setTempFromDate(e.target.value)}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm"
                                    />
                                </div>

                                {/* To date */}
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Joined to</label>
                                    <input
                                        type="date"
                                        value={tempToDate}
                                        onChange={(e) => setTempToDate(e.target.value)}
                                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-sm"
                                    />
                                </div>

                                {/* Apply button for dates */}
                                <div className="col-span-2 sm:col-span-4 flex justify-end mt-2">
                                    <button
                                        onClick={() => {
                                            updateFilter("fromDate", tempFromDate);
                                            updateFilter("toDate", tempToDate);
                                        }}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
                                    >
                                        Apply Date Filter
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                }
            />

            {/* Modal remains mostly the same, just keeping it here for completeness if I were doing a full file replace which I am */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Manage User & Roles"
            >
                {selectedUserForModal && (
                    <div className="space-y-6">
                        <div>
                            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Details</h4>
                            <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-sm text-slate-800">
                                <p><span className="font-semibold text-slate-600">Name:</span> {selectedUserForModal.name}</p>
                                <p><span className="font-semibold text-slate-600">Email:</span> {selectedUserForModal.email}</p>
                                <p><span className="font-semibold text-slate-600">Phone:</span> {selectedUserForModal.phone || "N/A"}</p>
                            </div>
                        </div>

                        {/* Module Enrolment Overview */}
                        <div>
                            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Layers className="w-4 h-4" /> Module Enrolments
                            </h4>
                            <div className="bg-slate-50 rounded-xl overflow-hidden divide-y divide-slate-100">
                                {["marketplace","academy","wave","cooperatives","export","farmNation"].map(key => {
                                    const reg = (selectedUserForModal.serviceRegistrations || {})[key];
                                    const label = key === "farmNation" ? "farm-nation" : key;
                                    const status: string = reg?.status || "not enrolled";
                                    const statusColor =
                                        status === "approved" || status === "active" ? "bg-emerald-100 text-emerald-700" :
                                        status === "pending" ? "bg-amber-100 text-amber-700" :
                                        status === "rejected" ? "bg-red-100 text-red-700" :
                                        "bg-slate-100 text-slate-400";
                                    return (
                                        <div key={key} className="flex items-center justify-between px-4 py-2.5 text-sm">
                                            <span className={`capitalize font-medium ${
                                                reg ? "text-slate-800" : "text-slate-400"
                                            }`}>{label.replace("-", " ")}</span>
                                            <div className="flex items-center gap-2">
                                                {reg?.paymentStatus === "completed" && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-semibold border border-blue-100">Paid</span>
                                                )}
                                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded capitalize ${statusColor}`}>
                                                    {status}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">KYC Details</h4>
                            <div className="bg-slate-50 p-4 rounded-xl space-y-3 text-sm text-slate-800">
                                {[
                                    { key: "nin", label: "NIN", value: selectedUserForModal.nin, verified: selectedUserForModal.ninVerified },
                                    { key: "bvn", label: "BVN", value: selectedUserForModal.bvn, verified: selectedUserForModal.bvnVerified },
                                    { key: "tin", label: "TIN", value: selectedUserForModal.taxId, verified: selectedUserForModal.tinVerified },
                                    { key: "cac", label: "CAC", value: selectedUserForModal.cacNumber, verified: selectedUserForModal.cacVerified },
                                ].map((item) => (
                                    <div key={item.key} className="flex items-center justify-between border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-slate-600">{item.label}:</span>
                                            <span className={item.value ? "font-mono font-medium" : "text-slate-400 italic"}>
                                                {item.value ? `${item.value.slice(0, 4)}${'*'.repeat(Math.max(0, item.value.length - 4))}` : "Not provided"}
                                            </span>
                                            {item.key === "bvn" && selectedUserForModal.idType && (
                                                <span className="text-xs text-slate-500 uppercase">ID Type: {selectedUserForModal.idType}</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {item.value ? (
                                                <>
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${item.verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                        {item.verified ? 'Verified' : 'Unverified'}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            const pId = `${selectedUserForModal.id}_${item.key}`;
                                                            setKycProcessingId(pId);
                                                            const result = await toggleUserKycVerificationAction(
                                                                selectedUserForModal.id,
                                                                item.key as 'bvn' | 'nin' | 'tin' | 'cac',
                                                                !!item.verified
                                                            );
                                                            if (result.success) {
                                                                const verifyField =
                                                                    item.key === 'nin' ? 'ninVerified' :
                                                                        item.key === 'bvn' ? 'bvnVerified' :
                                                                            item.key === 'tin' ? 'tinVerified' : 'cacVerified';
                                                                
                                                                // Optimistically recalculate kycStatus
                                                                const isNin = item.key === 'nin';
                                                                const isBvn = item.key === 'bvn';
                                                                let newKycStatus = selectedUserForModal.kycStatus;
                                                                if (isNin || isBvn) {
                                                                    const otherVerified = isNin ? selectedUserForModal.bvnVerified : selectedUserForModal.ninVerified;
                                                                    newKycStatus = (!item.verified && otherVerified) ? 'verified' : 'pending';
                                                                }

                                                                const updatedUser = { 
                                                                    ...selectedUserForModal, 
                                                                    [verifyField]: !item.verified,
                                                                    kycStatus: newKycStatus
                                                                };
                                                                setSelectedUserForModal(updatedUser as User);
                                                                setData(prev => prev.map(u => u.id === selectedUserForModal.id ? updatedUser as User : u));
                                                                showToast(result.message, "success");
                                                            } else {
                                                                showToast(result.error, "error");
                                                            }
                                                            setKycProcessingId(null);
                                                        }}
                                                        disabled={kycProcessingId === `${selectedUserForModal.id}_${item.key}`}
                                                        className={`p-1.5 rounded-lg transition disabled:opacity-50 ${item.verified ? "text-red-600 hover:bg-red-50" : "text-emerald-600 hover:bg-emerald-50"}`}
                                                        title={item.verified ? `Unverify ${item.label}` : `Verify ${item.label}`}
                                                    >
                                                        {kycProcessingId === `${selectedUserForModal.id}_${item.key}` ? (
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                        ) : item.verified ? (
                                                            <FileX className="w-4 h-4" />
                                                        ) : (
                                                            <FileCheck className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                </>
                                            ) : (
                                                <span className="text-xs text-slate-400">N/A</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Gender Settings</h4>
                            <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                                <p className="text-xs text-slate-500 mb-2 italic">Correct this if the user is blocked from gender-specific programs (e.g., WAVE).</p>
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                const res = await updateUserGenderAction(selectedUserForModal.id, "male");
                                                if (res.success) {
                                                    showToast("Gender updated to Male", "success");
                                                    setSelectedUserForModal({ ...selectedUserForModal, gender: "male" });
                                                    setData(prev => prev.map(u => u.id === selectedUserForModal.id ? { ...u, gender: "male" } : u));
                                                }
                                            }}
                                            className={`px-3 py-2 rounded-lg border text-sm font-semibold transition ${selectedUserForModal.gender === "male" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}
                                        >
                                            Male
                                        </button>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                const res = await updateUserGenderAction(selectedUserForModal.id, "female");
                                                if (res.success) {
                                                    showToast("Gender updated to Female", "success");
                                                    setSelectedUserForModal({ ...selectedUserForModal, gender: "female" });
                                                    setData(prev => prev.map(u => u.id === selectedUserForModal.id ? { ...u, gender: "female" } : u));
                                                }
                                            }}
                                            className={`px-3 py-2 rounded-lg border text-sm font-semibold transition ${selectedUserForModal.gender === "female" ? "bg-purple-600 text-white border-purple-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}
                                        >
                                            Female
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <form action={handleUpdateRoles}>
                            <div>
                                <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Roles</h4>
                                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-1">
                                    {ROLES_LIST.map(role => (
                                        <label key={role} className="flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-500 transition text-sm">
                                            <input
                                                type="checkbox"
                                                name={`role_${role}`}
                                                defaultChecked={selectedUserForModal.roles?.includes(role)}
                                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-600"
                                            />
                                            <span className="capitalize text-slate-900">{role.replace("_", " ")}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-6 border-t border-slate-200 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isUpdatingRoles}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-2"
                                >
                                    {isUpdatingRoles && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Update Roles
                                </button>
                            </div>
                        </form>

                        <div className="pt-6 border-t border-slate-200">
                            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Manual Academy Enrollment</h4>
                            <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                                <p className="text-sm text-slate-600">Enroll this user into an Academy Tier manually. This bypasses the payment gateway.</p>
                                <div className="flex items-center gap-3">
                                    <select
                                        value={academyPlan}
                                        onChange={(e) => setAcademyPlan(e.target.value as any)}
                                        className="flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                                    >
                                        <option value="foundation">Foundation</option>
                                        <option value="standard">Standard</option>
                                        <option value="elite">Elite</option>
                                    </select>
                                    <button
                                        onClick={handleAcademyEnrollment}
                                        disabled={isEnrollingAcademy}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded-lg flex items-center gap-2 text-sm shrink-0"
                                    >
                                        {isEnrollingAcademy && <Loader2 className="w-4 h-4 animate-spin" />}
                                        Enroll Now
                                    </button>
                                </div>
                            </div>
                        </div>

                    </div>
                )}
            </Modal>
        </div>
    );
}
