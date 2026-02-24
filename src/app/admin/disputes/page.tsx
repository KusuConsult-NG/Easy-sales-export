"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    Clock,
    CheckCircle,
    MessageSquare,
    Filter,
    Search,
    Loader2,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getAdminDisputesAction, updateDisputeStatusAction } from "@/app/actions/disputes";
import { useToast } from "@/contexts/ToastContext";

export default function AdminDisputesPage() {
    const { showToast } = useToast();
    const [disputes, setDisputes] = useState<any[]>([]);
    const [selectedDispute, setSelectedDispute] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [resolving, setResolving] = useState(false);
    const [adminNotes, setAdminNotes] = useState("");

    useEffect(() => {
        loadDisputes();
    }, []);

    async function loadDisputes() {
        setLoading(true);
        try {
            const result = await getAdminDisputesAction();
            if (result.success) {
                setDisputes(result.disputes || []);
            } else {
                showToast(result.error || "Failed to load disputes", "error");
            }
        } catch {
            showToast("Failed to load disputes", "error");
        } finally {
            setLoading(false);
        }
    }

    async function handleResolve(disputeId: string, resolution: "refund_buyer" | "release_seller" | "partial_refund") {
        if (!adminNotes.trim()) {
            showToast("Please enter admin notes before resolving", "error");
            return;
        }
        setResolving(true);
        try {
            const result = await updateDisputeStatusAction(disputeId, resolution, adminNotes);
            if (result.success) {
                showToast("Dispute resolved successfully", "success");
                setSelectedDispute(null);
                setAdminNotes("");
                await loadDisputes();
            } else {
                showToast((result as any).error || "Failed to resolve dispute", "error");
            }
        } catch {
            showToast("Failed to resolve dispute", "error");
        } finally {
            setResolving(false);
        }
    }

    const getStatusBadge = (status: string) => {
        const config: Record<string, { bg: string; text: string; icon: any }> = {
            open: { bg: "bg-yellow-100", text: "text-yellow-700", icon: Clock },
            under_review: { bg: "bg-blue-100", text: "text-blue-700", icon: AlertCircle },
            investigating: { bg: "bg-blue-100", text: "text-blue-700", icon: AlertCircle },
            resolved: { bg: "bg-green-100", text: "text-green-700", icon: CheckCircle },
            closed: { bg: "bg-slate-100", text: "text-slate-700", icon: CheckCircle },
        };
        const { bg, text, icon: Icon } = config[status] || config.open;
        return (
            <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-fit ${bg} ${text}`}>
                <Icon className="w-3 h-3" />
                {status.replace(/_/g, " ").toUpperCase()}
            </span>
        );
    };

    const filteredDisputes = disputes.filter((d) => {
        const matchesStatus = filterStatus === "all" || d.status === filterStatus;
        const matchesSearch =
            !searchQuery ||
            d.id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            d.orderId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            d.reason?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            d.description?.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesStatus && matchesSearch;
    });

    const selected = disputes.find((d) => d.id === selectedDispute);

    if (loading) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">Dispute Management</h1>
                <p className="text-slate-600">Review and resolve member disputes ({disputes.length} total)</p>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex-1 min-w-[300px]">
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by ID, order, or description..."
                                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter className="w-5 h-5 text-slate-500" />
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="all">All Status</option>
                            <option value="open">Open</option>
                            <option value="under_review">Under Review</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Content */}
            {filteredDisputes.length === 0 ? (
                <div className="bg-white rounded-2xl p-12 shadow-sm text-center">
                    <AlertCircle className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500 text-lg">No disputes found</p>
                    <p className="text-slate-400 text-sm mt-2">
                        {disputes.length === 0
                            ? "No disputes have been filed on the platform yet"
                            : "No disputes match your current filters"}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Disputes List */}
                    <div className="lg:col-span-1 space-y-4">
                        {filteredDisputes.map((dispute) => (
                            <div
                                key={dispute.id}
                                onClick={() => { setSelectedDispute(dispute.id); setAdminNotes(""); }}
                                className={`bg-white rounded-xl p-5 cursor-pointer transition-all ${selectedDispute === dispute.id
                                        ? "ring-2 ring-primary shadow-lg"
                                        : "shadow-sm hover:shadow-md"
                                    }`}
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div>
                                        <p className="text-xs text-slate-500 mb-1 font-mono">{dispute.id?.slice(0, 12)}...</p>
                                        <p className="font-bold text-slate-900 text-sm">
                                            {dispute.reason?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                        </p>
                                    </div>
                                </div>
                                <p className="text-sm text-slate-600 mb-3 line-clamp-2">{dispute.description}</p>
                                <div className="flex items-center justify-between">
                                    {getStatusBadge(dispute.status)}
                                    <span className="text-xs text-slate-500">
                                        {dispute.createdAt
                                            ? new Date(dispute.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
                                            : ""}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Dispute Detail */}
                    <div className="lg:col-span-2">
                        {selected ? (
                            <div className="bg-white rounded-2xl p-6 shadow-sm">
                                <div className="mb-6 pb-6 border-b border-slate-200">
                                    <div className="flex items-start justify-between mb-3">
                                        <div>
                                            <p className="text-xs text-slate-500 font-mono mb-1">Dispute ID: {selected.id}</p>
                                            <h2 className="text-xl font-bold text-slate-900">
                                                {selected.reason?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                            </h2>
                                        </div>
                                        {getStatusBadge(selected.status)}
                                    </div>
                                    <p className="text-slate-600 mb-4">{selected.description}</p>

                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="p-3 bg-slate-50 rounded-xl">
                                            <p className="text-xs text-slate-500 mb-1">Order ID</p>
                                            <p className="font-semibold text-slate-900 font-mono">{selected.orderId || "N/A"}</p>
                                        </div>
                                        <div className="p-3 bg-slate-50 rounded-xl">
                                            <p className="text-xs text-slate-500 mb-1">Filed By (Buyer)</p>
                                            <p className="font-semibold text-slate-900 font-mono text-xs">{selected.buyerId}</p>
                                        </div>
                                        <div className="p-3 bg-slate-50 rounded-xl">
                                            <p className="text-xs text-slate-500 mb-1">Seller</p>
                                            <p className="font-semibold text-slate-900 font-mono text-xs">{selected.sellerId || "N/A"}</p>
                                        </div>
                                        {selected.resolution && (
                                            <div className="p-3 bg-green-50 rounded-xl">
                                                <p className="text-xs text-slate-500 mb-1">Resolution</p>
                                                <p className="font-semibold text-green-700">
                                                    {selected.resolution.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    {selected.adminNotes && (
                                        <div className="mt-4 p-4 bg-blue-50 rounded-xl">
                                            <p className="text-xs font-semibold text-blue-700 mb-1">Admin Notes</p>
                                            <p className="text-sm text-blue-900">{selected.adminNotes}</p>
                                        </div>
                                    )}

                                    {selected.evidenceUrls?.length > 0 && (
                                        <div className="mt-4">
                                            <p className="text-xs font-semibold text-slate-600 mb-2">Evidence Files</p>
                                            <div className="flex flex-wrap gap-2">
                                                {selected.evidenceUrls.map((url: string, i: number) => (
                                                    <a
                                                        key={i}
                                                        href={url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="px-3 py-1 bg-slate-100 text-slate-900 text-xs rounded-lg hover:bg-slate-200 transition"
                                                    >
                                                        Evidence {i + 1}
                                                    </a>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Resolution Actions */}
                                {selected.status !== "resolved" && selected.status !== "closed" && (
                                    <div>
                                        <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                                            <MessageSquare className="w-5 h-5" />
                                            Resolve Dispute
                                        </h3>

                                        <textarea
                                            value={adminNotes}
                                            onChange={(e) => setAdminNotes(e.target.value)}
                                            rows={3}
                                            placeholder="Enter your resolution notes and reasoning..."
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-primary text-sm resize-none"
                                        />

                                        <div className="flex flex-wrap gap-3">
                                            <button
                                                onClick={() => handleResolve(selected.id, "refund_buyer")}
                                                disabled={resolving}
                                                className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                                            >
                                                {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                                Refund Buyer
                                            </button>
                                            <button
                                                onClick={() => handleResolve(selected.id, "release_seller")}
                                                disabled={resolving}
                                                className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                                            >
                                                {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                                Release to Seller
                                            </button>
                                            <button
                                                onClick={() => handleResolve(selected.id, "partial_refund")}
                                                disabled={resolving}
                                                className="px-5 py-2.5 border-2 border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
                                            >
                                                Partial Refund
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl p-12 shadow-sm text-center">
                                <AlertCircle className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                                <p className="text-slate-500">Select a dispute to view details and take action</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
