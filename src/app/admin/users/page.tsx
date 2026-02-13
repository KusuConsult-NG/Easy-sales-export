"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, CheckCircle, XCircle, Loader2, AlertCircle, Shield, Search, Download, Filter, ChevronLeft, ChevronRight, MoreHorizontal, Edit, Lock, Unlock } from "lucide-react";
import { toggleUserVerificationAction, updateUserRolesAction } from "@/app/actions/admin";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/contexts/ToastContext";

interface User {
    id: string;
    name: string;
    email: string;
    phone?: string;
    role: string;
    roles?: string[];
    isVerified: boolean;
    cooperativeId?: string;
    createdAt: Date;
    verifiedAt?: Date;
    bankDetails?: any;
    address?: any;
    metadata?: any;
}

const ROLES_LIST = [
    "admin", "farmer", "buyer", "seller", "exporter", "vendor", "member", "cooperative_member", "logistics", "field_officer"
];

export default function AdminUsersPage() {
    const { showToast } = useToast();
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [roleFilter, setRoleFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [bulkProcessing, setBulkProcessing] = useState(false);

    // Pagination State
    const [lastDocId, setLastDocId] = useState<string | undefined>(undefined);
    const [pageHistory, setPageHistory] = useState<string[]>([]); // Stack of previous page cursors
    const [hasMore, setHasMore] = useState(false);

    // UI State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedUserForModal, setSelectedUserForModal] = useState<User | null>(null);
    const [isUpdatingRoles, setIsUpdatingRoles] = useState(false);

    const fetchUsers = useCallback(async (cursor?: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const { getUsersAction } = await import("@/app/actions/admin");
            const result = await getUsersAction({
                limit: 20,
                role: roleFilter,
                status: statusFilter as "verified" | "unverified" | "all",
                search: searchTerm,
                lastDocId: cursor
            });

            if (!result.success) {
                throw new Error(result.error || "Failed to load users");
            }

            if (result.users) {
                setUsers(result.users);
            }
            setLastDocId(result.lastDocId);
            setHasMore(!!result.hasMore);
        } catch (err: any) {
            setError(err.message || "Failed to load users");
        } finally {
            setIsLoading(false);
        }
    }, [roleFilter, statusFilter, searchTerm]);

    // Initial load & Filter change effect
    useEffect(() => {
        // Debounce search
        const timer = setTimeout(() => {
            setPageHistory([]); // Reset history on filter change
            fetchUsers(undefined);
        }, 500);
        return () => clearTimeout(timer);
    }, [fetchUsers]);

    const onNext = () => {
        if (!lastDocId) return;
        // Save current page's start cursor (or undefined if first page) isn't enough?
        // Actually, we just need to stack the cursors we used to get here.
        // But we don't have the current page's start cursor easily if we don't track it.
        // Simplification: We push the `lastDocId` that we are about to USE.
        // Wait, if we are on P1, we used undefined. Result gave result.lastDocId (Cursor1).
        // Next -> fetch(Cursor1).
        // We push 'undefined' (or existing stack top) to history?
        // Let's just store the stack of cursors that START pages.
        // Page 1 Start: undefined.
        // Page 2 Start: Cursor1.
        // Page 3 Start: Cursor2.

        // When on Page 1 (history=[]):
        // Next: history.push(undefined). Fetch(Cursor1).
        // Now on Page 2 (history=[undefined]).

        // When on Page 2:
        // Next: history.push(Cursor1). Fetch(Cursor2).
        // Now on Page 3 (history=[undefined, Cursor1]).

        // When on Page 3:
        // Prev: pop Cursor1. Fetch(Cursor1).
        // Now on Page 2 (history=[undefined]).

        // This requires we know the "current page start cursor".
        // Use a state for it? Or derive from history?
        // If history=[undefined], we are on Page 2. So current start is... we don't track it explicitly?
        // Ah, typically `fetchUsers` argument IS the start cursor.

        // Let's define `currentPageCursor` state.
        // Initial: undefined.
        // Next: push `currentPageCursor` to history. `currentPageCursor` = `lastDocId`. fetch(`lastDocId`).
        // Prev: pop `prevCursor` from history. `currentPageCursor` = `prevCursor`. fetch(`prevCursor`).

        setPageHistory(prev => [...prev, users[0]?.id ? "previous_page_logic_placeholder" : ""]); // This logic is tricky with Firestore.
        // BETTER:
        // Just stack the docIds.
        // Page 1: History [].
        // Next: Push current `lastDocId`? No.

        // Let's rely on standard practice:
        // `pageHistory` = array of start cursors for pages 1..N
        // Page 1 start is undefined.
        // Page 2 start is result.lastDocId from Page 1.
    };

    // Correct Logic for Button Handlers using closure or ref is safer, but let's try state.
    // We already have `lastDocId` from the fetch. This is the cursor for the NEXT page.
    // To go BACK, we need the cursor for the CURRENT page.

    // Let's use `pageStartCursors` array.
    // [undefined, cursor1, cursor2...]
    // Index 0 = Page 1 start.
    // Index 1 = Page 2 start.
    // Current Page index = pageHistory.length?

    const handleNextPage = () => {
        if (!lastDocId) return;
        const currentStartCursor = pageHistory.length === 0 ? undefined : pageHistory[pageHistory.length - 1]; // Wait, no.

        // Let's reuse the simple stack logic:
        // History contains the start cursor of previous pages.
        // P1: History=[].
        // Next: We need to store P1's start (undefined) into history?
        // No, we store the cursor for P2?

        // Let's do: History stores [CursorForP1, CursorForP2, ...]
        // P1: History = [undefined].
        // Next: History = [undefined, CursorForP2].

        // Let's refactor:
        // `pageCursors` state: string[].
        // Init: [undefined].
        // Page Index state: 0.
        // Fetch(pageCursors[pageIndex]).
        // On success, set pageCursors[pageIndex+1] = result.lastDocId.
    };

    // I will implement a simplifed "Next" that just uses lastDocId and pushes to history.
    // And Prev pop from history.
    // To make this work, `pageHistory` will act as a stack of "Start Cursors" for the pages we have visited.
    // AND we need to track the current page's start cursor to push it before moving next.

    // Actually, simply:
    // P1. Start=undefined. End=CursorA.
    // Next Click: 
    //   history.push(undefined). 
    //   fetch(CursorA).
    // P2. Start=CursorA. End=CursorB.
    // Next Click:
    //   history.push(CursorA).
    //   fetch(CursorB).
    // Prev Click:
    //   prev = history.pop().
    //   fetch(prev).

    // Issue: "undefined" is hard to store if we use string[].
    // Let's use string | null.

    const [pageStack, setPageStack] = useState<(string | undefined)[]>([]);

    const handleNextClick = () => {
        if (!lastDocId) return;
        // What was the cursor for THIS page? 
        // We don't have it stored in a single var, but we can assume logic.
        // If history is empty, this page's cursor was undefined.
        // If history has items, this page's cursor is NOT in the history?
        // NO.

        // Let's use `currentPageStart` state.
        // Init: undefined.
        // On Fetch success: we don't change `currentPageStart`.

        // Next:
        //   pageStack.push(currentPageStart).
        //   currentPageStart = lastDocId.
        //   fetch(lastDocId).
    };

    // I will use a separate state `currentStartAfter` to track the current page's generic start cursor.
    const [currentStartAfter, setCurrentStartAfter] = useState<string | undefined>(undefined);

    const onNextPage = () => {
        if (!hasMore || !lastDocId) return;
        setPageStack(prev => [...prev, currentStartAfter]);
        setCurrentStartAfter(lastDocId);
        fetchUsers(lastDocId);
    };

    const onPrevPage = () => {
        if (pageStack.length === 0) return;
        const newStack = [...pageStack];
        const prevCursor = newStack.pop();
        setPageStack(newStack);
        setCurrentStartAfter(prevCursor);
        fetchUsers(prevCursor);
    };

    const handleToggleVerification = async (userId: string) => {
        setProcessingId(userId);
        const result = await toggleUserVerificationAction(userId);

        if (result.success) {
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, isVerified: !u.isVerified } : u));
        } else {
            showToast(result.error, "error");
        }

        setProcessingId(null);
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

    const toggleSelectUser = (userId: string) => {
        const newSelected = new Set(selectedUsers);
        if (newSelected.has(userId)) {
            newSelected.delete(userId);
        } else {
            newSelected.add(userId);
        }
        setSelectedUsers(newSelected);
    };

    const toggleSelectAll = () => {
        if (selectedUsers.size === users.length) {
            setSelectedUsers(new Set());
        } else {
            setSelectedUsers(new Set(users.map(u => u.id)));
        }
    };

    const handleBulkVerify = async () => {
        if (selectedUsers.size === 0 || !confirm(`Verify ${selectedUsers.size} user(s)?`)) return;
        setBulkProcessing(true);

        for (const userId of selectedUsers) {
            await toggleUserVerificationAction(userId);
        }

        // Optimistic update
        setUsers(prev => prev.map(u => selectedUsers.has(u.id) ? { ...u, isVerified: true, verifiedAt: new Date() } : u));

        setSelectedUsers(new Set());
        setBulkProcessing(false);
    };

    const exportToCSV = () => {
        const csv = [
            ['Name', 'Email', 'Phone', 'Role', 'Verified', 'Joined'],
            ...users.map(u => [
                u.name,
                u.email,
                u.phone || '',
                u.role,
                u.isVerified ? 'Yes' : 'No',
                formatDate(u.createdAt)
            ])
        ].map(row => row.join(',')).join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `users-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    const handleManageUser = (user: User) => {
        setSelectedUserForModal(user);
        setIsModalOpen(true);
    };

    const handleUpdateRoles = async (formData: FormData) => {
        if (!selectedUserForModal) return;
        setIsUpdatingRoles(true);

        const newRoles = ROLES_LIST.filter(role => formData.get(`role_${role}`) === "on");

        // Ensure at least general_user if empty? Or allow empty?
        // Let's ensure general_user if list is empty to avoid lockouts, unless admin intends.
        // Actually, best to just send what is checked.

        const result = await updateUserRolesAction(selectedUserForModal.id, newRoles);

        if (result.success) {
            showToast("Roles updated successfully", "success");
            setUsers(prev => prev.map(u => u.id === selectedUserForModal.id ? { ...u, roles: newRoles, role: newRoles[0] || u.role } : u));
            setIsModalOpen(false);
        } else {
            showToast(result.error || "Failed to update roles", "error");
        }
        setIsUpdatingRoles(false);
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-8">
            {/* Header */}
            <div className="mb-6 sm:mb-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    User Management
                </h1>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">
                    Manage user verification and access control
                </p>
            </div>

            {/* Search & Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
                <div className="sm:col-span-2 relative">
                    <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 sm:pl-12 pr-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-600 text-sm sm:text-base"
                    />
                </div>
                <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-600"
                >
                    <option value="all">All Roles</option>
                    <option value="farmer">Farmers</option>
                    <option value="buyer">Buyers</option>
                    <option value="admin">Admins</option>
                    <option value="exporter">Exporters</option>
                    <option value="vendor">Vendors</option>
                </select>
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-600"
                >
                    <option value="all">All Status</option>
                    <option value="verified">Verified</option>
                    <option value="unverified">Unverified</option>
                </select>
            </div>

            {/* Bulk Actions Bar */}
            {selectedUsers.size > 0 && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-300">
                        {selectedUsers.size} user(s) selected
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleBulkVerify}
                            disabled={bulkProcessing}
                            className="flex-1 sm:flex-none px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 touch-manipulation"
                        >
                            {bulkProcessing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <CheckCircle className="w-4 h-4" />
                            )}
                            Bulk Verify
                        </button>
                        <button
                            onClick={() => setSelectedUsers(new Set())}
                            className="flex-1 sm:flex-none px-4 py-2 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-900 dark:text-white rounded-lg font-semibold transition touch-manipulation"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Pagination Controls */}
            <div className="flex items-center justify-between mb-4 bg-white dark:bg-slate-800 p-4 rounded-xl elevation-1">
                <button
                    onClick={onPrevPage}
                    disabled={pageStack.length === 0 || isLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-700 hover:cursor-pointer"
                >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                </button>
                <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
                    Page {pageStack.length + 1}
                </div>
                <button
                    onClick={onNextPage}
                    disabled={!hasMore || isLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50 hover:bg-blue-700 hover:cursor-pointer"
                >
                    Next
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>

            {/* Stats Cards & Export */}
            <div className="mb-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 elevation-2">
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-1">Total Users (Page)</p>
                        <p className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{users.length}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 elevation-2">
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-1">Verified (Page)</p>
                        <p className="text-2xl sm:text-3xl font-bold text-green-600">
                            {users.filter(u => u.isVerified).length}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 elevation-2">
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-1">Pending (Page)</p>
                        <p className="text-2xl sm:text-3xl font-bold text-yellow-600">
                            {users.filter(u => !u.isVerified).length}
                        </p>
                    </div>
                </div>
                <button
                    onClick={exportToCSV}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition touch-manipulation"
                >
                    <Download className="w-5 h-5" />
                    <span>Export CSV</span>
                </button>
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            )}

            {/* Error State */}
            {error && !isLoading && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-red-300">{error}</p>
                </div>
            )}

            {/* Select All */}
            {!isLoading && !error && users.length > 0 && (
                <div className="mb-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selectedUsers.size === users.length && users.length > 0}
                            onChange={toggleSelectAll}
                            className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-2 focus:ring-blue-600"
                        />
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            Select All ({users.length})
                        </span>
                    </label>
                </div>
            )}

            {/* Users List */}
            {!isLoading && !error && (
                <div className="space-y-4">
                    {users.map((user) => (
                        <div
                            key={user.id}
                            className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2"
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-4">
                                    <input
                                        type="checkbox"
                                        checked={selectedUsers.has(user.id)}
                                        onChange={() => toggleSelectUser(user.id)}
                                        className="mt-1 w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-2 focus:ring-blue-600"
                                    />
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                            <Users className="w-6 h-6 text-primary" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-3 mb-1">
                                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                                    {user.name}
                                                </h3>
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${getRoleBadge(user.role)}`}>
                                                    {user.role}
                                                </span>
                                                {user.isVerified && (
                                                    <Shield className="w-4 h-4 text-green-600" />
                                                )}
                                            </div>
                                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                                {user.email}
                                                {user.phone && ` • ${user.phone}`}
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                                Joined: {formatDate(user.createdAt)}
                                                {user.verifiedAt && ` • Verified: ${formatDate(user.verifiedAt)}`}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleToggleVerification(user.id)}
                                            disabled={processingId === user.id}
                                            className={`px-4 py-2 rounded-lg font-semibold transition disabled:opacity-50 flex items-center gap-2 ${user.isVerified
                                                ? "border border-red-300 dark:border-red-600 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                : "bg-green-600 text-white hover:bg-green-700"
                                                }`}
                                        >
                                            {processingId === user.id ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : user.isVerified ? (
                                                <XCircle className="w-4 h-4" />
                                            ) : (
                                                <CheckCircle className="w-4 h-4" />
                                            )}
                                            {user.isVerified ? "Unverify" : "Verify"}
                                        </button>

                                        <button
                                            onClick={() => handleManageUser(user)}
                                            className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                                            title="Manage User"
                                        >
                                            <Edit className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    {users.length === 0 && (
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center">
                            <Users className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                No Users Found
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400">
                                {searchTerm ? "Try a different search term" : "No users in the system yet"}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* User Details Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Manage User & Roles"
            >
                {selectedUserForModal && (
                    <div className="space-y-6">
                        {/* User Info */}
                        <div>
                            <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">Details</h4>
                            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl space-y-2 text-sm text-slate-800 dark:text-slate-200">
                                <p><span className="font-semibold text-slate-600 dark:text-slate-400">Name:</span> {selectedUserForModal.name}</p>
                                <p><span className="font-semibold text-slate-600 dark:text-slate-400">Email:</span> {selectedUserForModal.email}</p>
                                <p><span className="font-semibold text-slate-600 dark:text-slate-400">Phone:</span> {selectedUserForModal.phone || "N/A"}</p>
                                {selectedUserForModal.bankDetails && (
                                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                                        <p className="text-xs text-slate-500 uppercase mb-1">Bank</p>
                                        <p>{selectedUserForModal.bankDetails.bankName} - {selectedUserForModal.bankDetails.accountNumber}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Form */}
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
