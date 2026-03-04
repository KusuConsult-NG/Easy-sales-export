"use client";

import { useState, useEffect, useRef } from "react";
import { FileText, CheckCircle, XCircle, Loader2, AlertCircle, Filter, Download } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { db } from "@/lib/firebase";
import { collection, query, where, orderBy, onSnapshot, Unsubscribe } from "firebase/firestore";
import {
    approveWaveApplicationAction,
    rejectWaveApplicationAction
} from "@/app/actions/admin";
import RejectionModal from "@/components/admin/RejectionModal";

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
    const [applications, setApplications] = useState<WaveApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("pending");
    const [processingId, setProcessingId] = useState<string | null>(null);
    const unsubscribeRef = useRef<Unsubscribe | null>(null);
    const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectingAppId, setRejectingAppId] = useState<string | null>(null);

    useEffect(() => {
        // Clean up previous listener
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
        }

        setIsLoading(true);
        setError(null);

        try {
            const col = collection(db, "wave_applications");

            // Build query based on filter
            const q = statusFilter !== "all"
                ? query(col, where("status", "==", statusFilter), orderBy("createdAt", "desc"))
                : query(col, orderBy("createdAt", "desc"));

            // Real-time listener — updates automatically when Firestore changes
            const unsubscribe = onSnapshot(
                q,
                (snapshot) => {
                    const docs = snapshot.docs.map((doc) => {
                        const data = doc.data();
                        return {
                            id: doc.id,
                            ...data,
                            createdAt: data.createdAt?.toDate() || new Date(),
                            reviewedAt: data.reviewedAt?.toDate(),
                            approvalTimestamp: data.approvalTimestamp?.toDate(),
                        } as WaveApplication;
                    });
                    setApplications(docs);
                    setIsLoading(false);
                },
                (err) => {
                    console.error("[WAVE Admin] Snapshot error:", err);
                    setError("Failed to load applications. Check your permissions.");
                    setIsLoading(false);
                }
            );

            unsubscribeRef.current = unsubscribe;
        } catch (err) {
            console.error("[WAVE Admin] Setup error:", err);
            setError("Failed to initialize real-time listener.");
            setIsLoading(false);
        }

        // Cleanup on unmount or filter change
        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
    }, [statusFilter]);

    const handleApprove = async (applicationId: string) => {
        setProcessingId(applicationId);
        const result = await approveWaveApplicationAction(applicationId);

        if (result.success) {
            showToast("Application approved successfully", "success");
            // No need to manually update state — onSnapshot will fire automatically
        } else {
            showToast(result.error || "Failed to approve application", "error");
        }

        setProcessingId(null);
    };

    const handleReject = (applicationId: string) => {
        setRejectingAppId(applicationId);
        setRejectionModalOpen(true);
    };

    const handleConfirmReject = async (reason: string) => {
        if (!rejectingAppId) return;
        setProcessingId(rejectingAppId);
        setRejectionModalOpen(false);

        const result = await rejectWaveApplicationAction(rejectingAppId, reason);
        if (result.success) {
            showToast("Application rejected successfully", "success");
        } else {
            showToast(result.error || "Failed to reject application", "error");
        }
        setProcessingId(null);
        setRejectingAppId(null);
    };

    const handleExportCSV = () => {
        if (applications.length === 0) return;
        const headers = [
            "Application ID", "Surname", "First Name", "Email", "Phone",
            "State", "LGA", "NIN", "BVN", "Voter Card",
            "Bank Name", "Account Number", "Status", "Applied Date"
        ];
        const rows = applications.map(app => [
            app.id, app.surname || "", app.firstName || "",
            app.email || "", app.phone || "",
            app.stateOfResidence || "", app.lgaOfResidence || "",
            app.nin || "", app.bvn || "", app.votersCardNumber || "",
            app.bankName || "", app.accountNumber || "",
            app.status, new Date(app.createdAt).toLocaleDateString("en-NG")
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
    };

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(date));
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
            <div className="flex items-center gap-4 mb-6">
                <Filter className="w-5 h-5 text-slate-500" />
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | "all")}
                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900"
                >
                    <option value="all">All Applications</option>
                    <option value="pending">Pending</option>
                    <option value="under_review">Under Review</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                </select>
                {/* Live indicator */}
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-slate-500">Live</span>
                </div>
                {/* CSV Export */}
                {applications.length > 0 && (
                    <button
                        onClick={handleExportCSV}
                        className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all"
                    >
                        <Download className="w-4 h-4" />
                        Export CSV ({applications.length})
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
                                                {getDisplayName(app)}
                                            </h3>
                                            <p className="text-sm text-slate-500">
                                                {app.email || app.userEmail || '—'} • {app.phone || '—'}
                                            </p>
                                            {app.stateOfResidence && (
                                                <p className="text-sm text-slate-600 mt-1">
                                                    State: <span className="font-semibold">{app.stateOfResidence}</span>
                                                    {app.lgaOfResidence && ` • LGA: `}
                                                    {app.lgaOfResidence && <span className="font-semibold">{app.lgaOfResidence}</span>}
                                                </p>
                                            )}

                                            {/* Identity & KYC Fields */}
                                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                <div className="bg-slate-50 rounded-lg px-3 py-2">
                                                    <p className="text-xs text-slate-500 mb-0.5">NIN</p>
                                                    <p className="text-sm font-mono font-semibold text-slate-800">
                                                        {app.nin ? `${app.nin.slice(0, 3)}****${app.nin.slice(-3)}` : <span className="text-red-500 font-sans font-normal text-xs">Not provided</span>}
                                                    </p>
                                                </div>
                                                <div className="bg-slate-50 rounded-lg px-3 py-2">
                                                    <p className="text-xs text-slate-500 mb-0.5">Voter&apos;s Card (PVC)</p>
                                                    <p className="text-sm font-mono font-semibold text-slate-800">
                                                        {app.votersCardNumber || <span className="text-red-500 font-sans font-normal text-xs">Not provided</span>}
                                                    </p>
                                                </div>
                                                <div className="bg-slate-50 rounded-lg px-3 py-2">
                                                    <p className="text-xs text-slate-500 mb-0.5">BVN</p>
                                                    <p className="text-sm font-mono font-semibold text-slate-800">
                                                        {app.bvn ? `${app.bvn.slice(0, 3)}****${app.bvn.slice(-3)}` : <span className="text-red-500 font-sans font-normal text-xs">Not provided</span>}
                                                    </p>
                                                </div>
                                            </div>
                                            {app.bankName && (
                                                <p className="text-xs text-slate-500 mt-2">
                                                    🏦 {app.bankName} {app.accountNumber ? `• ****${app.accountNumber.slice(-4)}` : ''}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusColor(app.status)}`}>
                                        {app.status.replace('_', ' ')}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                                    <p className="text-xs text-slate-500">
                                        Applied: {formatDate(app.createdAt)}
                                    </p>

                                    {app.status === "pending" && (
                                        <div className="flex gap-2">
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

                                    {app.status === "approved" && app.approvedBy && (
                                        <p className="text-xs text-green-600 font-semibold">
                                            ✓ Approved {app.approvalTimestamp ? `• ${formatDate(app.approvalTimestamp)}` : ''}
                                        </p>
                                    )}

                                    {app.status === "rejected" && app.rejectionReason && (
                                        <p className="text-sm text-red-600">
                                            Reason: {app.rejectionReason}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))
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
        </div>
    );
}
