"use client";

import { useState } from "react";
import { logger } from "@/lib/logger";
import { Users, Search, Eye, ShoppingCart, Download, Filter, Loader2 } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useAdminData } from "@/hooks/useAdminData";
import { getMarketplaceUsersAction } from "@/app/actions/admin";
import DateRangeFilter, { type DateRange } from "@/components/admin/DateRangeFilter";
import { formatLocalDate } from "@/lib/date-utils";

type BuyerRole = "buyer_only" | "seller_only" | "both";

interface MarketplaceUser {
    id: string;
    name: string;
    email: string;
    phone?: string;
    state?: string;
    lga?: string;
    roles: string[];
    buyerRole: BuyerRole;
    totalOrders?: number;
    lastOrderAt?: string;
    createdAt?: string;
    status?: string;
}

type FilterTab = "all" | "buyer_only" | "seller_only" | "both";

export default function MarketplaceBuyersPage() {
    const { showToast } = useToast();
    const [dateRange, setDateRange] = useState<DateRange>({ from: "", to: "" });
    
    const {
        data: users,
        loading: isLoading,
        error: fetchError,
        search: searchQuery,
        setSearch: setSearchQuery,
        filters,
        updateFilter,
        hasMore,
        setData: setUsers,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: loadUsers
    } = useAdminData<MarketplaceUser>({
        fetchAction: async (opts) => getMarketplaceUsersAction({
            ...opts,
            roleFilter: opts.roleFilter as any,
            dateFrom: dateRange.from || undefined,
            dateTo: dateRange.to || undefined,
        }),
        limit: 50,
        dependencies: [dateRange]
    });

    const roleFilter = (filters.roleFilter as FilterTab) || "all";
    const [selectedUser, setSelectedUser] = useState<MarketplaceUser | null>(null);

    // Filter logic is mostly handled at the database level now, but we'll apply it locally on fetched block
    const filtered = users;

    const stats = {
        total: users.length,
        buyerOnly: users.filter(u => u.buyerRole === "buyer_only").length,
        sellerOnly: users.filter(u => u.buyerRole === "seller_only").length,
        both: users.filter(u => u.buyerRole === "both").length,
    };

    function handleExport() {
        const headers = ["Name", "Email", "Phone", "State", "LGA", "Role", "Status", "Joined"];
        const rows = filtered.map(u => [u.name, u.email, u.phone || "—", u.state || "—", u.lga || "—", u.buyerRole.replace("_", " "), u.status || "—", formatLocalDate(u.createdAt) || "—"]);
        const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `marketplace_users_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    };

    const roleBadge = (role: BuyerRole) => {
        if (role === "both") return "bg-purple-100 text-purple-700";
        if (role === "seller_only") return "bg-blue-100 text-blue-700";
        return "bg-green-100 text-green-700";
    };

    const roleLabel = (role: BuyerRole) => {
        if (role === "both") return "Buyer & Seller";
        if (role === "seller_only") return "Seller Only";
        return "Buyer Only";
    };

    return (
        <div className="p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Marketplace Buyers</h1>
                    <p className="text-slate-600">View and manage marketplace buyers and their profiles</p>
                </div>
                <button
                    onClick={handleExport}
                    disabled={users.length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                >
                    <Download className="w-4 h-4" /> Export CSV
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                    { label: "Total Users", value: stats.total, color: "bg-slate-100 text-slate-700" },
                    { label: "Buyers Only", value: stats.buyerOnly, color: "bg-green-100 text-green-700" },
                    { label: "Sellers Only", value: stats.sellerOnly, color: "bg-blue-100 text-blue-700" },
                    { label: "Buyer & Seller", value: stats.both, color: "bg-purple-100 text-purple-700" },
                ].map(({ label, value, color }) => (
                    <div key={label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
                        <p className="text-xs text-slate-500 mb-1">{label}</p>
                        <p className="text-3xl font-bold text-slate-900">{value.toLocaleString()}</p>
                        <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{label}</span>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl p-5 shadow-sm mb-6 border border-slate-100">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search by name or email..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {([
                            { value: "all", label: "All" },
                            { value: "buyer_only", label: "Buyers" },
                            { value: "seller_only", label: "Sellers" },
                            { value: "both", label: "Both Roles" },
                        ] as { value: FilterTab; label: string }[]).map(({ value, label }) => (
                            <button
                                key={value}
                                onClick={() => updateFilter("roleFilter", value)}
                                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                                    roleFilter === value
                                        ? "bg-blue-600 text-white"
                                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                        <select
                            value={filters.sortOrder || "desc"}
                            onChange={(e) => updateFilter("sortOrder", e.target.value)}
                            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                        >
                            <option value="desc">Newest First</option>
                            <option value="asc">Oldest First</option>
                        </select>
                        <DateRangeFilter
                            value={dateRange}
                            onChange={setDateRange}
                            label="Filter Date"
                        />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-slate-500">Loading users...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <ShoppingCart className="w-14 h-14 text-slate-200 mx-auto mb-3" />
                        <p className="text-slate-500">No marketplace users found</p>
                        {searchQuery || roleFilter !== "all" ? <p className="text-sm text-slate-400 mt-1">Try adjusting your filters</p> : null}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {["User", "Email", "Role", "Status", "Joined", "Actions"].map(h => (
                                        <th key={h} className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filtered.map((user) => (
                                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                                    {(user.name || "?")[0].toUpperCase()}
                                                </div>
                                                <span className="font-semibold text-slate-900 text-sm">{user.name || "Unknown"}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-600">{user.email}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${roleBadge(user.buyerRole)}`}>
                                                {roleLabel(user.buyerRole)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
                                                user.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                                            }`}>{user.status || "active"}</span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-500">
                                            {formatLocalDate(user.createdAt) || "—"}
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => setSelectedUser(user)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 transition"
                                            >
                                                <Eye className="w-3.5 h-3.5" /> View
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination Controls */}
                {filtered.length > 0 && (
                    <div className="flex items-center justify-between mt-0 p-4 border-t border-slate-200">
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
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : "Next Page"}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            {selectedUser && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl max-w-md w-full">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900">User Details</h2>
                            <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 rounded-full bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xl">
                                    {(selectedUser.name || "?")[0].toUpperCase()}
                                </div>
                                <div>
                                    <p className="font-bold text-slate-900 text-lg">{selectedUser.name}</p>
                                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${roleBadge(selectedUser.buyerRole)}`}>
                                        {roleLabel(selectedUser.buyerRole)}
                                    </span>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div><p className="text-xs text-slate-400 mb-0.5">Email</p><p className="font-medium text-slate-800 break-all">{selectedUser.email}</p></div>
                                <div><p className="text-xs text-slate-400 mb-0.5">Phone</p><p className="font-medium text-slate-800">{selectedUser.phone || "—"}</p></div>
                                <div><p className="text-xs text-slate-400 mb-0.5">All Roles</p><p className="font-medium text-slate-800">{selectedUser.roles.join(", ") || "—"}</p></div>
                                <div><p className="text-xs text-slate-400 mb-0.5">Status</p><p className="font-medium capitalize text-slate-800">{selectedUser.status || "active"}</p></div>
                                <div className="col-span-2"><p className="text-xs text-slate-400 mb-0.5">User ID</p><p className="font-mono text-xs text-slate-500 break-all">{selectedUser.id}</p></div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200">
                            <button onClick={() => setSelectedUser(null)} className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
