"use client";

import { useState, useEffect, useMemo } from "react";
import {
    FileText, CheckCircle, XCircle, Loader2, AlertCircle, Filter,
    Search, Eye, BookOpen, GraduationCap, DollarSign, Users
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import {
    approveAcademyApplicationAction,
    rejectAcademyApplicationAction,
    markAcademyApplicationUnderReviewAction
} from "@/app/actions/admin";
import { db } from "@/lib/firebase";
import { collection, query, limit, where, getDocs } from "firebase/firestore";
import EnrollStudentModal from "@/components/admin/EnrollStudentModal";
import { getStandardAcademyApplicationsAction } from "@/app/actions/academy-admin";
import { useAdminData } from "@/hooks/useAdminData";

// ─── Types ──────────────────────────────────────────────────────────────────
type ApplicationStatus = "pending" | "under_review" | "approved" | "rejected";

interface AcademyApplication {
    id: string;
    personalInfo: {
        fullName: string; // always derived — never stored raw from new submissions
        firstName?: string;
        lastName?: string;
        otherName?: string;
        email: string;
        phone: string;
    };
    education?: {
        educationLevel?: string;
        fieldOfStudy?: string;
    };
    status: ApplicationStatus;
    submittedAt: string | null;
    reviewedAt?: string | null;
    rejectionReason?: string;
    paymentStatus?: string;
    paymentAmount?: number;
    plan?: string;
    paymentReference?: string | null;
    source?: string;
    // true = has a formal academy_applications doc (can be reviewed/approved)
    hasApplicationDoc?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toIso(ts: any): string | null {
    if (!ts) return null;
    if (ts?.toDate) return ts.toDate().toISOString();
    if (typeof ts === "string") return ts;
    return null;
}

function fmtDate(iso: string | null | undefined) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("en-NG", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit"
    }).format(new Date(iso));
}

function planBadge(plan: string | undefined) {
    if (!plan) return null;
    const colors: Record<string, string> = {
        elite: "bg-purple-100 text-purple-700",
        advanced: "bg-blue-100 text-blue-700",
        foundation: "bg-green-100 text-green-700",
    };
    const label = plan.charAt(0).toUpperCase() + plan.slice(1);
    return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${colors[plan] ?? "bg-slate-100 text-slate-600"}`}>
            {label}
        </span>
    );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AdminAcademyApplicationsPage() {
    const { showToast } = useToast();
    const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
    const [paymentFilter, setPaymentFilter] = useState<"all" | "completed" | "pending">("all");
    const [search, setSearch] = useState("");
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);

    const {
        data: applications,
        loading: isLoading,
        hasMore,
        refresh: fetchData,
        onNextPage,
        onPrevPage,
        pageIndex
    } = useAdminData<AcademyApplication>({
        fetchAction: async (opts) => {
            try {
                // Pass dependencies gracefully
                const result = await getStandardAcademyApplicationsAction({
                    limit: opts.limit || 50,
                    lastDocId: opts.lastDocId,
                    search: search.trim() ? search : undefined,
                    status: statusFilter === "all" ? undefined : statusFilter
                });

                if (!result.success) {
                    showToast(result.error || "Failed to load applications", "error");
                    return { success: false, data: [], meta: { hasMore: false }, error: result.error };
                }

                const apps = (result.data ?? []).map((stdApp: any) => {
                    const d = stdApp.data;
                    const pi = d.personalInfo || {};
                    return {
                        id: stdApp.id,
                        personalInfo: {
                            fullName: stdApp.user.name,
                            firstName: pi.firstName,
                            lastName: pi.lastName,
                            otherName: pi.otherName,
                            email: stdApp.user.email,
                            phone: pi.phone ?? d.phone ?? stdApp.user.phone ?? "",
                        },
                        education: d.education,
                        status: stdApp.status,
                        submittedAt: toIso(d.submittedAt || d.createdAt),
                        rejectionReason: d.rejectionReason,
                        paymentStatus: d.paymentStatus,
                        paymentAmount: d.paymentAmount ? Number(d.paymentAmount) : undefined,
                        plan: d.plan,
                        paymentReference: d.paymentReference,
                        source: d.source,
                        hasApplicationDoc: true,
                    } as AcademyApplication;
                });

                return {
                    success: true,
                    data: apps,
                    meta: {
                        lastDocId: result.lastDocId,
                        hasMore: result.hasMore
                    }
                };
            } catch (err: any) {
                return { success: false, data: [], meta: { hasMore: false }, error: err.message };
            }
        },
        limit: 50,
        dependencies: [statusFilter, search]
    });

    async function handleApprove(id: string) {
        setProcessingId(id);
        const result = await approveAcademyApplicationAction(id);
        if (result.success) {
            showToast("Application approved", "success");
            await fetchData();
        } else {
            showToast(result.error || "Failed to approve", "error");
        }
        setProcessingId(null);
    };

    async function handleReject(id: string) {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;
        setProcessingId(id);
        const result = await rejectAcademyApplicationAction(id, reason);
        if (result.success) {
            showToast("Application rejected", "success");
            await fetchData();
        } else {
            showToast(result.error || "Failed to reject", "error");
        }
        setProcessingId(null);
    };

    async function handleMarkUnderReview(id: string) {
        setProcessingId(id + "_review");
        const result = await markAcademyApplicationUnderReviewAction(id);
        if (result.success) {
            showToast("Application marked under review", "success");
            await fetchData();
        } else {
            showToast(result.error || "Failed to mark under review", "error");
        }
        setProcessingId(null);
    };

    const statusColor = (s: ApplicationStatus) => ({
        approved: "bg-green-100 text-green-700",
        rejected: "bg-red-100 text-red-700",
        under_review: "bg-blue-100 text-blue-700",
        pending: "bg-yellow-100 text-yellow-700",
    }[s] ?? "bg-slate-100 text-slate-600");

    const filtered = applications
        .filter(a => {
            if (paymentFilter === "all") return true;
            if (paymentFilter === "completed") return a.paymentStatus === "completed" || a.paymentStatus === "paid";
            return a.paymentStatus !== "completed" && a.paymentStatus !== "paid";
        });

    // Counts per status for tab badges
    const counts = { pending: 0, under_review: 0, approved: 0, rejected: 0 };
    applications.forEach(a => { counts[a.status] = (counts[a.status] ?? 0) + 1; });

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            {/* Header */}
            <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-1">Academy Applications</h1>
                    <p className="text-slate-600">Live — {applications.length} total applications</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={() => setIsEnrollModalOpen(true)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition shadow-sm border border-blue-500"
                    >
                        + Add Student
                    </button>
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-sm font-semibold text-green-700">Live</span>
                    </div>
                </div>
            </div>

            {/* Summary Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {(["pending", "under_review", "approved", "rejected"] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                        className={`rounded-xl p-4 text-left transition border ${
                            statusFilter === s ? "ring-2 ring-blue-500" : ""
                        } ${statusColor(s)} bg-white border-slate-200`}
                    >
                        <p className="text-2xl font-bold">{counts[s]}</p>
                        <p className="text-xs font-semibold capitalize">{s.replace("_", " ")}</p>
                    </button>
                ))}
            </div>

            {/* Filter + Search */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-500" />
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as ApplicationStatus | "all")}
                        className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm"
                    >
                        <option value="all">All Applications</option>
                        <option value="pending">Pending</option>
                        <option value="under_review">Under Review</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                    </select>
                </div>
                
                <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-slate-500" />
                    <select
                        value={paymentFilter}
                        onChange={e => setPaymentFilter(e.target.value as any)}
                        className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm"
                    >
                        <option value="all">Any Payment Status</option>
                        <option value="completed">Paid</option>
                        <option value="pending">Unpaid</option>
                    </select>
                </div>
                <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="Search by name, email, phone, plan…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                <span className="text-sm text-slate-500">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            </div>

            {/* Loading */}
            {isLoading && applications.length === 0 && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            )}

            {/* Applications */}
            {!isLoading && applications.length > 0 && (
                <div className="space-y-4">
                    {filtered.map(app => (
                        <div key={app.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
                            <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                                        <GraduationCap className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="text-lg font-bold text-slate-900">{app.personalInfo.fullName}</h3>
                                            {planBadge(app.plan)}
                                        </div>
                                        <p className="text-sm text-slate-500">{app.personalInfo.email} {app.personalInfo.phone ? `• ${app.personalInfo.phone}` : ""}</p>
                                        {app.education?.educationLevel && (
                                            <p className="text-sm text-slate-600 mt-0.5">
                                                Education: <span className="font-semibold">{app.education.educationLevel}</span>
                                                {app.education.fieldOfStudy ? ` — ${app.education.fieldOfStudy}` : ""}
                                            </p>
                                        )}
                                        {app.paymentAmount != null && (
                                            <div className="flex items-center gap-1 mt-1 text-sm text-green-700 font-semibold">
                                                <DollarSign className="w-3.5 h-3.5" />
                                                ₦{app.paymentAmount.toLocaleString()} paid
                                                {app.paymentReference && (
                                                    <span className="text-slate-400 font-normal ml-1">· Ref: {app.paymentReference}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${statusColor(app.status)}`}>
                                    {app.status.replace("_", " ")}
                                </span>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-slate-200 flex-wrap gap-3">
                                <p className="text-xs text-slate-500">Submitted: {fmtDate(app.submittedAt)}</p>

                                {app.status === "pending" && (
                                    <div className="flex gap-2 flex-wrap">
                                        <button
                                            onClick={() => handleReject(app.id)}
                                            disabled={!!processingId}
                                            className="px-4 py-2 rounded-lg border border-red-300 text-red-700 font-semibold hover:bg-red-50 transition disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {processingId === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                            Reject
                                        </button>
                                        <button
                                            onClick={() => handleMarkUnderReview(app.id)}
                                            disabled={!!processingId}
                                            className="px-4 py-2 rounded-lg border border-amber-400 text-amber-700 font-semibold hover:bg-amber-50 transition disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {processingId === app.id + "_review" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                                            Under Review
                                        </button>
                                        <button
                                            onClick={() => handleApprove(app.id)}
                                            disabled={!!processingId}
                                            className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {processingId === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                            Approve
                                        </button>
                                    </div>
                                )}
                                {app.status === "under_review" && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleReject(app.id)}
                                            disabled={!!processingId}
                                            className="px-4 py-2 rounded-lg border border-red-300 text-red-700 font-semibold hover:bg-red-50 transition disabled:opacity-50 flex items-center gap-2"
                                        >
                                            <XCircle className="w-4 h-4" /> Reject
                                        </button>
                                        <button
                                            onClick={() => handleApprove(app.id)}
                                            disabled={!!processingId}
                                            className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
                                        >
                                            <CheckCircle className="w-4 h-4" /> Approve
                                        </button>
                                    </div>
                                )}
                                {app.status === "rejected" && app.rejectionReason && (
                                    <p className="text-sm text-red-600">Reason: {app.rejectionReason}</p>
                                )}
                            </div>
                        </div>
                    ))}

                    {filtered.length === 0 && (
                        <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-slate-200">
                            <BookOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">No Applications Found</h3>
                            <p className="text-slate-600">
                                {search ? `No results for "${search}"` :
                                 statusFilter !== "all" ? `No ${statusFilter.replace("_"," ")} applications` :
                                 "No academy applications yet"}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Pagination Controls */}
            {!isLoading && applications.length > 0 && (
                <div className="flex items-center justify-between mt-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
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

            {/* Enroll Student Modal */}
            <EnrollStudentModal 
                isOpen={isEnrollModalOpen} 
                onClose={() => setIsEnrollModalOpen(false)} 
            />
        </div>
    );
}
