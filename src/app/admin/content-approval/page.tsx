"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Clock, Eye, FileText, Package, Home, GraduationCap, BookOpen, Loader2 } from "lucide-react";
import { getPendingContentAction, approveContentAction, rejectContentAction, type PendingContentItem, type ContentType } from "@/app/actions/admin-content";
import { toast } from "sonner";
import { useAdminData } from "@/hooks/useAdminData";

type ApprovalStatus = "pending" | "approved" | "rejected";

export default function ContentApprovalPage() {
    const [contentFilter, setContentFilter] = useState<ContentType | "all">("all");
    const [selectedItem, setSelectedItem] = useState<PendingContentItem | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

    const {
        data: pendingItems,
        loading,
        refresh: loadContent
    } = useAdminData<PendingContentItem>({
        fetchAction: async () => {
            const result = await getPendingContentAction();
            if (!result.success) {
                toast.error(result.error || "Failed to load content");
                return { success: false, data: [], meta: { hasMore: false }, error: result.error };
            }
            return {
                success: true,
                data: (result.data ?? []) as any,
                meta: { hasMore: false }
            };
        },
        limit: 500, // Effectively load all since the backend caps it
        dependencies: []
    });

    async function handleApprove(item: PendingContentItem) {
        if (!confirm(`Are you sure you want to approve "${item.title}"?`)) return;

        setActionLoading(true);
        const result = await approveContentAction(item.id, item.type);
        if (result.success) {
            toast.success("Content approved successfully");
            setSelectedItem(null);
            await loadContent();
        } else {
            toast.error(result.error || "Failed to approve content");
        }
        setActionLoading(false);
    };

    async function handleReject(item: PendingContentItem) {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;

        setActionLoading(true);
        const result = await rejectContentAction(item.id, item.type, reason);
        if (result.success) {
            toast.success("Content rejected");
            setSelectedItem(null);
            await loadContent();
        } else {
            toast.error(result.error || "Failed to reject content");
        }
        setActionLoading(false);
    };

    const getIcon = (type: string) => {
        const icons: any = {
            products: Package,
            land: Home,
            loans: FileText,
            wave: GraduationCap,
            certificates: FileText,
            resources: BookOpen,
            courses: GraduationCap,
            all: Eye
        };
        const Icon = icons[type] || Eye;
        return <Icon className="w-5 h-5" />;
    };

    const getStatusBadge = (status: string) => {
        const styles: any = {
            pending: "bg-yellow-100 text-yellow-800",
            approved: "bg-green-100 text-green-800",
            rejected: "bg-red-100 text-red-800"
        };
        const icons: any = {
            pending: Clock,
            approved: CheckCircle,
            rejected: XCircle
        };
        const Icon = icons[status] || Clock;
        return (
            <span className={`inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-semibold ${styles[status]}`}>
                <Icon className="w-3 h-3" />
                <span>{status.toUpperCase()}</span>
            </span>
        );
    };

    const filteredItems = pendingItems.filter(item => {
        if (contentFilter !== "all" && item.type !== contentFilter) return false;
        return true;
    });

    const stats = {
        pending: pendingItems.filter(i => i.status === "pending").length,
        approved: pendingItems.filter(i => i.status === "approved").length,
        rejected: pendingItems.filter(i => i.status === "rejected").length,
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 py-12 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 mb-2">
                        Content Approval Center
                    </h1>
                    <p className="text-slate-600">
                        Review and approve all user-submitted content before it goes live
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <button
                        onClick={() => setContentFilter("all")}
                        className="bg-yellow-50 p-6 rounded-xl border border-yellow-100 text-left hover:shadow-md transition hover:-translate-y-0.5"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-yellow-700 mb-1">Pending Review</p>
                                <p className="text-3xl font-bold text-yellow-900">{stats.pending}</p>
                            </div>
                            <Clock className="w-12 h-12 text-yellow-600 opacity-50" />
                        </div>
                        <p className="text-xs text-yellow-600 mt-2">Click to show pending →</p>
                    </button>

                    <div className="bg-green-50 p-6 rounded-xl border border-green-100">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-green-700 mb-1">Approved</p>
                                <p className="text-3xl font-bold text-green-900">{stats.approved}</p>
                            </div>
                            <CheckCircle className="w-12 h-12 text-green-600 opacity-50" />
                        </div>
                        <p className="text-xs text-green-600 mt-2">Items approved this session</p>
                    </div>

                    <div className="bg-red-50 p-6 rounded-xl border border-red-100">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-red-700 mb-1">Rejected</p>
                                <p className="text-3xl font-bold text-red-900">{stats.rejected}</p>
                            </div>
                            <XCircle className="w-12 h-12 text-red-600 opacity-50" />
                        </div>
                        <p className="text-xs text-red-600 mt-2">Items rejected this session</p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-900 mb-2">
                                Content Type
                            </label>
                            <select
                                value={contentFilter}
                                onChange={(e) => setContentFilter(e.target.value as ContentType | "all")}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="all">All Content</option>
                                <option value="products">Marketplace Products</option>
                                <option value="land">Land Listings</option>
                                <option value="loans">Loan Applications</option>
                                <option value="wave">WAVE Applications</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Content List */}
                <div className="bg-white rounded-xl shadow-sm overflow-hidden min-h-[400px]">
                    {filteredItems.length === 0 ? (
                        <div className="p-12 text-center h-full flex flex-col items-center justify-center">
                            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4 opacity-50" />
                            <h3 className="text-xl font-semibold text-slate-900 mb-2">
                                All caught up!
                            </h3>
                            <p className="text-slate-600">
                                No pending content to review at the moment.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200">
                            {filteredItems.map((item) => (
                                <div
                                    key={item.id}
                                    className={`p-6 hover:bg-slate-50 transition cursor-pointer ${selectedItem?.id === item.id ? 'bg-blue-50' : ''}`}
                                    onClick={() => setSelectedItem(item === selectedItem ? null : item)}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-start space-x-4 flex-1">
                                            <div className="p-3 bg-blue-100 rounded-lg text-blue-600">
                                                {getIcon(item.type)}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center space-x-2 mb-1">
                                                    <h3 className="font-semibold text-slate-900 text-lg">
                                                        {item.title}
                                                    </h3>
                                                    <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500 uppercase tracking-wide">
                                                        {item.type}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-slate-600 mb-2">
                                                    Submitted by <span className="font-medium text-slate-900">{item.submittedBy}</span>
                                                </p>
                                                {item.description && (
                                                    <p className="text-sm text-slate-500 line-clamp-2">
                                                        {item.description}
                                                    </p>
                                                )}
                                                <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {new Date(item.submittedAt).toLocaleDateString()} at {new Date(item.submittedAt).toLocaleTimeString()}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="ml-4">
                                            {getStatusBadge(item.status)}
                                        </div>
                                    </div>

                                    {/* Expandable Action Area */}
                                    {selectedItem?.id === item.id && (
                                        <div className="mt-6 pt-6 border-t border-slate-200 animate-in slide-in-from-top-2 duration-200">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                                <div className="bg-slate-50 p-4 rounded-lg">
                                                    <h4 className="text-sm font-semibold text-slate-900 mb-2">Details</h4>
                                                    <pre className="text-xs text-slate-600 whitespace-pre-wrap overflow-auto max-h-40">
                                                        {JSON.stringify(item.metadata, null, 2)}
                                                    </pre>
                                                </div>
                                                <div className="flex flex-col justify-end gap-3">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleApprove(item); }}
                                                        disabled={actionLoading}
                                                        className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl transition font-medium flex items-center justify-center gap-2 shadow-lg shadow-green-900/20"
                                                    >
                                                        {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                                                        Approve Request
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleReject(item); }}
                                                        disabled={actionLoading}
                                                        className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl transition font-medium flex items-center justify-center gap-2 shadow-lg shadow-red-900/20"
                                                    >
                                                        {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5" />}
                                                        Reject Request
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

