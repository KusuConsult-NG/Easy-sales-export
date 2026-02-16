"use client";

import { useState } from "react";
import { Users, CheckCircle, XCircle, Loader2, Edit, Shield } from "lucide-react";
import { toggleUserVerificationAction, updateUserRolesAction, getUsersAction } from "@/app/actions/admin";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/contexts/ToastContext";
import AdminDataTable from "@/components/admin/AdminDataTable";
import { useAdminData } from "@/hooks/useAdminData";

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
}

const ROLES_LIST = [
    "admin", "farmer", "buyer", "seller", "exporter", "vendor", "member", "cooperative_member", "logistics", "field_officer"
];

export default function AdminUsersPage() {
    const { showToast } = useToast();
    const [selectedUserForModal, setSelectedUserForModal] = useState<User | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isUpdatingRoles, setIsUpdatingRoles] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [bulkProcessing, setBulkProcessing] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

    const handleToggleVerification = async (userId: string) => {
        setProcessingId(userId);
        const result = await toggleUserVerificationAction(userId);

        if (result.success) {
            setData(prev => prev.map(u => u.id === userId ? { ...u, isVerified: !u.isVerified } : u));
            showToast(result.message, "success");
        } else {
            showToast(result.error, "error");
        }
        setProcessingId(null);
    };

    const handleBulkVerify = async () => {
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

    const handleManageUser = (user: User) => {
        setSelectedUserForModal(user);
        setIsModalOpen(true);
    };

    const handleUpdateRoles = async (formData: FormData) => {
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

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
            day: "numeric"
        }).format(new Date(date));
    };

    const getRoleBadge = (role: string) => {
        const colors: Record<string, string> = {
            admin: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
            farmer: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
            buyer: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
            seller: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
            exporter: "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400",
            vendor: "bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400",
            member: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400",
        };
        return colors[role] || "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-400";
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
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
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
                <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${getRoleBadge(user.role)}`}>
                    {user.role}
                </span>
            ),
            hideOnMobile: true
        },
        {
            header: "Joined",
            accessor: (user: User) => formatDate(user.createdAt),
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
                                ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                : "text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
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
                        className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
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
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-8">
            <div className="mb-6 sm:mb-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    User Management
                </h1>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">
                    Manage user verification and access control
                </p>
            </div>

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
                    selectedIds.size > 0 && (
                        <button
                            onClick={handleBulkVerify}
                            disabled={bulkProcessing}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 flex items-center gap-2"
                        >
                            {bulkProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Bulk Verify ({selectedIds.size})
                        </button>
                    )
                }
                filters={
                    <>
                        <select
                            value={filters.role || "all"}
                            onChange={(e) => updateFilter("role", e.target.value)}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                        >
                            <option value="all">All Roles</option>
                            <option value="farmer">Farmers</option>
                            <option value="buyer">Buyers</option>
                            <option value="admin">Admins</option>
                        </select>
                        <select
                            value={filters.status || "all"}
                            onChange={(e) => updateFilter("status", e.target.value)}
                            className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                        >
                            <option value="all">All Status</option>
                            <option value="verified">Verified</option>
                            <option value="unverified">Unverified</option>
                        </select>
                    </>
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
                            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl space-y-2 text-sm text-slate-800 dark:text-slate-200">
                                <p><span className="font-semibold text-slate-600 dark:text-slate-400">Name:</span> {selectedUserForModal.name}</p>
                                <p><span className="font-semibold text-slate-600 dark:text-slate-400">Email:</span> {selectedUserForModal.email}</p>
                                <p><span className="font-semibold text-slate-600 dark:text-slate-400">Phone:</span> {selectedUserForModal.phone || "N/A"}</p>
                            </div>
                        </div>

                        <form action={handleUpdateRoles}>
                            <div>
                                <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Roles</h4>
                                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-1">
                                    {ROLES_LIST.map(role => (
                                        <label key={role} className="flex items-center gap-2 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer hover:border-blue-500 transition text-sm">
                                            <input
                                                type="checkbox"
                                                name={`role_${role}`}
                                                defaultChecked={selectedUserForModal.roles?.includes(role)}
                                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-600"
                                            />
                                            <span className="capitalize text-slate-900 dark:text-white">{role.replace("_", " ")}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-6 border-t border-slate-200 dark:border-slate-700 mt-6">
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
                    </div>
                )}
            </Modal>
        </div>
    );
}
