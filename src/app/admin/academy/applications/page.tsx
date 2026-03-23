"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, CheckCircle, XCircle, Loader2, AlertCircle, Filter, Search, Eye, Calendar, User, BookOpen } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import {
    getAcademyApplicationsAction,
    approveAcademyApplicationAction,
    rejectAcademyApplicationAction,
    markAcademyApplicationUnderReviewAction
} from "@/app/actions/admin";

type ApplicationStatus = "pending" | "under_review" | "approved" | "rejected";

interface AcademyApplication {
    id: string;
    personalInfo: {
        fullName: string;
        email: string;
        phone: string;
    };
    education: {
        educationLevel: string;
        fieldOfStudy: string;
    };
    status: ApplicationStatus;
    submittedAt: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    rejectionReason?: string;
}

export default function AdminAcademyApplicationsPage() {
    const { showToast } = useToast();
    const [applications, setApplications] = useState<AcademyApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
    const [search, setSearch] = useState("");
    const [processingId, setProcessingId] = useState<string | null>(null);

    const fetchApplications = useCallback(async () => {
        // Prevents React warning about synchronous state updates inside an effect
        setTimeout(() => setIsLoading(true), 0);
        setError(null);
        try {
            const result = await getAcademyApplicationsAction(
                statusFilter !== "all" ? statusFilter : undefined
            );
            if (result.success && result.data) {
                setApplications(result.data);
            } else {
                setError(result.error || "Failed to load applications");
            }
        } catch (err) {
            setError("Failed to fetch applications");
        }
        setIsLoading(false);
    }, [statusFilter]);

    useEffect(() => {
        fetchApplications();
    }, [fetchApplications]);

    const handleApprove = async (applicationId: string) => {
        setProcessingId(applicationId);
        const result = await approveAcademyApplicationAction(applicationId);

        if (result.success) {
            showToast("Application approved successfully", "success");
            // Update local state
            setApplications(applications.map(app =>
                app.id === applicationId ? { ...app, status: "approved" } : app
            ));
        } else {
            showToast(result.error || "Failed to approve application", "error");
        }

        setProcessingId(null);
    };

    const handleReject = async (applicationId: string) => {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;

        setProcessingId(applicationId);
        const result = await rejectAcademyApplicationAction(applicationId, reason);

        if (result.success) {
            showToast("Application rejected successfully", "success");
            setApplications(applications.map(app =>
                app.id === applicationId ? { ...app, status: "rejected", rejectionReason: reason } : app
            ));
        } else {
            showToast(result.error || "Failed to reject application", "error");
        }

        setProcessingId(null);
    };

    const handleMarkUnderReview = async (applicationId: string) => {
        setProcessingId(applicationId + "_review");
        const result = await markAcademyApplicationUnderReviewAction(applicationId);

        if (result.success) {
            showToast("Application marked as under review", "success");
            setApplications(applications.map(app =>
                app.id === applicationId ? { ...app, status: "under_review" } : app
            ));
        } else {
            showToast(result.error || "Failed to update status", "error");
        }

        setProcessingId(null);
    };

    const formatDate = (date: Date | string | null | undefined) => {
        if (!date) return "—";
        try {
            return new Intl.DateTimeFormat("en-NG", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            }).format(new Date(date as string));
        } catch {
            return "—";
        }
    };

    const filteredApplications = search.trim()
        ? applications.filter(app =>
            app.personalInfo?.fullName?.toLowerCase().includes(search.toLowerCase()) ||
            app.personalInfo?.email?.toLowerCase().includes(search.toLowerCase()) ||
            app.personalInfo?.phone?.includes(search)
          )
        : applications;

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
                    Academy Applications
                </h1>
                <p className="text-slate-600">
                    Review and manage Academy learner applications
                </p>
            </div>

            {/* Filter + Search */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
                <div className="flex items-center gap-2">
                    <Filter className="w-5 h-5 text-slate-500" />
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | "all")}
                        className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm"
                    >
                        <option value="all">All Applications</option>
                        <option value="pending">Pending</option>
                        <option value="under_review">Under Review</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                    </select>
                </div>
                <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="Search by name, email or phone…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                {!isLoading && (
                    <span className="text-sm text-slate-500">
                        {filteredApplications.length} result{filteredApplications.length !== 1 ? "s" : ""}
                    </span>
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
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-red-300">{error}</p>
                </div>
            )}

            {/* Applications List */}
            {!isLoading && !error && (
                <div className="space-y-4">
                    {filteredApplications.map((app) => (
                        <div
                            key={app.id}
                            className="bg-white rounded-2xl p-6 elevation-2"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                                        <BookOpen className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900">
                                            {app.personalInfo?.fullName}
                                        </h3>
                                        <p className="text-sm text-slate-500">
                                            {app.personalInfo?.email} • {app.personalInfo?.phone}
                                        </p>
                                        <p className="text-sm text-slate-600 mt-1">
                                            Education: <span className="font-semibold">{app.education?.educationLevel} ({app.education?.fieldOfStudy})</span>
                                        </p>
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusColor(app.status)}`}>
                                    {app.status}
                                </span>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                                <p className="text-xs text-slate-500">
                                    Applied: {formatDate(app.submittedAt)}
                                </p>

                                {app.status === "pending" && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleReject(app.id)}
                                            disabled={processingId === app.id || processingId === app.id + "_review"}
                                            className="px-4 py-2 rounded-lg border border-red-300 text-red-700 font-semibold hover:bg-red-50 transition disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {processingId === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                            Reject
                                        </button>
                                        <button
                                            onClick={() => handleMarkUnderReview(app.id)}
                                            disabled={processingId === app.id || processingId === app.id + "_review"}
                                            className="px-4 py-2 rounded-lg border border-amber-400 text-amber-700 font-semibold hover:bg-amber-50 transition disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {processingId === app.id + "_review" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                                            Under Review
                                        </button>
                                        <button
                                            onClick={() => handleApprove(app.id)}
                                            disabled={processingId === app.id || processingId === app.id + "_review"}
                                            className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {processingId === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                            Approve
                                        </button>
                                    </div>
                                )}

                                {app.status === "rejected" && app.rejectionReason && (
                                    <p className="text-sm text-red-600">
                                        Reason: {app.rejectionReason}
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}

                    {filteredApplications.length === 0 && (
                        <div className="bg-white rounded-2xl p-12 text-center">
                            <BookOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">
                                No Applications Found
                            </h3>
                            <p className="text-slate-600">
                                {search
                                    ? `No results for "${search}"`
                                    : statusFilter !== "all"
                                        ? `No ${statusFilter} applications`
                                        : "No applications have been submitted yet"}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
