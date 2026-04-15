"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    AlertTriangle,
    Clock,
    CheckCircle,
    EyeIcon,
    Loader2,
    ArrowUpCircle,
    ArrowLeft,
    Zap,
    UserCheck,
    ChevronDown,
} from "lucide-react";
import { getAdminDisputesAction } from "@/app/actions/disputes";
import { getAdminUsersAction, assignDisputeAction } from "@/app/actions/admin-users";
import type { Dispute } from "@/lib/types/marketplace";
import { useToast } from "@/contexts/ToastContext";

function fmtDate(val: any) {
    if (!val) return "—";
    const d = val?.toDate ? val.toDate() : new Date(val);
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

interface AdminUser {
    id: string;
    name: string;
    email: string;
    role: string;
}

export default function EscalatedDisputesPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [disputes, setDisputes] = useState<Dispute[]>([]);
    const [loading, setLoading] = useState(true);
    const [admins, setAdmins] = useState<AdminUser[]>([]);

    // Per-card state: which card has the dropdown open + currently selected assignee
    const [openDropdown, setOpenDropdown] = useState<string | null>(null);
    const [selectedAssignee, setSelectedAssignee] = useState<Record<string, string>>({});
    const [assigningId, setAssigningId] = useState<string | null>(null);

    async function loadAll() {
        setLoading(true);
        try {
            const [disputeRes, adminRes] = await Promise.all([
                getAdminDisputesAction({ escalated: true }),
                getAdminUsersAction(),
            ]);
            if (disputeRes.success && disputeRes.disputes) setDisputes(disputeRes.disputes);
            if (adminRes.success && adminRes.admins) setAdmins(adminRes.admins);
        } catch {
            showToast("Failed to load data", "error");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleAssign(disputeId: string) {
        const assigneeId = selectedAssignee[disputeId];
        if (!assigneeId) {
            showToast("Please select an admin to assign", "error");
            return;
        }
        const assignee = admins.find(a => a.id === assigneeId);
        if (!assignee) return;

        setAssigningId(disputeId);
        const res = await assignDisputeAction(disputeId, assigneeId, assignee.name);
        setAssigningId(null);
        setOpenDropdown(null);

        if (res.success) {
            showToast(`Dispute assigned to ${assignee.name}`, "success");
            loadAll(); // refresh to show updated assignedAdminName
        } else {
            showToast(res.error || "Assignment failed", "error");
        }
    }

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-6xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8 flex items-start justify-between">
                    <div>
                        <button
                            onClick={() => router.push("/admin/marketplace/disputes")}
                            className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm mb-3 transition"
                        >
                            <ArrowLeft className="w-4 h-4" /> All Disputes
                        </button>
                        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                            <ArrowUpCircle className="w-8 h-8 text-red-600" />
                            Escalated Disputes
                        </h1>
                        <p className="text-slate-500 mt-1">
                            High-priority cases flagged for senior review — assign to an admin for resolution
                        </p>
                    </div>
                    <span className="px-4 py-2 bg-red-100 text-red-800 font-bold rounded-2xl text-sm">
                        {disputes.length} escalated
                    </span>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                    {[
                        { label: "Unassigned", count: disputes.filter(d => !(d as any).assignedAdminId).length, color: "orange" },
                        { label: "Assigned", count: disputes.filter(d => !!(d as any).assignedAdminId).length, color: "blue" },
                        { label: "Resolved", count: disputes.filter(d => d.status === "resolved").length, color: "green" },
                    ].map(({ label, count, color }) => (
                        <div key={label} className={`bg-white border-2 border-${color}-200 rounded-2xl p-5`}>
                            <p className={`text-sm font-semibold text-${color}-700 mb-1`}>{label}</p>
                            <p className={`text-3xl font-bold text-${color}-900`}>{count}</p>
                        </div>
                    ))}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 animate-spin text-red-600" />
                    </div>
                ) : disputes.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
                        <CheckCircle className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">No Escalated Disputes</h3>
                        <p className="text-slate-500">All clear — no disputes currently flagged for escalation.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {disputes.map((dispute) => {
                            const d = dispute as any;
                            const daysOpen = Math.floor(
                                (Date.now() - new Date(dispute.createdAt as any).getTime()) / 86400000
                            );
                            const isUrgent = daysOpen >= 3;
                            const isAssigned = !!d.assignedAdminId;
                            const isDropdownOpen = openDropdown === dispute.id;

                            return (
                                <div
                                    key={dispute.id}
                                    className={`bg-white rounded-2xl border-2 p-6 shadow-sm transition ${isUrgent ? "border-red-300" : isAssigned ? "border-blue-200" : "border-orange-200"
                                        }`}
                                >
                                    <div className="flex items-start justify-between gap-4 mb-4">
                                        <div className="flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                                <AlertTriangle className={`w-5 h-5 ${isUrgent ? "text-red-600" : "text-orange-500"}`} />
                                                <h3 className="text-lg font-bold text-slate-900">
                                                    Dispute #{dispute.id.slice(0, 8).toUpperCase()}
                                                </h3>
                                                <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full capitalize ${dispute.status === "resolved" ? "bg-green-100 text-green-800"
                                                        : dispute.status === "under_review" ? "bg-blue-100 text-blue-800"
                                                            : "bg-yellow-100 text-yellow-800"
                                                    }`}>
                                                    {dispute.status.replace("_", " ")}
                                                </span>
                                                {isUrgent && (
                                                    <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-red-100 text-red-800 flex items-center gap-1">
                                                        <Zap className="w-3 h-3" /> URGENT
                                                    </span>
                                                )}
                                                {isAssigned && (
                                                    <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-blue-100 text-blue-800 flex items-center gap-1">
                                                        <UserCheck className="w-3 h-3" />
                                                        {d.assignedAdminName ?? "Assigned"}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-slate-500">
                                                Opened {daysOpen} day{daysOpen !== 1 ? "s" : ""} ago
                                                {dispute.orderId ? ` • Order: ${dispute.orderId.slice(0, 8)}` : ""}
                                            </p>
                                        </div>
                                    </div>

                                    <p className="text-slate-700 text-sm line-clamp-2 mb-5">
                                        {dispute.description || "No description provided"}
                                    </p>

                                    <div className="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-slate-100">
                                        <div className="flex gap-6 text-sm text-slate-500">
                                            <span><span className="text-slate-400">Buyer:</span> {dispute.buyerId?.slice(0, 8) ?? "—"}</span>
                                            <span><span className="text-slate-400">Seller:</span> {dispute.sellerId?.slice(0, 8) ?? "—"}</span>
                                            <span className="flex items-center gap-1">
                                                <Clock className="w-3.5 h-3.5" /> {fmtDate(dispute.createdAt)}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {/* Assignment dropdown */}
                                            {dispute.status !== "resolved" && admins.length > 0 && (
                                                <div className="relative">
                                                    <button
                                                        onClick={() => setOpenDropdown(isDropdownOpen ? null : dispute.id)}
                                                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition flex items-center gap-1.5"
                                                    >
                                                        <UserCheck className="w-4 h-4" />
                                                        {isAssigned ? "Reassign" : "Assign"}
                                                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`} />
                                                    </button>

                                                    {isDropdownOpen && (
                                                        <div className="absolute right-0 bottom-full mb-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden">
                                                            <div className="p-3 border-b border-slate-100">
                                                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Assign to Admin</p>
                                                            </div>
                                                            <div className="max-h-52 overflow-y-auto">
                                                                {admins.map(admin => (
                                                                    <button
                                                                        key={admin.id}
                                                                        onClick={() => setSelectedAssignee(prev => ({ ...prev, [dispute.id]: admin.id }))}
                                                                        className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 transition flex items-center justify-between gap-2 ${selectedAssignee[dispute.id] === admin.id ? "bg-blue-50" : ""
                                                                            }`}
                                                                    >
                                                                        <div>
                                                                            <p className="text-sm font-semibold text-slate-900">{admin.name}</p>
                                                                            <p className="text-xs text-slate-400">{admin.email}</p>
                                                                        </div>
                                                                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${admin.role === "super_admin" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-600"
                                                                            }`}>
                                                                            {admin.role === "super_admin" ? "Super" : "Admin"}
                                                                        </span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                            <div className="p-3 border-t border-slate-100">
                                                                <button
                                                                    onClick={() => handleAssign(dispute.id)}
                                                                    disabled={!selectedAssignee[dispute.id] || assigningId === dispute.id}
                                                                    className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                                                >
                                                                    {assigningId === dispute.id
                                                                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Assigning...</>
                                                                        : <><UserCheck className="w-4 h-4" /> Confirm Assignment</>
                                                                    }
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <button
                                                onClick={() => router.push(`/admin/marketplace/disputes/${dispute.id}`)}
                                                className="px-4 py-2 bg-slate-800 text-white font-semibold rounded-xl hover:bg-slate-900 transition flex items-center gap-2 text-sm"
                                            >
                                                <EyeIcon className="w-4 h-4" /> Review
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
