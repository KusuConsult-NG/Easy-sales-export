"use client";

import { useState, useEffect } from "react";
import { Users, CheckCircle, XCircle, Loader2, AlertCircle, Shield, Search } from "lucide-react";
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
    const [processingId, setProcessingId] = useState<string | null>(null);

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

    const filteredUsers = users.filter(user =>
        user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    User Management
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Manage user verification and access control
                </p>
            </div>

            {/* Search Bar */}
            <div className="mb-6">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Total Users</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white">{users.length}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Verified</p>
                    <p className="text-3xl font-bold text-green-600">
                        {users.filter(u => u.isVerified).length}
                    </p>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Pending</p>
                    <p className="text-3xl font-bold text-yellow-600">
                        {users.filter(u => !u.isVerified).length}
                    </p>
                </div>
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
