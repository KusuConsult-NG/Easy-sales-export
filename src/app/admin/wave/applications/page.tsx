"use client";

import { useState, useEffect, useRef } from "react";
import { FileText, CheckCircle, XCircle, Loader2, AlertCircle, Filter, Download, Pencil, X, Save, RefreshCw } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { db } from "@/lib/firebase";
import { approveWaveApplicationAction, rejectWaveApplicationAction, getStandardWaveApplicationsAction } from "@/app/actions/wave-admin";
import { editApplicationAction } from "@/app/actions/admin";
import RejectionModal from "@/components/admin/RejectionModal";
import { StandardPendingForm } from "@/lib/types/admin";
import { useAdminData } from "@/hooks/useAdminData";
import { formatDate } from "@/lib/utils";
import DateRangeFilter, { type DateRange } from "@/components/admin/DateRangeFilter";

type ApplicationStatus = "pending" | "under_review" | "approved" | "rejected";


interface WaveApplication {
    id: string;
    surname?: string;
    firstName?: string;
    otherNames?: string;
    phone?: string;
    email?: string;
    userEmail?: string;
    stateOfResidence?: string;
    lgaOfResidence?: string;
    nin?: string;
    votersCardNumber?: string;
    bvn?: string;
    bankName?: string;
    accountNumber?: string;
    fullName?: string;
    farmSize?: string;
    status: ApplicationStatus;
    createdAt: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    approvedBy?: string;
    approvalTimestamp?: Date;
    rejectionReason?: string;
}

function getDisplayName(app: WaveApplication): string {
    if (app.surname || app.firstName) {
        return `${app.surname || ''} ${app.firstName || ''}`.trim();
    }
    return app.fullName || 'Unknown Applicant';
}

export default function AdminWaveApplicationsPage() {
    const { showToast } = useToast();
    const [dateRange, setDateRange] = useState<DateRange>({ from: "", to: "" });
    const {
        data: applications,
        loading: isLoading,
        error,
        search,
        setSearch,
        filters,
        updateFilter,
        hasMore,
        setData: setApplications,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: fetchData,
        meta
    } = useAdminData<StandardPendingForm<WaveApplication>>({
        fetchAction: async (opts) => getStandardWaveApplicationsAction({
            ...opts,
            status: opts.status as any,
            sortOrder: opts.sortOrder as any,
            dateFrom: dateRange.from || undefined,
            dateTo: dateRange.to || undefined,
        }),
        limit: 50,
        dependencies: [dateRange]
    });

    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectingAppId, setRejectingAppId] = useState<string | null>(null);

    // Edit modal state
    const [editingApp, setEditingApp] = useState<WaveApplication | null>(null);
    const [editDraft, setEditDraft] = useState<Record<string, string>>({});
    const [editNote, setEditNote] = useState("");
    const [editSaving, setEditSaving] = useState(false);

    const statusFilter = (filters.status as ApplicationStatus | "all") || "pending";

    // Set initial filter to pending if not set
    useEffect(() => {
        if (!filters.status) {
            updateFilter("status", "pending");
        }
    }, [filters.status, updateFilter]);

    async function handleApprove(applicationId: string) {
        setProcessingId(applicationId);
        const result = await approveWaveApplicationAction(applicationId);

        if (result.success) {
            showToast("Application approved successfully", "success");
            await fetchData();
        } else {
            showToast(result.error || "Failed to approve application", "error");
        }

        setProcessingId(null);
    };

    function handleReject(applicationId: string) {
        setRejectingAppId(applicationId);
        setRejectionModalOpen(true);
    };

    async function handleConfirmReject(reason: string) {
        if (!rejectingAppId) return;
        setProcessingId(rejectingAppId);
        setRejectionModalOpen(false);

        const result = await rejectWaveApplicationAction(rejectingAppId, reason);
        if (result.success) {
            showToast("Application rejected successfully", "success");
            await fetchData();
        } else {
            showToast(result.error || "Failed to reject application", "error");
        }
        setProcessingId(null);
        setRejectingAppId(null);
    };

    function handleOpenEdit(app: StandardPendingForm<WaveApplication>) {
        setEditingApp(app.data);
        setEditDraft({
            surname: app.data.surname || "",
            firstName: app.data.firstName || "",
            otherNames: app.data.otherNames || "",
            phone: app.data.phone || "",
        });
        setEditNote("");
    };

    async function handleSaveEdit() {
        if (!editingApp) return;
        setEditSaving(true);
        const result = await editApplicationAction({
            collection: "wave_applications",
            docId: editingApp.id,
            fields: editDraft as any,
            editNote: editNote || undefined,
        });
        if (result.success) {
            showToast("Application updated with audit trail.", "success");
            setEditingApp(null);
            await fetchData();
        } else {
            showToast(result.error || "Failed to update application", "error");
        }
        setEditSaving(false);
    };

    async function handleExportCSV() {
        if (applications.length === 0) return;
        
        try {
            showToast("Preparing export...", "success");
            
            // Fetch all applications matching the current filters (high limit for export)
            const result = await getStandardWaveApplicationsAction({
                limit: 5000,
                status: filters.status,
                search: search
            });

            if (!result.success || !result.data) {
                throw new Error(result.error || "Failed to fetch data for export");
            }

            const exportData = result.data;

            const headers = [
                "Application ID", "Surname", "First Name", "Email", "Phone",
                "State", "LGA", "NIN", "BVN", "Voter Card",
                "Bank Name", "Account Number", "Status", "Applied Date"
            ];
            const rows = exportData.map((app: any) => [
                app.id, app.data.surname || "", app.data.firstName || "",
                app.user.email || "", app.data.phone || "",
                app.data.stateOfResidence || "", app.data.lgaOfResidence || "",
                app.data.nin || "", app.data.bvn || "", app.data.votersCardNumber || "",
                app.data.bankName || "", app.data.accountNumber || "",
                app.status, new Date(app.data.createdAt).toLocaleDateString("en-NG")
            ]);
            const csvContent = [
                headers.join(","),
                ...rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
            ].join("\n");
            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `wave_applications_${statusFilter}_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast("Export downloaded successfully", "success");
        } catch (error: any) {
            console.error("Export error:", error);
            showToast(error.message || "Failed to export data", "error");
        }
    };


    const getStatusColor = (status: ApplicationStatus) => {
        switch (status) {
            case "approved": return "bg-green-100 text-green-700";
            case "rejected": return "bg-red-100 text-red-700";
            case "under_review": return "bg-blue-100 text-blue-700";
            default: return "bg-yellow-100 text-yellow-700";
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    WAVE Applications
                </h1>
                <p className="text-slate-600">
                    Review and manage WAVE program applications — updates in real-time
                </p>
            </div>

            {/* Filter */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
                <Filter className="w-5 h-5 text-slate-500" />
                <select
                    value={statusFilter}
                    onChange={(e) => updateFilter("status", e.target.value)}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900"
                >
                    <option value="all">All Applications</option>
                    <option value="pending">Pending</option>
                    <option value="under_review">Under Review</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                </select>
                <select
                    value={filters.sortOrder || "desc"}
                    onChange={(e) => updateFilter("sortOrder", e.target.value)}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900"
                >
                    <option value="desc">Newest First</option>
                    <option value="asc">Oldest First</option>
                </select>
                <DateRangeFilter
                    value={dateRange}
                    onChange={setDateRange}
                    label="Filter by date"
                />
                {/* Refresh indicator */}
                <button onClick={fetchData} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                    <RefreshCw className={`w-4 h-4 text-slate-500 ${isLoading ? 'animate-spin' : ''}`} />
                    <span className="text-xs font-semibold text-slate-600">Refresh</span>
                </button>
                {/* CSV Export */}
                {applications.length > 0 && (
                    <button
                        onClick={handleExportCSV}
                        className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all"
                    >
                        <Download className="w-4 h-4" />
                        Export CSV ({(meta as any)?.totalCount ?? applications.length})
                    </button>
                )}
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            )}

            {/* Error State */}
            {error && !isLoading && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 mb-6">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-800 font-semibold">Error Loading Applications</p>
                        <p className="text-red-600 text-sm mt-1">{error}</p>
                    </div>
                </div>
            )}

            {/* Applications List */}
            {!isLoading && !error && (
                <div className="space-y-4">
                    {applications.length === 0 ? (
                        <div className="bg-white rounded-2xl p-12 text-center">
                            <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                No Applications Found
                            </h3>
                            <p className="text-slate-600">
                                {statusFilter !== "all"
                                    ? `No ${statusFilter} applications`
                                    : "No applications have been submitted yet"}
                            </p>
                        </div>
                    ) : (
                        applications.map((app) => (
                            <div
                                key={app.id}
                                className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                            <FileText className="w-6 h-6 text-primary" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-slate-900">
                                                {app.user.name}
                                            </h3>
                                            <p className="text-sm text-slate-500">
                                                {app.user.email} • {app.data.phone || '—'}
                                            </p>
                                            {app.data.stateOfResidence && (
                                                <p className="text-sm text-slate-600 mt-1">
                                                    State: <span className="font-semibold">{app.data.stateOfResidence}</span>
                                                    {app.data.lgaOfResidence && ` • LGA: `}
                                                    {app.data.lgaOfResidence && <span className="font-semibold">{app.data.lgaOfResidence}</span>}
                                                </p>
                                            )}

                                            {/* Identity & KYC Fields */}
                                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                <div className="bg-slate-50 rounded-lg px-3 py-2">
                                                    <p className="text-xs text-slate-500 mb-0.5">NIN</p>
                                                    <p className="text-sm font-mono font-semibold text-slate-800">
                                                        {app.data.nin ? `${app.data.nin.slice(0, 3)}****${app.data.nin.slice(-3)}` : <span className="text-red-500 font-sans font-normal text-xs">Not provided</span>}
                                                    </p>
                                                </div>
                                                <div className="bg-slate-50 rounded-lg px-3 py-2">
                                                    <p className="text-xs text-slate-500 mb-0.5">Voter&apos;s Card (PVC)</p>
                                                    <p className="text-sm font-mono font-semibold text-slate-800">
                                                        {app.data.votersCardNumber || <span className="text-red-500 font-sans font-normal text-xs">Not provided</span>}
                                                    </p>
                                                </div>
                                                <div className="bg-slate-50 rounded-lg px-3 py-2">
                                                    <p className="text-xs text-slate-500 mb-0.5">BVN</p>
                                                    <p className="text-sm font-mono font-semibold text-slate-800">
                                                        {app.data.bvn ? `${app.data.bvn.slice(0, 3)}****${app.data.bvn.slice(-3)}` : <span className="text-red-500 font-sans font-normal text-xs">Not provided</span>}
                                                    </p>
                                                </div>
                                            </div>
                                            {app.data.bankName && (
                                                <p className="text-xs text-slate-500 mt-2">
                                                    🏦 {app.data.bankName} {app.data.accountNumber ? `• ****${app.data.accountNumber.slice(-4)}` : ''}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusColor(app.status as ApplicationStatus)}`}>
                                        {app.status.replace('_', ' ')}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                                    <p className="text-xs text-slate-500">
                                        Applied: {formatDate(app.data.createdAt)}
                                    </p>

                                    {app.status === "pending" && (
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleOpenEdit(app)}
                                                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition flex items-center gap-2"
                                            >
                                                <Pencil className="w-4 h-4" />
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleReject(app.id)}
                                                disabled={processingId === app.id}
                                                className="px-4 py-2 rounded-lg border border-red-300 text-red-700 font-semibold hover:bg-red-50 transition disabled:opacity-50 flex items-center gap-2"
                                            >
                                                {processingId === app.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <XCircle className="w-4 h-4" />
                                                )}
                                                Reject
                                            </button>
                                            <button
                                                onClick={() => handleApprove(app.id)}
                                                disabled={processingId === app.id}
                                                className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
                                            >
                                                {processingId === app.id ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <CheckCircle className="w-4 h-4" />
                                                )}
                                                Approve
                                            </button>
                                        </div>
                                    )}

                                    {app.status === "approved" && app.data.approvedBy && (
                                        <p className="text-xs text-green-600 font-semibold">
                                            ✓ Approved {app.data.approvalTimestamp ? `• ${formatDate(app.data.approvalTimestamp)}` : ''}
                                        </p>
                                    )}

                                    {app.status === "rejected" && app.data.rejectionReason && (
                                        <p className="text-sm text-red-600">
                                            Reason: {app.data.rejectionReason}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                    {applications.length > 0 && (
                        <div className="flex items-center justify-between pt-6 mt-6 border-t border-slate-200 pl-2">
                            <span className="text-sm text-slate-500 font-medium">
                                Page {pageIndex + 1}
                            </span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={onPrevPage}
                                    disabled={pageIndex === 0 || isLoading}
                                    className="px-5 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 transition drop-shadow-sm"
                                >
                                    Previous
                                </button>
                                <button
                                    onClick={onNextPage}
                                    disabled={!hasMore || isLoading}
                                    className="px-5 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 transition flex items-center gap-2 drop-shadow-sm"
                                >
                                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Next Page"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Rejection Modal */}
            <RejectionModal
                isOpen={rejectionModalOpen}
                onClose={() => { setRejectionModalOpen(false); setRejectingAppId(null); }}
                onConfirm={handleConfirmReject}
                title="Reject WAVE Application"
                description="This applicant will be notified of the rejection with the reason you provide below."
            />

            {/* Edit Application Modal */}
            {editingApp && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">Edit Application</h2>
                                <p className="text-sm text-slate-500 mt-0.5">Changes are logged with a full audit trail</p>
                            </div>
                            <button onClick={() => setEditingApp(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {([
                                { key: "surname", label: "Surname" },
                                { key: "firstName", label: "First Name" },
                                { key: "phone", label: "Phone" },
                                { key: "stateOfResidence", label: "State" },
                                { key: "lgaOfResidence", label: "LGA" },
                            ] as const).map(({ key, label }) => (
                                <div key={key}>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
                                    <input
                                        type="text"
                                        value={editDraft[key] ?? ""}
                                        onChange={(e) => setEditDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                </div>
                            ))}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Edit Note (optional)</label>
                                <input
                                    type="text"
                                    value={editNote}
                                    onChange={(e) => setEditNote(e.target.value)}
                                    placeholder="Reason for this edit..."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                onClick={() => setEditingApp(null)}
                                disabled={editSaving}
                                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveEdit}
                                disabled={editSaving}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2"
                            >
                                {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
