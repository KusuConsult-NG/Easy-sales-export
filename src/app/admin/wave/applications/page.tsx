"use client";

import { useState, useEffect } from "react";
import { FileText, CheckCircle, XCircle, Loader2, AlertCircle, Filter, Search, Eye, Calendar, MapPin, User } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import {
    getWaveApplicationsAction,
    approveWaveApplicationAction,
    rejectWaveApplicationAction
} from "@/app/actions/admin";

type ApplicationStatus = "pending" | "under_review" | "approved" | "rejected";

interface WaveApplication {
    id: string;
    // New schema fields (7-section form)
    surname?: string;
    firstName?: string;
    otherNames?: string;
    phone?: string;
    email?: string;
    userEmail?: string;
    stateOfResidence?: string;
    // Legacy fallback
    fullName?: string;
    farmSize?: string;
    status: ApplicationStatus;
    createdAt: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    rejectionReason?: string;
}

/** Derives display name from new or legacy schema */
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
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("pending");
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Pagination
    const [lastCreatedAt, setLastCreatedAt] = useState<Date | string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(false);

    const fetchApplications = async (loadMore = false) => {
        if (loadMore) {
            setIsLoadingMore(true);
        } else {
            setIsLoading(true);
            setError(null);
        }

        try {
            const result = await getWaveApplicationsAction(
                statusFilter !== "all" ? statusFilter as "pending" | "approved" | "rejected" : undefined,
                20,
                loadMore ? lastCreatedAt : undefined
            );

            if (result.success && result.data) {
                if (loadMore) {
                    setApplications(prev => [...prev, ...result.data!]);
                } else {
                    setApplications(result.data);
                }

                setHasMore(!!result.hasMore);

                // Update cursor
                if (result.data.length > 0) {
                    const lastItem = result.data[result.data.length - 1];
                    // The action returns createdAt as Date object (from toDate())
                    setLastCreatedAt(lastItem.createdAt);
                }
            } else {
                setError(result.error || "Failed to load applications");
            }
        } catch (err) {
            setError("Failed to fetch applications");
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
        }
    };

    useEffect(() => {
        setLastCreatedAt(undefined);
        fetchApplications(false);
    }, [statusFilter]);

    const handleApprove = async (applicationId: string) => {
        setProcessingId(applicationId);
        const result = await approveWaveApplicationAction(applicationId);

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
        const result = await rejectWaveApplicationAction(applicationId, reason);

        if (result.success) {
            showToast("Application rejected successfully", "success");
            // Update local state
            setApplications(applications.map(app =>
                app.id === applicationId ? { ...app, status: "rejected", rejectionReason: reason } : app
            ));
        } else {
            showToast(result.error || "Failed to reject application", "error");
        }

        setProcessingId(null);
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
            case "approved":
                return "bg-green-100 text-green-700";
            case "rejected":
                return "bg-red-100 text-red-700";
            case "under_review":
                return "bg-blue-100 text-blue-700";
            case "pending":
            default:
                return "bg-yellow-100 text-yellow-700";
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
                    Review and manage WAVE program applications
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
                    {applications.map((app) => (
                        <div
                            key={app.id}
                            className="bg-white rounded-2xl p-6 elevation-2"
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
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusColor(app.status)}`}>
                                    {app.status}
                                </span>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-slate-200">
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

                                {app.status === "rejected" && app.rejectionReason && (
                                    <p className="text-sm text-red-600">
                                        Reason: {app.rejectionReason}
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* Load More Button */}
                    {hasMore && (
                        <div className="mt-8 flex justify-center">
                            <button
                                onClick={() => fetchApplications(true)}
                                disabled={isLoadingMore}
                                className="px-6 py-3 bg-white border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                            >
                                {isLoadingMore ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                        Loading...
                                    </>
                                ) : (
                                    <>
                                        Load More Applications
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                    {applications.length === 0 && (
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
                    )}
                </div>
            )}
        </div>
    );
}
