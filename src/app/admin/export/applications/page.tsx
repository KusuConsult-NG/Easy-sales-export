/**
 * Admin — Export Onboarding Applications
 *
 * Live Firestore listener. Admins can approve, reject, or request revision
 * on export onboarding submissions.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import {
    FileText,
    CheckCircle,
    XCircle,
    Loader2,
    AlertCircle,
    Filter,
    Download,
    RefreshCw,
    Eye,
    Pencil,
    X,
    Save,
    MessageSquare,
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { db } from "@/lib/firebase";
import {
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    Unsubscribe,
} from "firebase/firestore";
import {
    approveExportOnboardingAction,
    rejectExportApplicationAction,
    requestExportApplicationRevisionAction,
    getStandardExportApplicationsAction
} from "@/app/actions/admin";
import RejectionModal from "@/components/admin/RejectionModal";
import { StandardPendingForm } from "@/lib/types/admin";

type AppStatus = "pending_review" | "approved" | "rejected" | "revision_required" | "pending";

interface ExportApplication {
    id: string;
    applicationId?: string;
    userId: string;
    userEmail?: string;
    status: AppStatus;
    createdAt: any;
    updatedAt?: any;
    reviewedAt?: any;
    reviewedBy?: string;
    rejectionReason?: string;
    revisionNote?: string;
    resubmittedAt?: any;
    profile?: {
        fullName?: string;
        phone?: string;
        investmentExperience?: string;
        riskTolerance?: string;
    };
    kyc?: {
        kycData?: {
            firstName?: string;
            lastName?: string;
            phone?: string;
            state?: string;
        };
    };
    bank?: {
        bankName?: string;
        accountNumber?: string;
        accountName?: string;
    };
}

function getDisplayName(app: ExportApplication): string {
    if (app.profile?.fullName) return app.profile.fullName;
    if (app.kyc?.kycData?.firstName) {
        return `${app.kyc.kycData.firstName} ${app.kyc.kycData.lastName || ""}`.trim();
    }
    return app.userEmail || "Unknown Applicant";
}

function statusBadge(status: AppStatus) {
    const map: Record<string, string> = {
        pending_review: "bg-yellow-100 text-yellow-800",
        pending: "bg-yellow-100 text-yellow-800",
        approved: "bg-green-100 text-green-800",
        rejected: "bg-red-100 text-red-800",
        revision_required: "bg-orange-100 text-orange-800",
    };
    return map[status] ?? "bg-slate-100 text-slate-800";
}

function formatDate(ts: any): string {
    if (!ts) return "—";
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(d);
}

export default function AdminExportApplicationsPage() {
    const { showToast } = useToast();
    const [applications, setApplications] = useState<StandardPendingForm<ExportApplication>[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<AppStatus | "all">("pending");
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectingAppId, setRejectingAppId] = useState<string | null>(null);
    const [selectedApp, setSelectedApp] = useState<StandardPendingForm<ExportApplication> | null>(null);

    // Edit/Revision Note modal state
    const [editingApp, setEditingApp] = useState<ExportApplication | null>(null);
    const [revisionNote, setRevisionNote] = useState("");
    const [editSaving, setEditSaving] = useState(false);

    const fetchData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await getStandardExportApplicationsAction(statusFilter);
            if (result.success) {
                setApplications(result.data || []);
            } else {
                setError(result.error || "Failed to load applications.");
            }
        } catch (err) {
            setError("Error fetching applications.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter]);

    const handleApprove = async (app: StandardPendingForm<ExportApplication>) => {
        if (!confirm(`Approve application for ${app.user.name}?`)) return;
        setProcessingId(app.id);
        const appId = app.data.applicationId || app.id;
        const result = await approveExportOnboardingAction(appId);
        if (result.success) {
            showToast("Application approved successfully", "success");
            await fetchData();
        } else {
            showToast(result.error || "Failed to approve", "error");
        }
        setProcessingId(null);
    };

    const handleRejectConfirm = async (reason: string) => {
        if (!rejectingAppId) return;
        const app = applications.find((a) => a.id === rejectingAppId);
        const appId = app?.data.applicationId || rejectingAppId;
        setProcessingId(rejectingAppId);
        const result = await rejectExportApplicationAction(appId, reason);
        if (result.success) {
            showToast("Application rejected", "success");
            await fetchData();
        } else {
            showToast(result.error || "Failed to reject", "error");
        }
        setProcessingId(null);
        setRejectionModalOpen(false);
        setRejectingAppId(null);
    };

    const handleOpenEdit = (app: StandardPendingForm<ExportApplication>) => {
        setEditingApp(app.data);
        setRevisionNote(app.data.revisionNote || "");
    };

    async function handleSaveRevision() {
        if (!editingApp || !revisionNote.trim()) {
            showToast("Please enter a revision note for the applicant.", "error");
            return;
        }
        setEditSaving(true);
        const appId = editingApp.applicationId || editingApp.id;
        const result = await requestExportApplicationRevisionAction(appId, revisionNote.trim());
        if (result.success) {
            showToast("Revision note sent. Application marked for correction.", "success");
            setEditingApp(null);
            setRevisionNote("");
            await fetchData();
        } else {
            showToast(result.error || "Failed to send revision note", "error");
        }
        setEditSaving(false);
    };

    function handleExportCSV() {
        if (!applications.length) return;
        const rows = applications.map((a) => [
            a.user.name,
            a.user.email || "",
            a.status,
            formatDate(a.data.createdAt),
            a.data.bank?.bankName || "",
            a.data.bank?.accountNumber || "",
        ]);
        const header = ["Name", "Email", "Status", "Submitted", "Bank", "Account No"];
        const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `export_applications_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const pendingCount = applications.filter(
        (a) => a.status === "pending_review" || a.status === "pending"
    ).length;
    const resubmittedCount = applications.filter((a) => a.data.resubmittedAt).length;

    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
            {/* Header */}
            <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1">
                        Export Onboarding Applications
                    </h1>
                    <p className="text-sm text-slate-500">
                        Review and action Export Windows onboarding submissions
                    </p>
                </div>
                <button
                    onClick={handleExportCSV}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                    <Download className="w-4 h-4" />
                    Export CSV
                </button>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                {[
                    { label: "Pending Review", value: pendingCount, color: "text-yellow-600" },
                    { label: "Approved", value: applications.filter((a) => a.status === "approved").length, color: "text-green-600" },
                    { label: "Rejected", value: applications.filter((a) => a.status === "rejected").length, color: "text-red-600" },
                    { label: "Resubmitted", value: resubmittedCount, color: "text-orange-600" },
                ].map((s) => (
                    <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4">
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">{s.label}</p>
                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                ))}
            </div>

            {/* Filter Row */}
            <div className="flex items-center gap-3 mb-6 bg-white p-3 rounded-xl border border-slate-200">
                <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                {(["pending_review", "approved", "rejected", "revision_required", "all"] as const).map((f) => (
                    <button
                        key={f}
                        onClick={() => setStatusFilter(f)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition ${statusFilter === f
                            ? "bg-orange-600 text-white"
                            : "text-slate-600 hover:bg-slate-100"
                            }`}
                    >
                        {f === "pending_review" ? "Pending" : f.replace("_", " ")}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {isLoading && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                    </div>
                )}
                {error && (
                    <div className="flex items-center gap-3 p-6 text-red-700 bg-red-50">
                        <AlertCircle className="w-5 h-5 shrink-0" />
                        {error}
                    </div>
                )}
                {!isLoading && !error && applications.length === 0 && (
                    <div className="text-center py-16 text-slate-500">
                        <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                        <p className="font-medium">No applications found</p>
                        <p className="text-sm mt-1">Change the filter to see other statuses</p>
                    </div>
                )}
                {!isLoading && !error && applications.length > 0 && (
                    <table className="w-full">
                        <thead className="border-b border-slate-200 bg-slate-50">
                            <tr>
                                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Applicant</th>
                                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase hidden md:table-cell">Bank</th>
                                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">Submitted</th>
                                <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {applications.map((standardApp) => {
                                const app = standardApp.data;
                                return (
                                <tr key={standardApp.id} className="hover:bg-slate-50 transition">
                                    <td className="px-6 py-4">
                                        <div className="font-semibold text-slate-900 text-sm">{standardApp.user.name}</div>
                                        <div className="text-xs text-slate-500">{standardApp.user.email}</div>
                                        {app.resubmittedAt && (
                                            <div className="flex items-center gap-1 mt-1">
                                                <RefreshCw className="w-3 h-3 text-orange-500" />
                                                <span className="text-xs text-orange-600 font-medium">Resubmitted {formatDate(app.resubmittedAt)}</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 hidden md:table-cell">
                                        <div className="text-sm text-slate-700">{app.bank?.bankName || "—"}</div>
                                        <div className="text-xs text-slate-500">{app.bank?.accountNumber || ""}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${statusBadge(standardApp.status)}`}>
                                            {standardApp.status.replace("_", " ")}
                                        </span>
                                        {app.rejectionReason && (
                                            <p className="text-xs text-slate-500 mt-1 max-w-[200px] truncate" title={app.rejectionReason}>
                                                ↳ {app.rejectionReason}
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 hidden sm:table-cell">
                                        <span className="text-sm text-slate-500">{formatDate(app.createdAt)}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center justify-end gap-2">
                                            {/* Detail */}
                                            <button
                                                onClick={() => setSelectedApp(standardApp)}
                                                className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                                title="View Details"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>

                                            {/* Edit / Request Revision */}
                                            {(standardApp.status === "pending_review" || standardApp.status === "pending" || standardApp.status === "revision_required") && (
                                                <button
                                                    onClick={() => handleOpenEdit(standardApp)}
                                                    disabled={!!processingId}
                                                    className="p-1.5 text-orange-500 hover:bg-orange-50 rounded-lg transition disabled:opacity-50"
                                                    title="Request Correction / Add Note"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                            )}

                                            {/* Approve */}
                                            {(standardApp.status === "pending_review" || standardApp.status === "pending" || standardApp.status === "revision_required") && (
                                                <button
                                                    onClick={() => handleApprove(standardApp)}
                                                    disabled={processingId === standardApp.id}
                                                    className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition disabled:opacity-50"
                                                    title="Approve"
                                                >
                                                    {processingId === standardApp.id ? (
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <CheckCircle className="w-4 h-4" />
                                                    )}
                                                </button>
                                            )}

                                            {/* Reject */}
                                            {(standardApp.status === "pending_review" || standardApp.status === "pending" || standardApp.status === "revision_required") && (
                                                <button
                                                    onClick={() => {
                                                        setRejectingAppId(standardApp.id);
                                                        setRejectionModalOpen(true);
                                                    }}
                                                    disabled={!!processingId}
                                                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                                                    title="Reject"
                                                >
                                                    <XCircle className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Detail Drawer / Modal */}
            {selectedApp && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={() => setSelectedApp(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 overflow-y-auto max-h-[90vh]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-lg font-bold text-slate-900">Application Details</h2>
                            <button onClick={() => setSelectedApp(null)} className="text-slate-400 hover:text-slate-700">✕</button>
                        </div>

                        <div className="space-y-4 text-sm">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-xs text-slate-400 uppercase mb-0.5">Name</p>
                                    <p className="font-medium">{getDisplayName(selectedApp)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 uppercase mb-0.5">Email</p>
                                    <p className="font-medium">{selectedApp.userEmail || "—"}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 uppercase mb-0.5">Status</p>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(selectedApp.status)}`}>
                                        {selectedApp.status.replace("_", " ")}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 uppercase mb-0.5">Submitted</p>
                                    <p className="font-medium">{formatDate(selectedApp.createdAt)}</p>
                                </div>
                            </div>

                            {selectedApp.profile && (
                                <div className="bg-slate-50 rounded-xl p-4">
                                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Investment Profile</p>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div><span className="text-slate-400">Experience:</span> {selectedApp.profile.investmentExperience || "—"}</div>
                                        <div><span className="text-slate-400">Risk:</span> {selectedApp.profile.riskTolerance || "—"}</div>
                                    </div>
                                </div>
                            )}

                            {selectedApp.bank && (
                                <div className="bg-slate-50 rounded-xl p-4">
                                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Bank Account</p>
                                    <div className="space-y-1 text-xs">
                                        <div><span className="text-slate-400">Bank:</span> {selectedApp.bank.bankName}</div>
                                        <div><span className="text-slate-400">Account:</span> {selectedApp.bank.accountNumber}</div>
                                        <div><span className="text-slate-400">Name:</span> {selectedApp.bank.accountName}</div>
                                    </div>
                                </div>
                            )}

                            {selectedApp.rejectionReason && (
                                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                                    <p className="text-xs font-semibold text-red-500 uppercase mb-1">Rejection Reason</p>
                                    <p className="text-red-700">{selectedApp.rejectionReason}</p>
                                </div>
                            )}

                            {selectedApp.resubmittedAt && (
                                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex items-center gap-2">
                                    <RefreshCw className="w-4 h-4 text-orange-500 shrink-0" />
                                    <p className="text-orange-700 text-xs">Resubmitted on {formatDate(selectedApp.resubmittedAt)}</p>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 mt-6">
                            {(selectedApp.status === "pending_review" || selectedApp.status === "pending" || selectedApp.status === "revision_required") && (
                                <>
                                    <button
                                        onClick={() => { handleApprove(selectedApp); setSelectedApp(null); }}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-sm transition"
                                    >
                                        <CheckCircle className="w-4 h-4" />
                                        Approve
                                    </button>
                                    <button
                                        onClick={() => { setRejectingAppId(selectedApp.id); setRejectionModalOpen(true); setSelectedApp(null); }}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold text-sm transition"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        Reject
                                    </button>
                                </>
                            )}
                            <button
                                onClick={() => setSelectedApp(null)}
                                className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <RejectionModal
                isOpen={rejectionModalOpen}
                onClose={() => { setRejectionModalOpen(false); setRejectingAppId(null); }}
                onConfirm={handleRejectConfirm}
                title="Reject Export Application"
                isProcessing={!!processingId}
            />

            {/* Edit / Revision Note Modal */}
            {editingApp && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={() => setEditingApp(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Request Correction</h2>
                                <p className="text-xs text-slate-500 mt-0.5">{getDisplayName(editingApp)}</p>
                            </div>
                            <button onClick={() => setEditingApp(null)} className="text-slate-400 hover:text-slate-700">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 flex gap-2">
                            <MessageSquare className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-orange-700">This note will mark the application as <strong>Revision Required</strong> and notify the applicant of what needs to be corrected.</p>
                        </div>

                        <div className="mb-4">
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                Correction Note for Applicant <span className="text-red-500">*</span>
                            </label>
                            <textarea
                                rows={5}
                                value={revisionNote}
                                onChange={(e) => setRevisionNote(e.target.value)}
                                placeholder="Describe what the applicant needs to correct or provide. E.g., 'Please provide a valid NIN number. The one submitted does not match your profile.'"
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400 resize-none"
                            />
                            <p className="text-xs text-slate-400 mt-1">{revisionNote.length}/500 characters</p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleSaveRevision}
                                disabled={editSaving || !revisionNote.trim()}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50"
                            >
                                {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Send Revision Request
                            </button>
                            <button
                                onClick={() => setEditingApp(null)}
                                className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
