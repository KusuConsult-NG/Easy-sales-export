"use client";

import { useState, useEffect } from "react";
import { CheckCircle, XCircle, Clock, Eye, FileText, Package, Home, GraduationCap, BookOpen } from "lucide-react";

type ContentType = "all" | "products" | "land" | "loans" | "wave" | "certificates" | "resources" | "courses";
type ApprovalStatus = "pending" | "approved" | "rejected";

interface PendingContent {
    id: string;
    type: ContentType;
    title: string;
    submittedBy: string;
    submittedAt: Date;
    status: ApprovalStatus;
    description?: string;
}

export default function ContentApprovalPage() {
    const [contentFilter, setContentFilter] = useState<ContentType>("all");
    const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">("pending");
    const [pendingItems, setPendingItems] = useState<PendingContent[]>([]);
    const [selectedItem, setSelectedItem] = useState<PendingContent | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Mock data - replace with actual server action
        setPendingItems([
            {
                id: "1",
                type: "products",
                title: "Organic Cocoa Beans - Premium Grade",
                submittedBy: "vendor@example.com",
                submittedAt: new Date("2024-02-01"),
                status: "pending",
                description: "50kg bags of organic cocoa beans"
            },
            {
                id: "2",
                type: "land",
                title: "5 Hectares Farm Land - Ogun State",
                submittedBy: "farmer@example.com",
                submittedAt: new Date("2024-02-02"),
                status: "pending",
                description: "Agricultural land with water access"
            },
            {
                id: "3",
                type: "loans",
                title: "Loan Application - ₦500,000",
                submittedBy: "member@example.com",
                submittedAt: new Date("2024-02-03"),
                status: "pending"
            },
        ]);
        setLoading(false);
    }, [contentFilter, statusFilter]);

    const getIcon = (type: ContentType) => {
        const icons = {
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

    const getStatusBadge = (status: ApprovalStatus) => {
        const styles = {
            pending: "bg-yellow-100 text-yellow-800",
            approved: "bg-green-100 text-green-800",
            rejected: "bg-red-100 text-red-800"
        };
        const icons = {
            pending: Clock,
            approved: CheckCircle,
            rejected: XCircle
        };
        const Icon = icons[status];
        return (
            <span className={`inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-semibold ${styles[status]}`}>
                <Icon className="w-3 h-3" />
                <span>{status.toUpperCase()}</span>
            </span>
        );
    };

    const filteredItems = pendingItems.filter(item => {
        if (contentFilter !== "all" && item.type !== contentFilter) return false;
        if (statusFilter !== "all" && item.status !== statusFilter) return false;
        return true;
    });

    const stats = {
        pending: pendingItems.filter(i => i.status === "pending").length,
        approved: pendingItems.filter(i => i.status === "approved").length,
        rejected: pendingItems.filter(i => i.status === "rejected").length,
    };

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-12 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Content Approval Center
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Review and approve all user-submitted content before it goes live
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 p-6 rounded-xl">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-1">Pending Review</p>
                                <p className="text-3xl font-bold text-yellow-900 dark:text-yellow-100">{stats.pending}</p>
                            </div>
                            <Clock className="w-12 h-12 text-yellow-600" />
                        </div>
                    </div>

                    <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-xl">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-green-700 dark:text-green-300 mb-1">Approved</p>
                                <p className="text-3xl font-bold text-green-900 dark:text-green-100">{stats.approved}</p>
                            </div>
                            <CheckCircle className="w-12 h-12 text-green-600" />
                        </div>
                    </div>

                    <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-xl">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-red-700 dark:text-red-300 mb-1">Rejected</p>
                                <p className="text-3xl font-bold text-red-900 dark:text-red-100">{stats.rejected}</p>
                            </div>
                            <XCircle className="w-12 h-12 text-red-600" />
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Content Type
                            </label>
                            <select
                                value={contentFilter}
                                onChange={(e) => setContentFilter(e.target.value as ContentType)}
                                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white"
                            >
                                <option value="all">All Content</option>
                                <option value="products">Marketplace Products</option>
                                <option value="land">Land Listings</option>
                                <option value="loans">Loan Applications</option>
                                <option value="wave">WAVE Applications</option>
                                <option value="certificates">Certificates</option>
                                <option value="resources">WAVE Resources</option>
                                <option value="courses">Academy Courses</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                Status
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as ApprovalStatus | "all")}
                                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white"
                            >
                                <option value="all">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="rejected">Rejected</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Content List */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm overflow-hidden">
                    {filteredItems.length === 0 ? (
                        <div className="p-12 text-center">
                            <Eye className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                                No content found
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400">
                                No content matches the selected filters
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200 dark:divide-slate-700">
                            {filteredItems.map((item) => (
                                <div
                                    key={item.id}
                                    className="p-6 hover:bg-slate-50 dark:hover:bg-slate-750 transition cursor-pointer"
                                    onClick={() => setSelectedItem(item)}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-start space-x-4 flex-1">
                                            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                                                {getIcon(item.type)}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center space-x-2 mb-1">
                                                    <h3 className="font-semibold text-slate-900 dark:text-white">
                                                        {item.title}
                                                    </h3>
                                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                                        {item.type}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                                                    Submitted by {item.submittedBy}
                                                </p>
                                                {item.description && (
                                                    <p className="text-sm text-slate-500 dark:text-slate-500">
                                                        {item.description}
                                                    </p>
                                                )}
                                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
                                                    {item.submittedAt.toLocaleDateString()}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="ml-4">
                                            {getStatusBadge(item.status)}
                                        </div>
                                    </div>

                                    {item.status === "pending" && (
                                        <div className="mt-4 flex space-x-3">
                                            <button className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-medium">
                                                Approve
                                            </button>
                                            <button className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium">
                                                Reject
                                            </button>
                                            <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">
                                                View Details
                                            </button>
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
