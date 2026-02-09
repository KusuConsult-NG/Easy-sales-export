"use client";

import { useState, useEffect } from "react";
import { Users, Search, Mail, Phone, Calendar, Loader2, Filter, MapPin } from "lucide-react";
import { getAllMembersAction } from "@/app/actions/cooperative-admin";

export default function MemberDirectoryPage() {
    const [loading, setLoading] = useState(true);
    const [members, setMembers] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");

    useEffect(() => {
        loadMembers();
    }, []);

    async function loadMembers() {
        setLoading(true);
        try {
            const result = await getAllMembersAction({ status: "active" as any });
            if (result.success && result.data) {
                setMembers(result.data);
            }
        } catch (error) {
            console.error("Failed to load members:", error);
        } finally {
            setLoading(false);
        }
    }

    function formatDate(date: any) {
        const d = date?.toDate ? date.toDate() : new Date(date);
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
        }).format(d);
    }

    const filteredMembers = members.filter((member) => {
        const searchMatch =
            member.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            member.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            member.email?.toLowerCase().includes(searchTerm.toLowerCase());

        const statusMatch =
            statusFilter === "all" || member.membershipStatus === statusFilter;

        return searchMatch && statusMatch;
    });

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Member Directory
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Connect with fellow cooperative members
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Total Members</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {filteredMembers.length}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                                <Users className="w-5 h-5 text-green-600 dark:text-green-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Active Members</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {members.filter((m) => m.membershipStatus === "active").length}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
                                <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">This Month</p>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">
                            {members.filter((m) => {
                                const date = m.createdAt?.toDate ? m.createdAt.toDate() : new Date(m.createdAt);
                                const thisMonth = new Date().getMonth();
                                return date.getMonth() === thisMonth;
                            }).length}
                        </p>
                    </div>
                </div>

                {/* Search & Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Search Members
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search by name or email..."
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Status
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-600"
                            >
                                <option value="all">All Status</option>
                                <option value="active">Active</option>
                                <option value="pending">Pending</option>
                                <option value="suspended">Suspended</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Members Grid */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-green-600" />
                    </div>
                ) : filteredMembers.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredMembers.map((member) => (
                            <div
                                key={member.id}
                                className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg hover:shadow-xl transition"
                            >
                                {/* Avatar */}
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="w-16 h-16 bg-linear-to-br from-green-600 to-emerald-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                                        {member.firstName?.[0]}{member.lastName?.[0]}
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                                            {member.firstName} {member.lastName}
                                        </h3>
                                        <span
                                            className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${member.membershipStatus === "active"
                                                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                    : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                                }`}
                                        >
                                            {member.membershipStatus}
                                        </span>
                                    </div>
                                </div>

                                {/* Contact Info */}
                                <div className="space-y-3">
                                    {member.email && (
                                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                            <Mail className="w-4 h-4 shrink-0" />
                                            <span className="truncate">{member.email}</span>
                                        </div>
                                    )}

                                    {member.phone && (
                                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                            <Phone className="w-4 h-4 shrink-0" />
                                            <span>{member.phone}</span>
                                        </div>
                                    )}

                                    {member.stateOfOrigin && (
                                        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                            <MapPin className="w-4 h-4 shrink-0" />
                                            <span>{member.stateOfOrigin}</span>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                                        <Calendar className="w-4 h-4 shrink-0" />
                                        <span>Member since {formatDate(member.createdAt)}</span>
                                    </div>
                                </div>

                                {/* Tier Badge */}
                                {member.membershipTier && (
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                        <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-semibold rounded-full capitalize">
                                            {member.membershipTier} Tier
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-12 text-center">
                        <Filter className="w-16 h-16 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                            No Members Found
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Try adjusting your search or filter criteria
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
