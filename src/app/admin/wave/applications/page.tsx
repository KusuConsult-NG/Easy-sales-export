"use client";

import { useState, useEffect } from "react";
import { FileText, CheckCircle, XCircle, Loader2, AlertCircle, Filter, Search, Eye, Calendar, MapPin, User } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import {
    getWaveApplicationsAction,
    approveWaveApplicationAction,
    rejectWaveApplicationAction
} from "@/app/actions/admin";

type ApplicationStatus = "pending" | "approved" | "rejected";

interface WaveApplication {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    farmSize: string;
    status: ApplicationStatus;
    createdAt: Date;
    reviewedAt?: Date;
    reviewedBy?: string;
    rejectionReason?: string;
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
                statusFilter !== "all" ? statusFilter : undefined,
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
                return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
            case "rejected":
                return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400";
            case "pending":
                return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400";
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    WAVE Applications
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Review and manage WAVE program applications
                </p>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-4 mb-6">
                <Filter className="w-5 h-5 text-slate-500" />
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | "all")}
                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                    <option value="all">All Applications</option>
                    <option value="pending">Pending</option>
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
                            className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                        <FileText className="w-6 h-6 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                            {app.fullName}
                                        </h3>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            {app.email} • {app.phone}
                                        </p>
                                        <p className="text-sm text-slate-600 dark:text-white mt-1">
                                            Farm Size: <span className="font-semibold">{app.farmSize}</span>
                                        </p>
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusColor(app.status)}`}>
                                    {app.status}
                                </span>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Applied: {formatDate(app.createdAt)}
                                </p>

                                {app.status === "pending" && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleReject(app.id)}
                                            disabled={processingId === app.id}
                                            className="px-4 py-2 rounded-lg border border-red-300 dark:border-red-600 text-red-700 dark:text-red-400 font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50 flex items-center gap-2"
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
                                    <p className="text-sm text-red-600 dark:text-red-400">
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
                                className="px-6 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
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
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center">
                            <FileText className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                No Applications Found
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400">
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
