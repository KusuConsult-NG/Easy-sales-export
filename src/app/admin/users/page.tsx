"use client";

import React, { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { Users, CheckCircle, XCircle, Loader2, Edit, Shield, FileCheck, FileX, SlidersHorizontal, X, MapPin, Download, Layers, Home, CreditCard, FileText } from "lucide-react";
import { toggleUserVerificationAction, toggleUserKycVerificationAction, updateUserRolesAction, getUsersAction, manualAcademyEnrollmentAction, updateUserGenderAction, editApplicationAction } from "@/app/actions/admin";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/contexts/ToastContext";
import AdminDataTable from "@/components/admin/AdminDataTable";
import { useAdminData } from "@/hooks/useAdminData";
import { formatDate } from "@/lib/utils";
import { buildUserColumns, type User } from "./_columns";


const ROLES_LIST = [
    "general_user", "field_officer", "admin", "super_admin", "academy_admin"
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

    // Profile Edit States
    const [isEditMode, setIsEditMode] = useState(false);
    const [editFields, setEditFields] = useState<Record<string, string>>({});
    const [editNote, setEditNote] = useState("");
    const [isSavingEdit, setIsSavingEdit] = useState(false);

    const handleStartEdit = () => {
        if (!selectedUserForModal) return;
        
        let fName = selectedUserForModal.name ? selectedUserForModal.name.split(" ")[0] || "" : "";
        let lName = selectedUserForModal.name ? selectedUserForModal.name.split(" ").slice(1).join(" ") || "" : "";
        let oName = "";

        const userAny = selectedUserForModal as any;
        if (userAny.firstName) fName = userAny.firstName;
        if (userAny.lastName) lName = userAny.lastName;
        if (userAny.otherName) oName = userAny.otherName;

        setEditFields({
            firstName: fName,
            lastName: lName,
            otherName: oName,
            email: selectedUserForModal.email || "",
            phone: selectedUserForModal.phone || "",
            occupation: userAny.occupation || "",
            stateOfOrigin: userAny.stateOfOrigin || selectedUserForModal.state || selectedUserForModal.address?.state || "",
            lga: selectedUserForModal.lga || selectedUserForModal.address?.lga || "",
            residentialAddress: selectedUserForModal.residentialAddress || selectedUserForModal.address?.street || "",
            nin: selectedUserForModal.nin || "",
            bvn: selectedUserForModal.bvn || "",
            cacNumber: selectedUserForModal.cacNumber || "",
            "bankDetails.bankName": selectedUserForModal.bankDetails?.bankName || "",
            "bankDetails.accountNumber": selectedUserForModal.bankDetails?.accountNumber || "",
            "bankDetails.accountName": selectedUserForModal.bankDetails?.accountName || "",
            "bankDetails.bankCode": selectedUserForModal.bankDetails?.bankCode || "",
            "nextOfKin.name": selectedUserForModal.nextOfKin?.name || "",
            "nextOfKin.phone": selectedUserForModal.nextOfKin?.phone || "",
            "nextOfKin.relationship": selectedUserForModal.nextOfKin?.relationship || "",
            "nextOfKin.address": selectedUserForModal.nextOfKin?.address || "",
        });
        setEditNote("");
        setIsEditMode(true);
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUserForModal) return;
        if (!editNote || editNote.trim().length < 10) {
            showToast("Please provide a detailed reason for the edit (minimum 10 characters).", "error");
            return;
        }

        setIsSavingEdit(true);
        try {
            const res = await editApplicationAction({
                collection: "users",
                docId: selectedUserForModal.id,
                fields: editFields as any,
                editNote: editNote.trim()
            });

            if (res.success) {
                showToast("User profile and all linked modules updated successfully", "success");
                
                const computedName = [editFields.firstName, editFields.otherName, editFields.lastName].filter(Boolean).join(" ").trim();
                const updatedUser: User = {
                    ...selectedUserForModal,
                    name: computedName || selectedUserForModal.name,
                    email: editFields.email,
                    phone: editFields.phone,
                    state: editFields.stateOfOrigin,
                    stateOfOrigin: editFields.stateOfOrigin,
                    lga: editFields.lga,
                    residentialAddress: editFields.residentialAddress,
                    nin: editFields.nin,
                    bvn: editFields.bvn,
                    cacNumber: editFields.cacNumber,
                    bankDetails: {
                        ...(selectedUserForModal.bankDetails || {}),
                        bankName: editFields["bankDetails.bankName"],
                        accountNumber: editFields["bankDetails.accountNumber"],
                        accountName: editFields["bankDetails.accountName"],
                        bankCode: editFields["bankDetails.bankCode"],
                    },
                    nextOfKin: {
                        ...(selectedUserForModal.nextOfKin || {}),
                        name: editFields["nextOfKin.name"],
                        phone: editFields["nextOfKin.phone"],
                        relationship: editFields["nextOfKin.relationship"],
                        address: editFields["nextOfKin.address"],
                    }
                };
                const userAny = updatedUser as any;
                userAny.firstName = editFields.firstName;
                userAny.lastName = editFields.lastName;
                userAny.otherName = editFields.otherName;
                userAny.occupation = editFields.occupation;
                
                setSelectedUserForModal(updatedUser);
                setData(prev => prev.map(u => u.id === selectedUserForModal.id ? updatedUser : u));
                setIsEditMode(false);
                refresh();
            } else {
                showToast(res.error || "Failed to update user profile", "error");
            }
        } catch (err: any) {
            showToast(err.message || "An unexpected error occurred", "error");
        } finally {
            setIsSavingEdit(false);
        }
    };

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

    /**
     * Seed the search box from ?search=.
     *
     * The system-health page links here to say "look at this user" — its
     * "Verify" button used to point at /admin/users/<uid>, a route that has
     * never existed, so every one of those 404'd. There is nowhere else for it
     * to go: this list is the only per-user admin surface. Reading the query
     * parameter is what makes the link land on the user it names.
     *
     * window.location rather than useSearchParams: this is the only place in
     * the admin tree that needs it, and useSearchParams would require a
     * Suspense boundary around the page for no other benefit.
     */
    useEffect(() => {
        const initial = new URLSearchParams(window.location.search).get("search");
        if (initial) setSearch(initial);
        // Once, on mount — afterwards the search box owns this state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const hasActiveFilters = !!(filters.state || filters.lga || filters.fromDate || filters.toDate ||
        (filters.role && filters.role !== "all") || (filters.status && filters.status !== "all") ||
        (filters.sortOrder && filters.sortOrder !== "desc") || (filters.sortBy && filters.sortBy !== "createdAt") ||
        (filters.modules && filters.modules !== "all") || (filters.gender && filters.gender !== "all"));

    // Sync the open modal's user object when the data list is refreshed after a save.
    // This ensures the admin sees the true server-side values (not just optimistic ones).
    useEffect(() => {
        if (!selectedUserForModal || !users.length) return;
        const freshUser = users.find(u => u.id === selectedUserForModal.id);
        if (freshUser) {
            setSelectedUserForModal(freshUser as unknown as User);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [users]);

    const clearFilters = () => {
        updateFilter("state", "all");
        updateFilter("lga", "");
        updateFilter("fromDate", "");
        updateFilter("toDate", "");
        updateFilter("role", "all");
        updateFilter("status", "all");
        updateFilter("sortOrder", "desc");
        updateFilter("sortBy", "createdAt");
        updateFilter("modules", "all");
        updateFilter("gender", "all");
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
        setIsEditMode(false);
        setEditFields({});
        setEditNote("");
    };

    async function handleUpdateRoles(formData: FormData) {
        if (!selectedUserForModal) return;
        setIsUpdatingRoles(true);

        const selectedAssignableRoles = ROLES_LIST.filter(role => formData.get(`role_${role}`) === "on");
        
        // Retain any module participant or other roles that are not in the assignable ROLES_LIST
        const currentNonAssignableRoles = (selectedUserForModal.roles || []).filter(
            role => !ROLES_LIST.includes(role)
        );

        const newRoles = Array.from(new Set([...selectedAssignableRoles, ...currentNonAssignableRoles]));
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

    const columns = buildUserColumns({
        processingId,
        onToggleVerification: handleToggleVerification,
        onManageUser: handleManageUser,
    });
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
                    <button
                        type="button"
                        onClick={() => signOut({ callbackUrl: "/auth/login" })}
                        className="shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition text-center"
                    >
                        Sign Out &amp; Refresh
                    </button>
                </div>
            )}

            <AdminDataTable
                columns={columns}
                data={users}
                loading={loading}
                error={error}
                searchTerm={search}
                onSearch={setSearch}
                searchPlaceholder="Search by name, email or phone..."
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
                        {/* Temporarily removed Export CSV button */}
                        {/* <button
                            onClick={handleExportCSV}
                            disabled={isExporting}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
                        >
                            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            Export CSV
                        </button> */}
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

                            {/* Sort By Field */}
                            <select
                                value={filters.sortBy || "createdAt"}
                                onChange={(e) => updateFilter("sortBy", e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                            >
                                <option value="createdAt">Sort by Date Joined</option>
                                <option value="gender">Sort by Gender</option>
                            </select>

                            {/* Quick: Gender Filter */}
                            <select
                                value={filters.gender || "all"}
                                onChange={(e) => updateFilter("gender", e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                            >
                                <option value="all">All Genders</option>
                                <option value="female">Female</option>
                                <option value="male">Male</option>
                            </select>

                            {/* Quick: Sort Date */}
                            <select
                                value={filters.sortOrder || "desc"}
                                onChange={(e) => updateFilter("sortOrder", e.target.value)}
                                className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                            >
                                <option value="desc">Newest First/Z-A</option>
                                <option value="asc">Oldest First/A-Z</option>
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

            <Modal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setIsEditMode(false);
                }}
                title={
                    <div className="flex items-center gap-4">
                        <span>Manage User &amp; Roles</span>
                        {!isEditMode && selectedUserForModal && (
                            <button
                                type="button"
                                onClick={handleStartEdit}
                                className="flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-semibold rounded-lg transition border border-blue-200"
                            >
                                <Edit className="w-3.5 h-3.5" />
                                Edit Profile
                            </button>
                        )}
                    </div>
                }
                maxWidth={isEditMode ? "2xl" : "lg"}
            >
                {selectedUserForModal && (
                    <div className="space-y-6">
                        {isEditMode ? (
                            <form onSubmit={handleSaveEdit} className="space-y-6 animate-fade-in">
                                {/* Warning Alert */}
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 shadow-sm">
                                    <span className="font-semibold block mb-1">⚠️ Administrative Profile Correction</span>
                                    Editing these details will overwrite user records and propagate the changes to all active modules (`cooperative_members`, `wave_applications`, `seller_verifications`, etc.). Make sure correct information is entered.
                                </div>

                                {/* Section 1: Personal Info */}
                                <div>
                                    <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3 pb-1 border-b border-slate-100">Personal &amp; Contact Info</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">First Name</label>
                                            <input
                                                type="text"
                                                required
                                                value={editFields.firstName || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, firstName: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Other Name</label>
                                            <input
                                                type="text"
                                                value={editFields.otherName || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, otherName: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Last Name</label>
                                            <input
                                                type="text"
                                                required
                                                value={editFields.lastName || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, lastName: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div className="col-span-1 sm:col-span-2">
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
                                            <input
                                                type="email"
                                                required
                                                value={editFields.email || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, email: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Phone</label>
                                            <input
                                                type="text"
                                                required
                                                value={editFields.phone || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, phone: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Occupation</label>
                                            <input
                                                type="text"
                                                value={editFields.occupation || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, occupation: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Section 2: Location & Address */}
                                <div>
                                    <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3 pb-1 border-b border-slate-100">Location &amp; Address</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">State</label>
                                            <select
                                                value={editFields.stateOfOrigin || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, stateOfOrigin: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            >
                                                <option value="">Select State</option>
                                                {NIGERIAN_STATES.map(s => (
                                                    <option key={s} value={s}>{s}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">LGA</label>
                                            <input
                                                type="text"
                                                value={editFields.lga || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, lga: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                                placeholder="LGA"
                                            />
                                        </div>
                                        <div className="col-span-1 sm:col-span-2">
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Street Address</label>
                                            <input
                                                type="text"
                                                value={editFields.residentialAddress || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, residentialAddress: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Section 3: KYC Details */}
                                <div>
                                    <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3 pb-1 border-b border-slate-100">KYC Details</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">NIN</label>
                                            <input
                                                type="text"
                                                value={editFields.nin || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, nin: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                                maxLength={11}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">BVN</label>
                                            <input
                                                type="text"
                                                value={editFields.bvn || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, bvn: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                                maxLength={11}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">CAC Business Number</label>
                                            <input
                                                type="text"
                                                value={editFields.cacNumber || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, cacNumber: e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Section 4: Bank Account Details */}
                                <div>
                                    <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3 pb-1 border-b border-slate-100">Bank Account Details</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Bank Name</label>
                                            <input
                                                type="text"
                                                value={editFields["bankDetails.bankName"] || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, "bankDetails.bankName": e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Account Number</label>
                                            <input
                                                type="text"
                                                value={editFields["bankDetails.accountNumber"] || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, "bankDetails.accountNumber": e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                                maxLength={10}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Account Name</label>
                                            <input
                                                type="text"
                                                value={editFields["bankDetails.accountName"] || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, "bankDetails.accountName": e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Bank Code</label>
                                            <input
                                                type="text"
                                                value={editFields["bankDetails.bankCode"] || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, "bankDetails.bankCode": e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Section 5: Next of Kin */}
                                <div>
                                    <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-3 pb-1 border-b border-slate-100">Next of Kin Details</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Full Name</label>
                                            <input
                                                type="text"
                                                value={editFields["nextOfKin.name"] || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, "nextOfKin.name": e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Relationship</label>
                                            <input
                                                type="text"
                                                value={editFields["nextOfKin.relationship"] || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, "nextOfKin.relationship": e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Phone Number</label>
                                            <input
                                                type="text"
                                                value={editFields["nextOfKin.phone"] || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, "nextOfKin.phone": e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1">Address</label>
                                            <input
                                                type="text"
                                                value={editFields["nextOfKin.address"] || ""}
                                                onChange={(e) => setEditFields(prev => ({ ...prev, "nextOfKin.address": e.target.value }))}
                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Section 6: Audit Note (Reason) */}
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Reason for Profile Correction (Required)</label>
                                    <textarea
                                        required
                                        rows={3}
                                        value={editNote}
                                        onChange={(e) => setEditNote(e.target.value)}
                                        placeholder="e.g. Corrected spelling of surname due to NIN mismatch"
                                        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                                    />
                                    <p className="text-[11px] text-slate-500 mt-1">Audit log will record this explanation (minimum 10 characters required).</p>
                                </div>

                                {/* Form Controls */}
                                <div className="flex justify-end gap-3 pt-6 border-t border-slate-200">
                                    <button
                                        type="button"
                                        onClick={() => setIsEditMode(false)}
                                        className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold rounded-lg transition-colors"
                                    >
                                        Back to Details
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSavingEdit || !editNote || editNote.trim().length < 10}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSavingEdit && <Loader2 className="w-4 h-4 animate-spin" />}
                                        Save Changes
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <>
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
                                {selectedUserForModal.identityDocument && (
                                    <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between">
                                        <span className="font-semibold text-slate-600">ID Document:</span>
                                        <a href={selectedUserForModal.identityDocument} target="_blank" rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg text-xs transition border border-blue-200">
                                            <FileText className="w-3.5 h-3.5" /> View Uploaded ID
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Residential Address */}
                        <div>
                            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-slate-500" /> Residential Address
                            </h4>
                            <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-sm text-slate-800 border border-slate-100 shadow-sm">
                                {selectedUserForModal.address?.street || selectedUserForModal.residentialAddress ? (
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                        <div className="col-span-2">
                                            <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">Street Address</span>
                                            <span className="font-medium text-slate-700">{selectedUserForModal.address?.street || selectedUserForModal.residentialAddress}</span>
                                        </div>
                                        {selectedUserForModal.address?.lga || selectedUserForModal.lga ? (
                                            <div>
                                                <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">LGA</span>
                                                <span className="font-medium text-slate-700">{selectedUserForModal.address?.lga || selectedUserForModal.lga}</span>
                                            </div>
                                        ) : null}
                                        {selectedUserForModal.address?.state || selectedUserForModal.stateOfOrigin ? (
                                            <div>
                                                <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">State</span>
                                                <span className="font-medium text-slate-700">{selectedUserForModal.address?.state || selectedUserForModal.stateOfOrigin}</span>
                                            </div>
                                        ) : null}
                                        {selectedUserForModal.address?.city && (
                                            <div>
                                                <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">City</span>
                                                <span className="font-medium text-slate-700">{selectedUserForModal.address?.city}</span>
                                            </div>
                                        )}
                                        <div>
                                            <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">Country</span>
                                            <span className="font-medium text-slate-700">{selectedUserForModal.address?.country || "Nigeria"}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-slate-400 italic text-xs">Not provided</p>
                                )}
                            </div>
                        </div>

                        {/* Bank Account Details */}
                        <div>
                            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <CreditCard className="w-4 h-4 text-slate-500" /> Bank Account Details
                            </h4>
                            <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-sm text-slate-800 border border-slate-100 shadow-sm">
                                {selectedUserForModal.bankDetails?.accountNumber && selectedUserForModal.bankDetails.accountNumber !== "N/A" ? (
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                        <div>
                                            <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">Bank Name</span>
                                            <span className="font-medium text-slate-700">{selectedUserForModal.bankDetails.bankName || "N/A"}</span>
                                        </div>
                                        <div>
                                            <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">Account Number</span>
                                            <span className="font-medium text-slate-700 font-mono">{selectedUserForModal.bankDetails.accountNumber}</span>
                                        </div>
                                        <div className="col-span-2">
                                            <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">Account Name</span>
                                            <span className="font-medium text-slate-700">{selectedUserForModal.bankDetails.accountName || "N/A"}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-slate-400 italic text-xs">Not provided</p>
                                )}
                            </div>
                        </div>

                        {/* Next of Kin Details */}
                        <div>
                            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Users className="w-4 h-4 text-slate-500" /> Next of Kin Details
                            </h4>
                            <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-sm text-slate-800 border border-slate-100 shadow-sm">
                                {selectedUserForModal.nextOfKin?.name ? (
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                        <div>
                                            <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">Full Name</span>
                                            <span className="font-medium text-slate-700">{selectedUserForModal.nextOfKin.name}</span>
                                        </div>
                                        <div>
                                            <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">Relationship</span>
                                            <span className="font-medium text-slate-700">{selectedUserForModal.nextOfKin.relationship || "N/A"}</span>
                                        </div>
                                        <div>
                                            <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">Phone Number</span>
                                            <span className="font-medium text-slate-700 font-mono">{selectedUserForModal.nextOfKin.phone || "N/A"}</span>
                                        </div>
                                        <div className="col-span-2">
                                            <span className="text-[11px] font-bold text-slate-400 block uppercase tracking-wider">Address</span>
                                            <span className="font-medium text-slate-700">{selectedUserForModal.nextOfKin.address || "N/A"}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-slate-400 italic text-xs">Not provided</p>
                                )}
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
                            </>
                        )}
                    </div>
                )}
            </Modal>

            {/* ── Floating Bulk Actions Bar ── */}
            <div
                className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out ${
                    selectedIds.size > 0 ? "translate-y-0" : "translate-y-full"
                }`}
            >
                <div className="bg-slate-900 border-t border-slate-700 shadow-2xl px-6 py-4">
                    <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                            <span className="inline-flex items-center justify-center w-8 h-8 bg-green-500 text-white text-sm font-bold rounded-full">
                                {selectedIds.size}
                            </span>
                            <span className="text-white font-semibold text-sm">
                                {selectedIds.size === 1 ? "1 user selected" : `${selectedIds.size} users selected`}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setSelectedIds(new Set())}
                                className="px-4 py-2 text-slate-300 hover:text-white border border-slate-600 hover:border-slate-400 rounded-lg text-sm font-semibold transition"
                            >
                                Clear Selection
                            </button>
                            <button
                                onClick={handleBulkVerify}
                                disabled={bulkProcessing}
                                className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold rounded-lg text-sm transition shadow-lg shadow-green-900/30"
                            >
                                {bulkProcessing
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <CheckCircle className="w-4 h-4" />}
                                Bulk Verify KYC
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
