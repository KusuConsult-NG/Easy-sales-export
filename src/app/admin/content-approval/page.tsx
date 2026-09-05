"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Clock, Eye, FileText, Package, Home, GraduationCap, BookOpen, Loader2, Container } from "lucide-react";
import { getContentApprovalItemsAction, approveContentAction, rejectContentAction, type PendingContentItem, type ContentType, type ApprovalStatus } from "@/app/actions/admin-content";
import { toast } from "sonner";
import { useAdminData } from "@/hooks/useAdminData";

export default function ContentApprovalPage() {
    const [contentFilter, setContentFilter] = useState<ContentType | "all">("all");
    const [activeStatusFilter, setActiveStatusFilter] = useState<ApprovalStatus>("pending");
    const [selectedItem, setSelectedItem] = useState<PendingContentItem | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [stats, setStats] = useState<any>({ pending: 0, approved: 0, rejected: 0, typeStats: null });
    const [hasAttemptedAutoToggle, setHasAttemptedAutoToggle] = useState(false);

    const {
        data: items,
        loading,
        refresh: loadContent
    } = useAdminData<PendingContentItem>({
        fetchAction: async () => {
            const result = await getContentApprovalItemsAction(activeStatusFilter);
            if (!result.success) {
                toast.error(result.error || "Failed to load content");
                return { success: false, data: [], meta: { hasMore: false }, error: result.error };
            }
            if (result.stats) {
                setStats(result.stats);
                
                // Auto-toggle to approved tab on first load if pending is empty but approved has listings
                if (!hasAttemptedAutoToggle && activeStatusFilter === "pending" && (!result.data || result.data.length === 0) && result.stats.approved > 0) {
                    setHasAttemptedAutoToggle(true);
                    setTimeout(() => {
                        setActiveStatusFilter("approved");
                    }, 0);
                }
            }
            return {
                success: true,
                data: (result.data ?? []) as any,
                meta: { hasMore: false }
            };
        },
        limit: 500, // Effectively load all since the backend caps it
        dependencies: [activeStatusFilter]
    });

    const handleContentFilterChange = (newType: ContentType | "all") => {
        setContentFilter(newType);
        setSelectedItem(null);

        if (newType === "all" || !stats?.typeStats) return;

        const currentTypeStats = stats.typeStats[newType];
        if (!currentTypeStats) return;

        const currentCount =
            activeStatusFilter === "pending"
                ? currentTypeStats.pending
                : activeStatusFilter === "approved"
                ? currentTypeStats.approved
                : currentTypeStats.rejected;

        if (currentCount === 0) {
            if (currentTypeStats.pending > 0) {
                setActiveStatusFilter("pending");
            } else if (currentTypeStats.approved > 0) {
                setActiveStatusFilter("approved");
            } else if (currentTypeStats.rejected > 0) {
                setActiveStatusFilter("rejected");
            }
        }
    };

    async function handleApprove(item: PendingContentItem) {
        if (!confirm(`Are you sure you want to approve "${item.title}"?`)) return;

        setActionLoading(true);
        // #407. No try, reset after the await — a rejected promise left the
        // approve and reject buttons dead on the queue that marks land VERIFIED
        // and puts products live.
        try {
            const result = await approveContentAction(item.id, item.type);
            if (result.success) {
                toast.success("Content approved successfully");
                setSelectedItem(null);
                await loadContent();
            } else {
                toast.error(result.error || "Failed to approve content");
            }
        } catch {
            toast.error("Could not confirm the approval. Reload the queue before approving again.");
        } finally {
            setActionLoading(false);
        }
    }

    async function handleReject(item: PendingContentItem) {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;

        setActionLoading(true);
        // #407, the rejection half. Same shape, same screen.
        try {
            const result = await rejectContentAction(item.id, item.type, reason);
            if (result.success) {
                toast.success("Content rejected");
                setSelectedItem(null);
                await loadContent();
            } else {
                toast.error(result.error || "Failed to reject content");
            }
        } catch {
            toast.error("Could not confirm the rejection. Reload the queue before rejecting again.");
        } finally {
            setActionLoading(false);
        }
    }

    const getIcon = (type: string) => {
        const icons: any = {
            products: Package,
            land: Home,
            certificates: FileText,
            resources: BookOpen,
            courses: GraduationCap,
            export: Container,
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

    const renderDetails = (item: PendingContentItem) => {
        const meta = (item.metadata || {}) as Record<string, any>;
        
        const formatVal = (val: any): string => {
            if (val === null || val === undefined) return "N/A";
            if (typeof val === "boolean") return val ? "Yes" : "No";
            if (typeof val === "object") return JSON.stringify(val);
            return String(val);
        };

        const renderRow = (label: string, value: React.ReactNode) => {
            if (!value || value === "N/A" || value === "No") return null;
            return (
                <div className="flex flex-col sm:flex-row sm:justify-between py-2 border-b border-slate-200/60 last:border-0 text-sm">
                    <span className="font-semibold text-slate-500">{label}</span>
                    <span className="text-slate-800 font-medium sm:text-right">{value}</span>
                </div>
            );
        };

        if (item.type === "land") {
            const loc = (meta.location || {}) as any;
            const address = loc.address || meta.address;
            const lga = loc.lga || meta.lga;
            const state = loc.state || meta.state;
            const fullLocation = [address, lga, state].filter(Boolean).join(", ");
            
            return (
                <div className="space-y-1">
                    {renderRow("Owner Name", meta.ownerName)}
                    {renderRow("Owner Email", meta.ownerEmail)}
                    {renderRow("Size", `${meta.size} ${meta.unit || "acres"}`)}
                    {renderRow("Category", meta.category)}
                    {renderRow("Location", fullLocation || "N/A")}
                    {meta.price !== undefined && Number(meta.price) > 0 && renderRow("Price", `₦${Number(meta.price).toLocaleString()}`)}
                    {renderRow("Escrow Available", meta.escrowAvailable)}
                    {meta.gpsCoordinates && renderRow("GPS Coordinates", `Lat: ${(meta.gpsCoordinates as any).latitude}, Lng: ${(meta.gpsCoordinates as any).longitude}`)}
                    {Array.isArray(meta.images) && meta.images.length > 0 && renderRow("Images Uploaded", `${meta.images.length} image(s)`)}
                    {Array.isArray(meta.documents) && meta.documents.length > 0 && renderRow("Verification Documents", `${meta.documents.length} document(s)`)}
                </div>
            );
        }

        if (item.type === "products") {
            const priceTiers = meta.pricingTiers as any[];
            const priceDisplay = Array.isArray(priceTiers) ? (
                <div className="space-y-1 text-xs">
                    {priceTiers.map((t, idx) => (
                        <div key={idx} className="bg-slate-200/50 px-2.5 py-1.5 rounded-lg text-slate-700">
                            <span className="font-semibold capitalize">{t.type}:</span> ₦{Number(t.price).toLocaleString()} (Min Qty: {t.minQuantity})
                        </div>
                    ))}
                </div>
            ) : meta.price ? `₦${Number(meta.price).toLocaleString()}` : "N/A";

            return (
                <div className="space-y-1">
                    {renderRow("Seller Name", meta.sellerName || meta.sellerId)}
                    {renderRow("Category", meta.category)}
                    {renderRow("Available Stock", `${meta.availableQuantity || meta.quantity || 0} ${meta.unit || "units"}`)}
                    {renderRow("Minimum Order Qty", meta.minOrderQuantity)}
                    {renderRow("Pricing", priceDisplay)}
                    {(() => {
                        let locationDisplay = "N/A";
                        if (meta.state) {
                            locationDisplay = typeof meta.state === "object" ? (meta.state.state || meta.state.name || "N/A") : String(meta.state);
                        } else if (meta.location) {
                            if (typeof meta.location === "object" && meta.location !== null) {
                                const lga = meta.location.lga || "";
                                const state = meta.location.state || "";
                                locationDisplay = [lga, state].filter(Boolean).join(", ") || "N/A";
                            } else {
                                locationDisplay = String(meta.location);
                            }
                        }
                        return renderRow("Location/State", locationDisplay);
                    })()}
                    {renderRow("Delivery Method", meta.deliveryMethod)}
                    {renderRow("Est. Delivery Days", meta.estDeliveryDays)}
                </div>
            );
        }

        if (item.type === "export") {
            const priceTiers = meta.pricingTiers as any[];
            const priceDisplay = Array.isArray(priceTiers) ? (
                <div className="space-y-1 text-xs">
                    {priceTiers.map((t, idx) => (
                        <div key={idx} className="bg-slate-200/50 px-2.5 py-1.5 rounded-lg text-slate-700">
                            <span className="font-semibold capitalize">{t.type}:</span> ₦{Number(t.price).toLocaleString()} (Min Qty: {t.minQuantity})
                        </div>
                    ))}
                </div>
            ) : meta.price ? `₦${Number(meta.price).toLocaleString()}` : "N/A";

            return (
                <div className="space-y-1">
                    {renderRow("Exporter ID", meta.userId)}
                    {renderRow("Category", meta.category)}
                    {renderRow("Available Stock", `${meta.availableQuantity || meta.quantity || 0} ${meta.unit || "units"}`)}
                    {renderRow("Pricing", priceDisplay)}
                    {renderRow("Origin Port", meta.originPort || meta.port)}
                    {renderRow("Packaging", meta.packaging)}
                    {meta.specifications && typeof meta.specifications === "object" && (
                        <div className="py-2 border-b border-slate-200/60 last:border-0 text-sm">
                            <span className="font-semibold text-slate-500 block mb-1">Specifications</span>
                            <div className="grid grid-cols-2 gap-2 text-xs font-medium">
                                {Object.entries(meta.specifications).map(([k, v]) => (
                                    <div key={k} className="bg-slate-100 p-2 rounded">
                                        <span className="text-slate-400 block capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
                                        <span className="text-slate-700">{formatVal(v)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div className="space-y-1">
                {Object.entries(meta).map(([key, val]) => {
                    if (key === "id" || key === "createdAt" || key === "updatedAt") return null;
                    const label = key
                        .replace(/([A-Z])/g, " $1")
                        .replace(/^./, (str) => str.toUpperCase());
                    return renderRow(label, formatVal(val));
                })}
            </div>
        );
    };

    const filteredItems = items.filter(item => {
        if (contentFilter !== "all" && item.type !== contentFilter) return false;
        return true;
    });

    const getEmptyStateText = () => {
        switch (activeStatusFilter) {
            case "approved":
                return "No approved content matches this filter.";
            case "rejected":
                return "No rejected content matches this filter.";
            default:
                return "No pending content to review at the moment.";
        }
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

                {/* Stats / Interactive Status Tabs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <button
                        onClick={() => {
                            setActiveStatusFilter("pending");
                            setSelectedItem(null);
                        }}
                        className={`p-6 rounded-xl border text-left transition hover:shadow-md hover:-translate-y-0.5 cursor-pointer ${
                            activeStatusFilter === "pending"
                                ? "bg-yellow-50/80 border-yellow-300 ring-2 ring-yellow-400/20 shadow-xs"
                                : "bg-white border-slate-200 hover:border-slate-300"
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-semibold text-yellow-700 mb-1">Pending Review</p>
                                <p className="text-3xl font-bold text-yellow-900">{stats.pending}</p>
                            </div>
                            <Clock className={`w-12 h-12 transition ${activeStatusFilter === "pending" ? "text-yellow-600 opacity-80" : "text-slate-400 opacity-45"}`} />
                        </div>
                        <p className="text-xs text-yellow-600 mt-2 font-medium">Click to view pending items →</p>
                    </button>

                    <button
                        onClick={() => {
                            setActiveStatusFilter("approved");
                            setSelectedItem(null);
                        }}
                        className={`p-6 rounded-xl border text-left transition hover:shadow-md hover:-translate-y-0.5 cursor-pointer ${
                            activeStatusFilter === "approved"
                                ? "bg-green-50/80 border-green-300 ring-2 ring-green-400/20 shadow-xs"
                                : "bg-white border-slate-200 hover:border-slate-300"
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-semibold text-green-700 mb-1">Approved</p>
                                <p className="text-3xl font-bold text-green-900">{stats.approved}</p>
                            </div>
                            <CheckCircle className={`w-12 h-12 transition ${activeStatusFilter === "approved" ? "text-green-600 opacity-80" : "text-slate-400 opacity-45"}`} />
                        </div>
                        <p className="text-xs text-green-600 mt-2 font-medium">Click to view approved items →</p>
                    </button>

                    <button
                        onClick={() => {
                            setActiveStatusFilter("rejected");
                            setSelectedItem(null);
                        }}
                        className={`p-6 rounded-xl border text-left transition hover:shadow-md hover:-translate-y-0.5 cursor-pointer ${
                            activeStatusFilter === "rejected"
                                ? "bg-red-50/80 border-red-300 ring-2 ring-red-400/20 shadow-xs"
                                : "bg-white border-slate-200 hover:border-slate-300"
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-semibold text-red-700 mb-1">Rejected</p>
                                <p className="text-3xl font-bold text-red-900">{stats.rejected}</p>
                            </div>
                            <XCircle className={`w-12 h-12 transition ${activeStatusFilter === "rejected" ? "text-red-600 opacity-80" : "text-slate-400 opacity-45"}`} />
                        </div>
                        <p className="text-xs text-red-600 mt-2 font-medium">Click to view rejected items →</p>
                    </button>
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
                                onChange={(e) => handleContentFilterChange(e.target.value as ContentType | "all")}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                            >
                                <option value="all">All Content</option>
                                <option value="products">Marketplace Products</option>
                                <option value="land">Land Listings</option>
                                <option value="export">Export Catalog</option>
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
                                {getEmptyStateText()}
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200">
                            {filteredItems.map((item) => (
                                <div
                                    key={item.id}
                                    className={`p-6 hover:bg-slate-50 transition cursor-pointer ${selectedItem?.id === item.id ? 'bg-blue-50/50' : ''}`}
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
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                                                <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                                                        Listing Attributes
                                                    </h4>
                                                    <div className="divide-y divide-slate-100">
                                                        {renderDetails(item)}
                                                    </div>
                                                </div>
                                                <div className="flex flex-col justify-end gap-3">
                                                    {activeStatusFilter === "pending" ? (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleApprove(item); }}
                                                                disabled={actionLoading}
                                                                className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl transition font-medium flex items-center justify-center gap-2 shadow-lg shadow-green-900/20 cursor-pointer"
                                                            >
                                                                {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                                                                Approve Request
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleReject(item); }}
                                                                disabled={actionLoading}
                                                                className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl transition font-medium flex items-center justify-center gap-2 shadow-lg shadow-red-900/20 cursor-pointer"
                                                            >
                                                                {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5" />}
                                                                Reject Request
                                                            </button>
                                                        </>
                                                    ) : activeStatusFilter === "approved" ? (
                                                        <div className="bg-green-50 border border-green-200 text-green-800 p-5 rounded-xl flex flex-col gap-2 shadow-xs">
                                                            <div className="flex items-center gap-2 text-green-700 font-semibold">
                                                                <CheckCircle className="w-5 h-5" />
                                                                <span>Listing is Live</span>
                                                            </div>
                                                            <p className="text-sm text-green-600 leading-relaxed">
                                                                This content has been fully verified and approved. It is currently active and visible to all users.
                                                            </p>
                                                            {typeof item.metadata?.approvedAt === "string" && (
                                                                <p className="text-xs text-green-500 mt-2 font-medium">
                                                                    Approved on {new Date(item.metadata.approvedAt).toLocaleDateString()}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="bg-red-50 border border-red-200 text-red-800 p-5 rounded-xl flex flex-col gap-2 shadow-xs">
                                                            <div className="flex items-center gap-2 text-red-700 font-semibold">
                                                                <XCircle className="w-5 h-5" />
                                                                <span>Listing Rejected</span>
                                                            </div>
                                                            <p className="text-sm leading-relaxed">
                                                                <span className="font-semibold">Rejection Reason: </span>
                                                                <span className="italic text-red-700">
                                                                    "{item.metadata?.rejectionReason as string || item.metadata?.verificationNotes as string || "No specific reason provided."}"
                                                                </span>
                                                            </p>
                                                            {typeof item.metadata?.rejectedAt === "string" && (
                                                                <p className="text-xs text-red-500 mt-2 font-medium">
                                                                    Rejected on {new Date(item.metadata.rejectedAt).toLocaleDateString()}
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
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
