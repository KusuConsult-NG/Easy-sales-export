"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    AlertTriangle,
    Search,
    Filter,
    Clock,
    CheckCircle,
    EyeIcon,
    Loader2,
    TrendingUp,
    XCircle,
} from "lucide-react";
import { getAdminDisputesAction } from "@/app/actions/disputes";
import type { Dispute, DisputeStatus } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";

const DISPUTE_REASON_LABELS: Record<string, string> = {
    not_received: "Item Not Received",
    wrong_item: "Wrong Item",
    damaged: "Damaged/Defective",
    fake_product: "Fake/Counterfeit",
    other: "Other Issue",
};

export default function AdminDisputesPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [disputes, setDisputes] = useState<Dispute[]>([]);
    const [filteredDisputes, setFilteredDisputes] = useState<Dispute[]>([]);
    const [loading, setLoading] = useState(true);

    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<DisputeStatus | "all">("all");

    useEffect(() => {
        loadDisputes();
    }, []);

    useEffect(() => {
        filterDisputes();
    }, [searchQuery, statusFilter, disputes]);

    async function loadDisputes() {
        setLoading(true);
        try {
            const result = await getAdminDisputesAction();
            if (result.success) {
                setDisputes(result.disputes || []);
            } else {
                showToast(result.error || "Failed to load disputes", "error");
            }
        } catch (error) {
            showToast("Failed to load disputes", "error");
        } finally {
            setLoading(false);
        }
    }

    function filterDisputes() {
        let filtered = [...disputes];

        if (statusFilter !== "all") {
            filtered = filtered.filter((d) => d.status === statusFilter);
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            filtered = filtered.filter(
                (d) =>
                    d.orderId.toLowerCase().includes(query) ||
                    d.id.toLowerCase().includes(query) ||
                    d.description.toLowerCase().includes(query)
            );
        }

        setFilteredDisputes(filtered);
    }

    const stats = {
        open: disputes.filter((d) => d.status === "open").length,
        under_review: disputes.filter((d) => d.status === "under_review").length,
        resolved: disputes.filter((d) => d.status === "resolved").length,
    };

    const getStatusColor = (status: DisputeStatus) => {
        switch (status) {
            case "open":
                return "yellow";
            case "under_review":
                return "blue";
            case "resolved":
                return "green";
            case "closed":
                return "gray";
            default:
                return "gray";
        }
    };

    const getStatusIcon = (status: DisputeStatus) => {
        switch (status) {
            case "open":
                return AlertTriangle;
            case "under_review":
                return Clock;
            case "resolved":
                return CheckCircle;
            case "closed":
                return XCircle;
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                        Dispute Management
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400">
                        Review and resolve marketplace disputes
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
                                Open Disputes
                            </h3>
                            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
                        </div>
                        <p className="text-3xl font-bold text-yellow-900 dark:text-yellow-100">
                            {stats.open}
                        </p>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                                Under Review
                            </h3>
                            <Clock className="w-5 h-5 text-blue-600 dark:text-blue-500" />
                        </div>
                        <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">
                            {stats.under_review}
                        </p>
                    </div>

                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-green-800 dark:text-green-200">
                                Resolved
                            </h3>
                            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-500" />
                        </div>
                        <p className="text-3xl font-bold text-green-900 dark:text-green-100">
                            {stats.resolved}
                        </p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Search */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Search
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by order ID, dispute ID, or description..."
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        </div>

                        {/* Status Filter */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Status Filter
                            </label>
                            <div className="relative">
                                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value as any)}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary appearance-none"
                                >
                                    <option value="all">All Statuses</option>
                                    <option value="open">Open</option>
                                    <option value="under_review">Under Review</option>
                                    <option value="resolved">Resolved</option>
                                    <option value="closed">Closed</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Disputes List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    </div>
                ) : filteredDisputes.length > 0 ? (
                    <div className="space-y-4">
                        {filteredDisputes.map((dispute) => {
                            const statusColor = getStatusColor(dispute.status);
                            const StatusIcon = getStatusIcon(dispute.status);
                            const daysAgo = Math.floor(
                                (Date.now() - new Date(dispute.createdAt).getTime()) / (1000 * 60 * 60 * 24)
                            );

                            return (
                                <div
                                    key={dispute.id}
                                    className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 hover:shadow-xl transition"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <StatusIcon
                                                    className={`w-5 h-5 text-${statusColor}-600 dark:text-${statusColor}-500`}
                                                />
                                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                                    Dispute #{dispute.id.slice(0, 8).toUpperCase()}
                                                </h3>
                                                <span
                                                    className={`px-3 py-1 bg-${statusColor}-100 dark:bg-${statusColor}-900/20 text-${statusColor}-800 dark:text-${statusColor}-200 text-sm font-semibold rounded-full capitalize`}
                                                >
                                                    {dispute.status.replace("_", " ")}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                                                Order: {dispute.orderId} • Opened {daysAgo} day{daysAgo !== 1 ? "s" : ""} ago
                                            </p>
                                        </div>
                                    </div>

                                    {/* Reason */}
                                    <div className="mb-4">
                                        <span className="inline-block px-3 py-1 bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm font-semibold rounded-lg mb-2">
                                            {DISPUTE_REASON_LABELS[dispute.reason] || dispute.reason}
                                        </span>
                                        <p className="text-gray-700 dark:text-gray-300 line-clamp-2">
                                            {dispute.description}
                                        </p>
                                    </div>

                                    {/* Parties */}
                                    <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <div className="flex gap-6 text-sm">
                                            <div>
                                                <span className="text-gray-500 dark:text-gray-400">Buyer:</span>
                                                <span className="ml-2 font-semibold text-gray-900 dark:text-white">
                                                    {dispute.buyerId.slice(0, 8)}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 dark:text-gray-400">Seller:</span>
                                                <span className="ml-2 font-semibold text-gray-900 dark:text-white">
                                                    {dispute.sellerId.slice(0, 8)}
                                                </span>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => router.push(`/admin/marketplace/disputes/${dispute.id}`)}
                                            className="px-4 py-2 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition flex items-center gap-2"
                                        >
                                            <EyeIcon className="w-4 h-4" />
                                            Review
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-2xl">
                        <CheckCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 dark:text-gray-400 text-lg">
                            {searchQuery || statusFilter !== "all"
                                ? "No disputes match your filters"
                                : "No disputes found"}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
