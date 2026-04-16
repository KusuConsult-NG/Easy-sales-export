"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Download, Users, Search, Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import { useAdminData } from "@/hooks/useAdminData";
import { getBriefingRegistrationsAction } from "@/app/actions/briefing-admin";

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

export default function BriefingRegistrationsPage() {
    const { showToast } = useToast();
    const [searchQuery, setSearchQuery] = useState("");

    const {
        data: registrations,
        loading: isLoading,
        error,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: load
    } = useAdminData<BriefingRegistration>({
        fetchAction: async (opts) => {
            const result = await getBriefingRegistrationsAction(opts.lastDocId, opts.limit || 25);
            return {
                success: result.success,
                data: result.data as any,
                meta: result.meta,
                error: result.error
            };
        },
        limit: 25
    });

    const [filtered, setFiltered] = useState<BriefingRegistration[]>([]);
    const [isExporting, setIsExporting] = useState(false);

    // Local search filter
    useEffect(() => {
        if (!searchQuery.trim()) {
            setFiltered(registrations);
            return;
        }
        const q = searchQuery.toLowerCase();
        setFiltered(registrations.filter(r =>
            r.fullName?.toLowerCase().includes(q) ||
            r.email?.toLowerCase().includes(q) ||
            r.phoneNumber?.toLowerCase().includes(q) ||
            r.state?.toLowerCase().includes(q)
        ));
    }, [registrations, searchQuery]);

    function handleExportCSV() {
        if (registrations.length === 0) return;
        setIsExporting(true);
        try {
            const headers = ["Name", "Email", "Phone", "State", "Role", "Status", "Registered Date"];
            const rows = registrations.map(r => [
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
                ...rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
            ].join("\n");

            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `wave_briefing_registrations_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast(`Exported ${registrations.length} registrations to CSV`, "success");
        } catch (err) {
            console.error("CSV export error:", err);
            showToast("Failed to export CSV", "error");
        } finally {
            setIsExporting(false);
        }
    };

    const statusColor = (status: string) => {
        if (status === "attended") return "bg-green-100 text-green-700";
        if (status === "cancelled") return "bg-red-100 text-red-700";
        return "bg-blue-100 text-blue-700";
    };

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
                        <span className="text-slate-500 block text-xs uppercase font-bold tracking-wider mb-0.5">Total Registrants</span>
                        <span className="text-xl font-black text-slate-900">{registrations.length}</span>
                    </div>
                    <button
                        onClick={handleExportCSV}
                        disabled={isExporting || registrations.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold transition-all disabled:opacity-50 shadow-sm"
                    >
                        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by name, email, phone, or state..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                </div>
            </div>

            {/* Content */}
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

                {!isLoading && !error && filtered.length === 0 && (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Users className="w-8 h-8 text-slate-300" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-1">
                            {searchQuery ? "No results found" : "No registrations yet"}
                        </h3>
                        <p className="text-slate-500">
                            {searchQuery ? "Try a different search term" : "Wait for users to sign up via the landing page."}
                        </p>
                    </div>
                )}

                {!isLoading && !error && filtered.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {["Name", "Email", "Phone", "State", "Role", "Status", "Registered"].map(h => (
                                        <th key={h} className="px-5 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filtered.map((reg) => (
                                    <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-5 py-4 font-medium text-slate-900">{reg.fullName}</td>
                                        <td className="px-5 py-4 text-slate-500 text-sm">{reg.email}</td>
                                        <td className="px-5 py-4 text-slate-700 text-sm">{reg.phoneNumber}</td>
                                        <td className="px-5 py-4 text-slate-700 text-sm">{reg.state}</td>
                                        <td className="px-5 py-4">
                                            <span className="capitalize bg-slate-100 px-2 py-1 rounded-md text-slate-600 text-xs font-semibold">
                                                {reg.role}
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
        </div>
    );
}
