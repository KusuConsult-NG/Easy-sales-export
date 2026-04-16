"use client";

import { useEffect, useState, useRef } from "react";
import { logger } from "@/lib/logger";
import {
    Users, CheckCircle, Clock, Search,
    Download, Eye, Mail, Phone, MapPin, Loader2
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useAdminData } from "@/hooks/useAdminData";
import { getStandardWaveApplicationsAction } from "@/app/actions/wave-admin";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface WaveMember {
    id: string; // userId
    active: boolean;
    enrolledAt: Date;
    applicationId?: string;
    // From joined wave_applications data (if available)
    fullName?: string;
    surname?: string;
    firstName?: string;
    email?: string;
    phone?: string;
    stateOfResidence?: string;
    lgaOfResidence?: string;
    bankName?: string;
    accountNumber?: string;
    farmSize?: string;
    nin?: string;
    bvn?: string;
}

export default function AdminWaveMembersPage() {
    const { showToast } = useToast();
    const [searchQuery, setSearchQuery] = useState("");

    const {
        data: members,
        loading: isLoading,
        error,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: loadMembers
    } = useAdminData<WaveMember>({
        fetchAction: async (opts) => {
            const result = await getStandardWaveApplicationsAction({
                status: "approved",
                limit: opts.limit || 25,
                search: searchQuery,
                lastDocId: opts.lastDocId
            });
            
            if (!result.success) {
                return { success: false, error: result.error };
            }
            
            const docs: WaveMember[] = (result.data || []).map((item: any) => {
                const data = item.data;
                return {
                    id: item.user.id || item.id,
                    active: true,
                    enrolledAt: data.approvalTimestamp?.toDate?.() || data.reviewedAt?.toDate?.() || data.createdAt?.toDate?.() || new Date(),
                    applicationId: item.id,
                    fullName: data.fullName,
                    surname: data.surname,
                    firstName: data.firstName,
                    email: item.user.email,
                    phone: item.user.phone,
                    stateOfResidence: item.user.state,
                    lgaOfResidence: item.user.lga,
                    bankName: data.bankName,
                    accountNumber: data.accountNumber,
                    farmSize: data.farmSize,
                    nin: data.nin,
                    bvn: data.bvn,
                };
            });
            
            return {
                success: true,
                data: docs as any,
                meta: { ...result.meta, lastDocId: result.lastDocId, hasMore: result.hasMore }
            };
        },
        limit: 25,
        dependencies: [searchQuery]
    });

    const [filtered, setFiltered] = useState<WaveMember[]>([]);
    const [selectedMember, setSelectedMember] = useState<WaveMember | null>(null);
    const [isExporting, setIsExporting] = useState(false);

    // Filter using searchQuery inside useAdminData fetch action natively when search param expands
    useEffect(() => {
        setFiltered(members);
    }, [members]);

    const getDisplayName = (m: WaveMember) => {
        if (m.surname || m.firstName) return `${m.surname || ""} ${m.firstName || ""}`.trim();
        return m.fullName || m.id;
    };

    async function handleExportCSV() {
        setIsExporting(true);
        try {
            // Build CSV from the already-loaded members data (no extra fetch needed)
            const headers = [
                "Full Name", "Email", "Phone", "State", "LGA",
                "Bank Name", "Account Number", "Farm Size",
                "NIN", "BVN", "Enrolled Date", "Application ID"
            ];

            const rows = members.map(m => [
                getDisplayName(m),
                m.email || "",
                m.phone || "",
                m.stateOfResidence || "",
                m.lgaOfResidence || "",
                m.bankName || "",
                m.accountNumber || "",
                m.farmSize || "",
                m.nin || "",
                m.bvn || "",
                m.enrolledAt ? new Date(m.enrolledAt).toLocaleDateString("en-NG") : "",
                m.applicationId || "",
            ]);

            const csvContent = [
                headers.join(","),
                ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
            ].join("\n");

            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `wave_members_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast(`Exported ${members.length} members to CSV`, "success");
        } catch (err) {
            logger.error("CSV export error:", err);
            showToast("Failed to export CSV", "error");
        } finally {
            setIsExporting(false);
        }
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
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900">WAVE Members</h1>
                    <p className="text-slate-600 mt-1">Active WAVE program participants</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Live indicator */}
                    <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-xl shadow-sm">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-xs text-slate-500">Live</span>
                    </div>
                    {/* Stats badge */}
                    <div className="bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-sm">
                        <span className="text-slate-500 block text-xs uppercase font-bold tracking-wider mb-0.5">Total Members</span>
                        <span className="text-xl font-black text-slate-900">{members.length}</span>
                    </div>
                    {/* CSV Export */}
                    <button
                        onClick={handleExportCSV}
                        disabled={isExporting || members.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold transition-all disabled:opacity-50 shadow-sm"
                    >
                        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6">
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

            {/* Members Table */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto mb-4" />
                        <p className="text-slate-600">Loading WAVE members...</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Users className="w-8 h-8 text-slate-300" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-1">
                            {searchQuery ? "No members match your search" : "No WAVE members yet"}
                        </h3>
                        <p className="text-slate-500">
                            {searchQuery ? "Try a different search term" : "Approved applications will appear here automatically"}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {["Name", "Contact", "Location", "Bank", "Farm Size", "Enrolled", "Actions"].map(h => (
                                        <th key={h} className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filtered.map((member) => (
                                    <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                                    <span className="text-sm font-bold text-emerald-700">
                                                        {getDisplayName(member).charAt(0).toUpperCase() || "?"}
                                                    </span>
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-slate-900 text-sm">{getDisplayName(member)}</p>
                                                    <p className="text-xs text-slate-500">{member.id}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <p className="text-sm text-slate-900 flex items-center gap-1">
                                                <Mail className="w-3 h-3 text-slate-400" /> {member.email || "—"}
                                            </p>
                                            <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                <Phone className="w-3 h-3 text-slate-400" /> {member.phone || "—"}
                                            </p>
                                        </td>
                                        <td className="px-5 py-4">
                                            <p className="text-sm text-slate-900 flex items-center gap-1">
                                                <MapPin className="w-3 h-3 text-slate-400" /> {member.stateOfResidence || "—"}
                                            </p>
                                            {member.lgaOfResidence && (
                                                <p className="text-xs text-slate-500 mt-0.5">{member.lgaOfResidence}</p>
                                            )}
                                        </td>
                                        <td className="px-5 py-4 text-sm text-slate-700">
                                            <p>{member.bankName || "—"}</p>
                                            {member.accountNumber && (
                                                <p className="text-xs text-slate-500">****{member.accountNumber.slice(-4)}</p>
                                            )}
                                        </td>
                                        <td className="px-5 py-4 text-sm text-slate-700">
                                            {member.farmSize || "—"}
                                        </td>
                                        <td className="px-5 py-4 text-sm text-slate-600">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle className="w-4 h-4 text-green-500" />
                                                {new Date(member.enrolledAt).toLocaleDateString("en-NG")}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <button
                                                onClick={() => setSelectedMember(member)}
                                                className="inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 font-semibold"
                                            >
                                                <Eye className="w-4 h-4" /> View
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination Controls */}
            {filtered.length > 0 && !isLoading && (
                <div className="flex items-center justify-between mt-8 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
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

            {/* Member Detail Modal */}
            {selectedMember && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold text-slate-900">Member Details</h2>
                                <button onClick={() => setSelectedMember(null)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">✕</button>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            {[
                                { label: "Full Name", value: getDisplayName(selectedMember) },
                                { label: "Email", value: selectedMember.email },
                                { label: "Phone", value: selectedMember.phone },
                                { label: "State", value: selectedMember.stateOfResidence },
                                { label: "LGA", value: selectedMember.lgaOfResidence },
                                { label: "Bank Name", value: selectedMember.bankName },
                                { label: "Account Number", value: selectedMember.accountNumber },
                                { label: "Farm Size", value: selectedMember.farmSize },
                                { label: "NIN", value: selectedMember.nin ? `${selectedMember.nin.slice(0, 4)}****${selectedMember.nin.slice(-4)}` : undefined },
                                { label: "BVN", value: selectedMember.bvn ? `${selectedMember.bvn.slice(0, 4)}****${selectedMember.bvn.slice(-4)}` : undefined },
                                { label: "Enrolled", value: new Date(selectedMember.enrolledAt).toLocaleDateString("en-NG", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) },
                                { label: "Application ID", value: selectedMember.applicationId },
                                { label: "User ID", value: selectedMember.id },
                            ].map(({ label, value }) => value ? (
                                <div key={label} className="flex justify-between items-start py-2 border-b border-slate-50 last:border-0">
                                    <p className="text-sm text-slate-500 shrink-0 w-36">{label}</p>
                                    <p className="text-sm font-semibold text-slate-900 text-right">{value}</p>
                                </div>
                            ) : null)}
                        </div>
                        <div className="p-6 border-t border-slate-200 flex gap-3">
                            <button
                                onClick={() => {
                                    // Export single member CSV
                                    const csvContent = [
                                        "Field,Value",
                                        `Full Name,"${getDisplayName(selectedMember)}"`,
                                        `Email,"${selectedMember.email || ''}"`,
                                        `Phone,"${selectedMember.phone || ''}"`,
                                        `State,"${selectedMember.stateOfResidence || ''}"`,
                                        `LGA,"${selectedMember.lgaOfResidence || ''}"`,
                                        `Bank,"${selectedMember.bankName || ''}"`,
                                        `Account,"${selectedMember.accountNumber || ''}"`,
                                        `Farm Size,"${selectedMember.farmSize || ''}"`,
                                        `Enrolled,"${new Date(selectedMember.enrolledAt).toLocaleDateString('en-NG')}"`,
                                    ].join("\n");
                                    const blob = new Blob([csvContent], { type: "text/csv" });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = `wave_member_${selectedMember.id}.csv`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold transition-all text-sm"
                            >
                                <Download className="w-4 h-4" /> Export Member
                            </button>
                            <button onClick={() => setSelectedMember(null)}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold transition-all text-sm">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
