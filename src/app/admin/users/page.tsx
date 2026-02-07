"use client";

import { useState, useEffect } from "react";
import { Users, CheckCircle, XCircle, Loader2, AlertCircle, Shield, Search, Download, Filter } from "lucide-react";
import { toggleUserVerificationAction } from "@/app/actions/admin";

interface User {
    id: string;
    name: string;
    email: string;
    phone?: string;
    role: "farmer" | "buyer" | "admin";
    isVerified: boolean;
    cooperativeId?: string;
    createdAt: Date;
    verifiedAt?: Date;
}

export default function AdminUsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [roleFilter, setRoleFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [bulkProcessing, setBulkProcessing] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setIsLoading(true);
        setError(null);

        try {
            // In a real implementation, you'd call a server action here
            // For now, showing the UI structure
            setUsers([]);
        } catch (err: any) {
            setError(err.message || "Failed to load users");
        }

        setIsLoading(false);
    };

    const handleToggleVerification = async (userId: string) => {
        setProcessingId(userId);
        const result = await toggleUserVerificationAction(userId);

        if (result.success) {
            fetchUsers(); // Refresh list
        } else {
            alert(result.error);
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

    const getRoleBadge = (role: User["role"]) => {
        const colors = {
            admin: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
            farmer: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
            buyer: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
        };
        return colors[role];
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
        if (selectedUsers.size === filteredUsers.length) {
            setSelectedUsers(new Set());
        } else {
            setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
        }
    };

    const handleBulkVerify = async () => {
        if (selectedUsers.size === 0 || !confirm(`Verify ${selectedUsers.size} user(s)?`)) return;
        setBulkProcessing(true);

        for (const userId of selectedUsers) {
            await toggleUserVerificationAction(userId);
        }

        setSelectedUsers(new Set());
        fetchUsers();
        setBulkProcessing(false);
    };

    const exportToCSV = () => {
        const csv = [
            ['Name', 'Email', 'Phone', 'Role', 'Verified', 'Joined'],
            ...filteredUsers.map(u => [
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

    const filteredUsers = users.filter(user => {
        const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.email.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesRole = roleFilter === 'all' || user.role === roleFilter;
        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'verified' && user.isVerified) ||
            (statusFilter === 'unverified' && !user.isVerified);
        return matchesSearch && matchesRole && matchesStatus;
    });

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
                            className="flex-1 sm:flex-none px-4 py-2 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-semibold transition touch-manipulation"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Stats Cards & Export */}
            <div className="mb-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 elevation-2">
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-1">Total Users</p>
                        <p className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">{users.length}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 elevation-2">
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-1">Verified</p>
                        <p className="text-2xl sm:text-3xl font-bold text-green-600">
                            {users.filter(u => u.isVerified).length}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 elevation-2">
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-1">Pending</p>
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
            {!isLoading && !error && filteredUsers.length > 0 && (
                <div className="mb-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
                            onChange={toggleSelectAll}
                            className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-2 focus:ring-blue-600"
                        />
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Select All ({filteredUsers.length})
                        </span>
                    </label>
                </div>
            )}

            {/* Users List */}
            {!isLoading && !error && (
                <div className="space-y-4">
                    {filteredUsers.map((user) => (
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
                                </div>
                            </div>
                        </div>
                    ))}

                    {filteredUsers.length === 0 && (
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
        </div>
    );
}
