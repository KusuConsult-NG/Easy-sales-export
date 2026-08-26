"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Download, Users, Search, Loader2, AlertCircle, Filter, X, RefreshCw, ChevronDown, MapPin, Eye } from "lucide-react";
import DynamicDetailModal from "@/components/admin/DynamicDetailModal";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import { useAdminData } from "@/hooks/useAdminData";
import { getBriefingRegistrationsAction } from "@/app/actions/briefing-admin";
import { recordExport } from "@/lib/record-export";

// ─── Constants ───────────────────────────────────────────────────────────────

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara",
    "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau",
    "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];

const ROLES = [
    { value: "woman_seeking", label: "Woman seeking participation" },
    { value: "investor", label: "Investor" },
    { value: "cooperative", label: "Cooperative member" },
    { value: "farm_owner", label: "Farm owner" },
    { value: "general", label: "General interest" },
];

const STATUSES = [
    { value: "registered", label: "Registered" },
    { value: "attended", label: "Attended" },
    { value: "cancelled", label: "Cancelled" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface BriefingRegistration {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    state: string;
    role: string;
    status: string;
    createdAt: string | Date;
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function BriefingRegistrationsPage() {
    const { showToast } = useToast();
    const [showFilters, setShowFilters] = useState(false);

    const {
        data: registrations,
        loading: isLoading,
        error,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: load,
        meta,
        search,
        setSearch,
        filters,
        updateFilter,
        clearFilter,
    } = useAdminData<BriefingRegistration>({
        fetchAction: async (opts) => {
            const result = await getBriefingRegistrationsAction({
                lastDocId: opts.lastDocId,
                limit: opts.limit || 25,
                state: opts.state,
                role: opts.role,
                status: opts.status,
                search: opts.search,
            });
            return {
                success: result.success,
                data: result.data as any,
                meta: result.meta,
                error: result.error
            };
        },
        limit: 25
    });

    const [isExporting, setIsExporting] = useState(false);
    const [selectedRegistration, setSelectedRegistration] = useState<BriefingRegistration | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

    // Count active filters
    const activeFilterCount = [
        filters.state && filters.state !== "all",
        filters.role && filters.role !== "all",
        filters.status && filters.status !== "all",
    ].filter(Boolean).length;

    // Auto-show filters panel if any filter is active
    useEffect(() => {
        if (activeFilterCount > 0) setShowFilters(true);
    }, [activeFilterCount]);

    // ─── Export ──────────────────────────────────────────────────────────────

    async function handleExportCSV() {
        if (registrations.length === 0) return;
        setIsExporting(true);
        try {
            showToast("Preparing export...", "success");
            const result = await getBriefingRegistrationsAction({
                limit: 5000,
                state: filters.state,
                role: filters.role,
                status: filters.status,
                search: search,
            });
            if (!result.success || !result.data) {
                throw new Error(result.error || "Failed to fetch registrations for export");
            }

            const exportData = result.data;

            const headers = ["Name", "Email", "Phone", "State", "Role", "Status", "Registered Date"];
            const rows = exportData.map(r => [
                r.fullName || "",
                r.email || "",
                r.phoneNumber || "",
                r.state || "",
                r.role || "",
                r.status || "",
                r.createdAt ? new Date(r.createdAt).toLocaleDateString("en-NG") : "",
            ]);

            const csvContent = [
                headers.join(","),
                ...rows.map((row: any[]) => row.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))
            ].join("\n");

            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;

            // Include active filter names in filename
            const filterParts = [
                filters.state && filters.state !== "all" ? filters.state : "",
                filters.role && filters.role !== "all" ? filters.role : "",
                filters.status && filters.status !== "all" ? filters.status : "",
            ].filter(Boolean).join("_");
            const suffix = filterParts ? `_${filterParts}` : "";
            a.download = `wave_briefing_registrations${suffix}_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            // #309 The download is recorded. Fourteen admin screens built a CSV
            // and two of them left a trace; several of these carry BVN, NIN and
            // bank details. recordExport never throws and never blocks.
            recordExport("wave_registrations");

            showToast(`Exported ${exportData.length} registrations to CSV`, "success");
        } catch (err) {
            console.error("CSV export error:", err);
            showToast("Failed to export CSV", "error");
        } finally {
            setIsExporting(false);
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    const statusColor = (status: string) => {
        if (status === "attended") return "bg-green-100 text-green-700";
        if (status === "cancelled") return "bg-red-100 text-red-700";
        return "bg-blue-100 text-blue-700";
    };

    const roleLabelMap: Record<string, string> = {};
    ROLES.forEach(r => { roleLabelMap[r.value] = r.label; });

    function clearAllFilters() {
        clearFilter("state");
        clearFilter("role");
        clearFilter("status");
    }

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <Link
                        href="/admin/wave"
                        className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors mb-2 text-sm font-medium"
                    >
                        <ArrowLeft className="w-4 h-4" /> Back to WAVE Dashboard
                    </Link>
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Briefing Registrations</h1>
                    <p className="text-slate-600 mt-1">Manage guest list for the National Awareness Briefing</p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-sm">
                        <span className="text-slate-500 block text-xs uppercase font-bold tracking-wider mb-0.5">
                            {activeFilterCount > 0 ? "Filtered" : "Total"} Registrants
                        </span>
                        <span className="text-xl font-black text-slate-900">{(meta as any)?.totalCount ?? registrations.length}</span>
                    </div>
                    {/* Temporarily removed Export CSV button */}
                    {/* <button
                        onClick={handleExportCSV}
                        disabled={isExporting || registrations.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold transition-all disabled:opacity-50 shadow-sm"
                    >
                        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        Export CSV
                    </button> */}
                </div>
            </div>

            {/* ─── Search + Filter Toggle Bar ───────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
                <div className="flex flex-col sm:flex-row gap-3">
                    {/* Search Input */}
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            id="registrations-search"
                            type="text"
                            placeholder="Search by name, email, or phone..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                        />
                    </div>
                    {/* Filter Toggle */}
                    <button
                        id="toggle-filters-btn"
                        onClick={() => setShowFilters(!showFilters)}
                        className={`inline-flex items-center gap-2 px-4 py-3 rounded-xl border font-semibold text-sm transition-all ${
                            activeFilterCount > 0
                                ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                    >
                        <Filter className="w-4 h-4" />
                        Filters
                        {activeFilterCount > 0 && (
                            <span className="ml-1 w-5 h-5 rounded-full bg-emerald-700 text-white text-xs font-bold flex items-center justify-center">
                                {activeFilterCount}
                            </span>
                        )}
                    </button>
                    {/* Refresh */}
                    <button
                        onClick={() => load()}
                        className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 font-semibold text-sm transition-all"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* ─── Filter Panel (Collapsible) ──────────────────────────────── */}
            {showFilters && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-emerald-700" />
                            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Filter Registrations</h3>
                        </div>
                        {activeFilterCount > 0 && (
                            <button
                                onClick={clearAllFilters}
                                className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1 transition-colors"
                            >
                                <X className="w-3 h-3" /> Clear All Filters
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* State Filter */}
                        <div>
                            <label htmlFor="filter-state" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                State
                            </label>
                            <div className="relative">
                                <select
                                    id="filter-state"
                                    value={filters.state || "all"}
                                    onChange={(e) => updateFilter("state", e.target.value)}
                                    className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 pr-10 text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent cursor-pointer transition-all"
                                >
                                    <option value="all">All States</option>
                                    {NIGERIAN_STATES.map(state => (
                                        <option key={state} value={state}>{state}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Role Filter */}
                        <div>
                            <label htmlFor="filter-role" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                Role
                            </label>
                            <div className="relative">
                                <select
                                    id="filter-role"
                                    value={filters.role || "all"}
                                    onChange={(e) => updateFilter("role", e.target.value)}
                                    className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 pr-10 text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent cursor-pointer transition-all"
                                >
                                    <option value="all">All Roles</option>
                                    {ROLES.map(role => (
                                        <option key={role.value} value={role.value}>{role.label}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Status Filter */}
                        <div>
                            <label htmlFor="filter-status" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                                Status
                            </label>
                            <div className="relative">
                                <select
                                    id="filter-status"
                                    value={filters.status || "all"}
                                    onChange={(e) => updateFilter("status", e.target.value)}
                                    className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 pr-10 text-sm text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent cursor-pointer transition-all"
                                >
                                    <option value="all">All Statuses</option>
                                    {STATUSES.map(s => (
                                        <option key={s.value} value={s.value}>{s.label}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                    </div>

                    {/* Active Filter Pills */}
                    {activeFilterCount > 0 && (
                        <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-100">
                            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active:</span>
                            {filters.state && filters.state !== "all" && (
                                <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 pl-3 pr-1.5 py-1 rounded-full text-xs font-semibold">
                                    <MapPin className="w-3 h-3" /> {filters.state}
                                    <button
                                        onClick={() => clearFilter("state")}
                                        className="w-4 h-4 rounded-full bg-emerald-200 hover:bg-emerald-300 flex items-center justify-center transition-colors"
                                    >
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                </span>
                            )}
                            {filters.role && filters.role !== "all" && (
                                <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-800 border border-blue-200 pl-3 pr-1.5 py-1 rounded-full text-xs font-semibold">
                                    {roleLabelMap[filters.role] || filters.role}
                                    <button
                                        onClick={() => clearFilter("role")}
                                        className="w-4 h-4 rounded-full bg-blue-200 hover:bg-blue-300 flex items-center justify-center transition-colors"
                                    >
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                </span>
                            )}
                            {filters.status && filters.status !== "all" && (
                                <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-800 border border-amber-200 pl-3 pr-1.5 py-1 rounded-full text-xs font-semibold capitalize">
                                    {filters.status}
                                    <button
                                        onClick={() => clearFilter("status")}
                                        className="w-4 h-4 rounded-full bg-amber-200 hover:bg-amber-300 flex items-center justify-center transition-colors"
                                    >
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ─── Content Table ────────────────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                {isLoading && (
                    <div className="p-12 text-center">
                        <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto mb-4" />
                        <p className="text-slate-600">Loading registrations...</p>
                    </div>
                )}

                {error && !isLoading && (
                    <div className="p-8">
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-semibold text-red-900">Error Loading Registrations</p>
                                <p className="text-sm text-red-700 mt-1">{error}</p>
                                <button
                                    onClick={() => load()}
                                    className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition"
                                >
                                    Retry
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {!isLoading && !error && registrations.length === 0 && (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Users className="w-8 h-8 text-slate-300" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-1">
                            {search || activeFilterCount > 0 ? "No results found" : "No registrations yet"}
                        </h3>
                        <p className="text-slate-500">
                            {search || activeFilterCount > 0
                                ? "Try adjusting your search or filters"
                                : "Wait for users to sign up via the landing page."}
                        </p>
                        {activeFilterCount > 0 && (
                            <button
                                onClick={clearAllFilters}
                                className="mt-4 px-4 py-2 text-sm font-semibold text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition"
                            >
                                Clear All Filters
                            </button>
                        )}
                    </div>
                )}

                {!isLoading && !error && registrations.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {["Name", "Email", "Phone", "State", "Role", "Status", "Registered", "Actions"].map(h => (
                                        <th key={h} className="px-5 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {registrations.map((reg) => (
                                    <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-5 py-4 font-medium text-slate-900">{reg.fullName}</td>
                                        <td className="px-5 py-4 text-slate-500 text-sm">{reg.email}</td>
                                        <td className="px-5 py-4 text-slate-700 text-sm">{reg.phoneNumber}</td>
                                        <td className="px-5 py-4 text-slate-700 text-sm">
                                            <span className="inline-flex items-center gap-1">
                                                <MapPin className="w-3 h-3 text-slate-400" />
                                                {reg.state}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className="capitalize bg-slate-100 px-2 py-1 rounded-md text-slate-600 text-xs font-semibold">
                                                {roleLabelMap[reg.role] || reg.role}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${statusColor(reg.status)}`}>
                                                {reg.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-slate-500 text-sm">
                                            {reg.createdAt ? new Date(reg.createdAt).toLocaleDateString("en-NG") : "—"}
                                        </td>
                                        <td className="px-5 py-4 text-sm">
                                            <button 
                                                onClick={() => { setSelectedRegistration(reg); setIsDetailModalOpen(true); }}
                                                className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-900 transition-colors"
                                                title="View Full Details"
                                            >
                                                <Eye className="w-5 h-5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination Controls */}
                {registrations.length > 0 && !isLoading && !error && (
                    <div className="flex items-center justify-between mt-8 p-4 bg-white border-t border-slate-200">
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

            {/* Dynamic Detail Modal */}
            {selectedRegistration && (
                <DynamicDetailModal
                    isOpen={isDetailModalOpen}
                    onClose={() => { setIsDetailModalOpen(false); setSelectedRegistration(null); }}
                    title={`Briefing Registration: ${selectedRegistration.fullName}`}
                    data={selectedRegistration}
                />
            )}
        </div>
    );
}
