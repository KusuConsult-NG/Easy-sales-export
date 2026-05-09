"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { logger } from '@/lib/logger';
import {
    Store, CheckCircle, XCircle, Clock, Search,
    Eye, FileText, MapPin, CreditCard, Ban, Download, Pencil, X, Save, Loader2,
    BadgeCheck, BadgeX
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot, Unsubscribe } from "firebase/firestore";
import RejectionModal from "@/components/admin/RejectionModal";
import DynamicDetailModal from "@/components/admin/DynamicDetailModal";
import { useAdminData } from "@/hooks/useAdminData";
import { editApplicationAction, toggleVerifiedBadgeAction, getStandardSellerVerificationsAction, getAdminSellerStatsAction } from "@/app/actions/admin";
import { formatLocalDate } from "@/lib/date-utils";

import { StandardPendingForm } from "@/lib/types/admin";
import DateRangeFilter, { type DateRange } from "@/components/admin/DateRangeFilter";

type SellerVerification = {
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    businessName: string;
    businessType: string;
    businessDescription: string;
    phone: string;
    email: string;
    address: string;
    state: string;
    lga: string;
    documents: { businessDoc: string; idDoc: string; addressProof: string; };
    bankDetails: { bankName: string; accountNumber: string; accountName: string; };
    status: "pending" | "approved" | "rejected" | "suspended";
    rejectionReason?: string;
    createdAt: Date;
    approvedBy?: string;
    approvedAt?: Date;
    // Phase 12 new fields
    sellerCategory?: "wholesale" | "retail";
    isVerifiedBadge?: boolean;
    allowsPaymentOnDelivery?: boolean;
};

type FilterType = "all" | "pending" | "approved" | "rejected";

export default function AdminSellersPage() {
    const { showToast } = useToast();
    const [dateRange, setDateRange] = useState<DateRange>({ from: "", to: "" });
    
    const {
        data: verifications,
        loading: isLoading,
        error: fetchError,
        search: searchQuery,
        setSearch: setSearchQuery,
        filters,
        updateFilter,
        hasMore,
        setData: setVerifications,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: loadVerifications
    } = useAdminData<StandardPendingForm<SellerVerification>>({
        fetchAction: async (opts) => {
            return getStandardSellerVerificationsAction(
                (opts.status as FilterType) || "all",
                opts.lastDocId,
                opts.limit || 50,
                opts.sortOrder as "asc" | "desc",
                dateRange.from || undefined,
                dateRange.to || undefined
            );
        },
        limit: 50,
        dependencies: [dateRange]
    });

    const filterStatus = (filters.status as FilterType) || "all";
    const [selectedVerification, setSelectedVerification] = useState<StandardPendingForm<SellerVerification> | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isRawDetailsOpen, setIsRawDetailsOpen] = useState(false);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectionMode, setRejectionMode] = useState<"reject" | "suspend">("reject");
    const [rejectionTargetId, setRejectionTargetId] = useState<string | null>(null);

    // Edit modal state
    const [editingVerification, setEditingVerification] = useState<SellerVerification | null>(null);
    const [editDraft, setEditDraft] = useState<Record<string, string>>({});
    const [editNote, setEditNote] = useState("");
    const [editSaving, setEditSaving] = useState(false);

    // Badge toggle state
    const [isBadgeProcessing, setIsBadgeProcessing] = useState(false);

    // Server-side stats
    const [serverStats, setServerStats] = useState<{ total: number; pending: number; approved: number; rejected: number } | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);
    useEffect(() => {
        getAdminSellerStatsAction().then((res) => {
            if (res.success && res.data) setServerStats(res.data);
        }).finally(() => setStatsLoading(false));
    }, []);

    // Note: useAdminData already applies local search text filters
    const filteredVerifications = verifications;

    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [exportConfig, setExportConfig] = useState({
        status: "all",
        limit: 5000,
    });
    const [isExporting, setIsExporting] = useState(false);

    async function handleExportCSV(config: typeof exportConfig) {
        setIsExportModalOpen(false);
        setIsExporting(true);
        showToast("Preparing export...", "info");
        try {
            const result = await getStandardSellerVerificationsAction(
                config.status as FilterType, 
                undefined, 
                config.limit,
                undefined,
                dateRange.from || undefined,
                dateRange.to || undefined
            );
            if (!result || !result.success || !result.data || result.data.length === 0) {
                showToast("No data available to export", "error");
                return;
            }

            let exportData = result.data as StandardPendingForm<SellerVerification>[];

            if (searchQuery) {
                const s = searchQuery.toLowerCase();
                exportData = exportData.filter(v => 
                    v.data.businessName?.toLowerCase().includes(s) ||
                    (v.data.email || v.user.email)?.toLowerCase().includes(s) ||
                    v.data.phone?.toLowerCase().includes(s)
                );
            }

            const headers = [
                "Business Name", "Business Type", "Owner Name", "Email", "Phone",
                "State", "LGA", "Address", "Bank Name", "Account Number", "Account Name",
                "Status", "Applied Date"
            ];
            const rows = exportData.map(v => [
                v.data.businessName || "", v.data.businessType || "",
                v.user.name || "", v.user.email || "", v.data.phone || "",
                v.data.state || "", v.data.lga || "", v.data.address || "",
                v.data.bankDetails?.bankName || "", v.data.bankDetails?.accountNumber || "", v.data.bankDetails?.accountName || "",
                v.status, formatLocalDate(v.data.createdAt || Date.now())
            ]);
            const csv = [
                headers.join(","),
                ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
            ].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `seller_verifications_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
            showToast("Export successful", "success");
        } catch (error) {
            logger.error("Export CSV error:", error);
            showToast("Failed to initiate export", "error");
        } finally {
            setIsExporting(false);
        }
    }

    async function handleApprove(verificationId: string) {
        if (!confirm("Approve this seller?")) return;
        setProcessingId(verificationId + "_approve");
        try {
            const response = await fetch("/api/admin/marketplace/approve-seller", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationId }),
            });
            const data = await response.json();
            if (data.success) {
                showToast("Seller approved successfully!", "success");
                setIsDetailsModalOpen(false);
                await loadVerifications();
            } else {
                showToast(data.message || "Failed to approve seller", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setProcessingId(null);
        }
    };

    function handleReject(verificationId: string) {
        setRejectionTargetId(verificationId);
        setRejectionMode("reject");
        setRejectionModalOpen(true);
    };

    function handleSuspend(verificationId: string) {
        setRejectionTargetId(verificationId);
        setRejectionMode("suspend");
        setRejectionModalOpen(true);
    };

    async function handleConfirmRejection(reason: string) {
        if (!rejectionTargetId) return;
        setRejectionModalOpen(false);
        setProcessingId(rejectionTargetId + (rejectionMode === "reject" ? "_reject" : "_suspend"));
        try {
            const endpoint = rejectionMode === "reject"
                ? "/api/admin/marketplace/reject-seller"
                : "/api/admin/marketplace/suspend-seller";
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationId: rejectionTargetId, reason }),
            });
            const data = await response.json();
            if (data.success) {
                showToast(rejectionMode === "reject" ? "Seller verification rejected" : "Seller suspended", "success");
                setIsDetailsModalOpen(false);
                await loadVerifications();
            } else {
                showToast(data.message || "Operation failed", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setProcessingId(null);
            setRejectionTargetId(null);
        }
    };

    function handleOpenEdit(standardApp: StandardPendingForm<SellerVerification>) {
        const v = standardApp.data;
        setEditingVerification(v);
        setEditDraft({
            businessName: v.businessName || "",
            phone: v.phone || "",
            address: v.address || "",
            state: v.state || "",
            lga: v.lga || "",
        });
        setEditNote("");
    };

    async function handleSaveEdit() {
        if (!editingVerification) return;
        setEditSaving(true);
        const result = await editApplicationAction({
            collection: "seller_verifications",
            docId: editingVerification.id,
            fields: editDraft as any,
            editNote: editNote || undefined,
        });
        if (result.success) {
            showToast("Seller updated with audit trail.", "success");
            setEditingVerification(null);
            await loadVerifications();
        } else {
            showToast(result.error || "Failed to update seller", "error");
        }
        setEditSaving(false);
    };

    async function handleToggleBadge(verification: SellerVerification) {
        if (verification.status !== "approved") {
            showToast("Only approved sellers can receive a Verified Badge", "error");
            return;
        }
        const action = verification.isVerifiedBadge ? "revoke" : "grant";
        if (!confirm(`${action === "grant" ? "Grant" : "Revoke"} Verified Badge for ${verification.businessName}?`)) return;
        setIsBadgeProcessing(true);
        try {
            const result = await toggleVerifiedBadgeAction(verification.id);
            if (result.success) {
                showToast(result.message || `Badge ${action}ed`, "success");
                await loadVerifications();
            } else {
                showToast(result.error || "Failed to update badge", "error");
            }
        } catch {
            showToast("An error occurred", "error");
        } finally {
            setIsBadgeProcessing(false);
        }
    };

    const stats = {
        total: serverStats?.total ?? verifications.length,
        pending: serverStats?.pending ?? verifications.filter(v => v.status === "pending").length,
        approved: serverStats?.approved ?? verifications.filter(v => v.status === "approved").length,
        rejected: serverStats?.rejected ?? verifications.filter(v => v.status === "rejected").length,
    };

    return (
        <div className="p-8">
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Seller Verifications</h1>
                    <p className="text-slate-600">Review and manage marketplace seller verification requests</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-slate-500">Live</span>
                </div>
                <button
                    onClick={() => {
                        setExportConfig({
                            status: filters.status || "all",
                            limit: 5000
                        });
                        setIsExportModalOpen(true);
                    }}
                    disabled={isExporting}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                >
                    {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {isExporting ? "Preparing Export..." : `Export CSV (${stats.total}+)`}
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                {[
                    { label: "Total Requests", value: stats.total, icon: Store, colorBg: "bg-blue-100", colorText: "text-blue-600" },
                    { label: "Pending Review", value: stats.pending, icon: Clock, colorBg: "bg-yellow-100", colorText: "text-yellow-600" },
                    { label: "Approved", value: stats.approved, icon: CheckCircle, colorBg: "bg-green-100", colorText: "text-green-600" },
                    { label: "Rejected", value: stats.rejected, icon: XCircle, colorBg: "bg-red-100", colorText: "text-red-600" },
                ].map(({ label, value, icon: Icon, colorBg, colorText }) => (
                    <div key={label} className="bg-white rounded-xl p-6 shadow-lg">
                        <div className="flex items-center gap-3 mb-2">
                            <div className={`w-10 h-10 ${colorBg} rounded-lg flex items-center justify-center`}>
                                <Icon className={`w-5 h-5 ${colorText}`} />
                            </div>
                            <p className="text-sm text-slate-600">{label}</p>
                        </div>
                        {statsLoading
                            ? <Loader2 className="w-5 h-5 animate-spin text-slate-400 mt-1" />
                            : <p className="text-3xl font-bold text-slate-900">{value}</p>
                        }
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl p-6 shadow-lg mb-6">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search by business name, email, or phone..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                    <div className="flex gap-2">
                        {(["all", "pending", "approved", "rejected"] as FilterType[]).map((status) => (
                            <button
                                key={status}
                                onClick={() => updateFilter("status", status)}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${filterStatus === status ? "bg-primary text-white" : "bg-slate-100 text-slate-900 hover:bg-slate-200"}`}
                            >
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                            </button>
                        ))}
                        <select
                            value={filters.sortOrder || "desc"}
                            onChange={(e) => updateFilter("sortOrder", e.target.value)}
                            className="px-4 py-2 bg-slate-100 text-slate-900 border-none rounded-lg focus:ring-2 focus:ring-primary outline-none"
                        >
                            <option value="desc">Newest First</option>
                            <option value="asc">Oldest First</option>
                        </select>
                        <DateRangeFilter
                            value={dateRange}
                            onChange={setDateRange}
                            label="Filter Date"
                        />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600">Loading verifications...</p>
                    </div>
                ) : filteredVerifications.length === 0 ? (
                    <div className="p-12 text-center">
                        <Store className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">No Seller Verifications Found</h3>
                        <p className="text-slate-600">{searchQuery || filterStatus !== "all" ? "Try adjusting filters" : "No requests submitted yet"}</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {["Business", "Contact", "Location", "Status", "Applied", "Actions"].map(h => (
                                        <th key={h} className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {filteredVerifications.map((standardV) => {
                                    const v = standardV.data;
                                    return(
                                    <tr key={standardV.id} className="hover:bg-slate-50">
                                        <td className="px-6 py-4">
                                            <p className="font-semibold text-slate-900">{v.businessName}</p>
                                            <p className="text-sm text-slate-500 capitalize">{v.businessType}</p>
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                {v.sellerCategory && (
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${v.sellerCategory === "wholesale"
                                                        ? "bg-blue-100 text-blue-700"
                                                        : "bg-emerald-100 text-emerald-700"
                                                        }`}>
                                                        {v.sellerCategory === "wholesale" ? "Wholesale" : "Retail"}
                                                    </span>
                                                )}
                                                {v.isVerifiedBadge && (
                                                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 flex items-center gap-0.5">
                                                        ✓ Verified
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-sm text-slate-900">{v.phone}</p>
                                            <p className="text-sm text-slate-500">{v.email || standardV.user.email}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-sm text-slate-900">{v.state}</p>
                                            <p className="text-sm text-slate-500">{v.lga}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${standardV.status === "pending" ? "bg-yellow-100 text-yellow-700"
                                                : standardV.status === "approved" ? "bg-green-100 text-green-700"
                                                    : "bg-red-100 text-red-700"
                                                }`}>
                                                {standardV.status.charAt(0).toUpperCase() + standardV.status.slice(1)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-600">
                                            {formatLocalDate(v.createdAt || Date.now())}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                {standardV.status === "pending" && (
                                                    <>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleApprove(standardV.id); }}
                                                            disabled={!!processingId}
                                                            className="text-slate-400 hover:text-green-600 transition p-1.5 hover:bg-green-50 rounded disabled:opacity-50"
                                                            title="Approve Seller"
                                                        >
                                                            {processingId === standardV.id + "_approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleReject(standardV.id); }}
                                                            disabled={!!processingId}
                                                            className="text-slate-400 hover:text-red-600 transition p-1.5 hover:bg-red-50 rounded disabled:opacity-50"
                                                            title="Reject Seller"
                                                        >
                                                            {processingId === standardV.id + "_reject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    onClick={() => { setSelectedVerification(standardV); setIsDetailsModalOpen(true); }}
                                                    className="text-primary hover:text-primary/80 font-medium flex items-center gap-1 p-1.5 hover:bg-slate-50 rounded transition-colors"
                                                >
                                                    <Eye className="w-4 h-4" /> View Details
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    </div>
                )}
                
                {/* Pagination Controls */}
                {filteredVerifications.length > 0 && (
                    <div className="flex items-center justify-between mt-4 p-4 border-t border-slate-200">
                        <span className="text-sm font-medium text-slate-500">Page {pageIndex + 1}</span>
                        <div className="flex gap-2">
                            <button
                                onClick={onPrevPage}
                                disabled={pageIndex === 0 || isLoading}
                                className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
                            >
                                Previous
                            </button>
                            <button
                                onClick={onNextPage}
                                disabled={!hasMore || isLoading}
                                className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition flex items-center gap-2"
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : "Next Page"}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Details Modal */}
            {isDetailsModalOpen && selectedVerification && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200">
                            <h2 className="text-2xl font-bold text-slate-900">Seller Verification Details</h2>
                        </div>
                        <div className="p-6 space-y-6">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                                    <Store className="w-5 h-5" /> Business Information
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><p className="text-sm text-slate-600">Business Name</p><p className="font-semibold">{selectedVerification.data.businessName}</p></div>
                                    <div><p className="text-sm text-slate-600">Type</p><p className="font-semibold capitalize">{selectedVerification.data.businessType}</p></div>
                                    <div className="col-span-2"><p className="text-sm text-slate-600">Description</p><p className="text-slate-900">{selectedVerification.data.businessDescription}</p></div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                                    <MapPin className="w-5 h-5" /> Contact & Location
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><p className="text-sm text-slate-600">Phone</p><p className="font-semibold">{selectedVerification.data.phone}</p></div>
                                    <div><p className="text-sm text-slate-600">Email</p><p className="font-semibold">{selectedVerification.data.email || selectedVerification.user.email}</p></div>
                                    <div className="col-span-2"><p className="text-sm text-slate-600">Address</p><p className="text-slate-900">{selectedVerification.data.address}</p></div>
                                    <div><p className="text-sm text-slate-600">State</p><p className="font-semibold">{selectedVerification.data.state}</p></div>
                                    <div><p className="text-sm text-slate-600">LGA</p><p className="font-semibold">{selectedVerification.data.lga}</p></div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                                    <CreditCard className="w-5 h-5" /> Bank Details
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><p className="text-sm text-slate-600">Bank</p><p className="font-semibold">{selectedVerification.data.bankDetails?.bankName || "N/A"}</p></div>
                                    <div><p className="text-sm text-slate-600">Account No</p><p className="font-semibold">{selectedVerification.data.bankDetails?.accountNumber || "N/A"}</p></div>
                                    <div className="col-span-2"><p className="text-sm text-slate-600">Account Name</p><p className="font-semibold">{selectedVerification.data.bankDetails?.accountName || "N/A"}</p></div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                                    <FileText className="w-5 h-5" /> Documents
                                </h3>
                                <div className="space-y-2 text-sm text-slate-600">
                                    <p>• Business: {selectedVerification.data.documents?.businessDoc || "Not uploaded"}</p>
                                    <p>• ID: {selectedVerification.data.documents?.idDoc || "Not uploaded"}</p>
                                    <p>• Address Proof: {selectedVerification.data.documents?.addressProof || "Not uploaded"}</p>
                                </div>
                            </div>
                            {selectedVerification.data.rejectionReason && (
                                <div className="p-4 bg-red-50 rounded-lg">
                                    <p className="text-sm font-semibold text-red-900 mb-1">Rejection Reason:</p>
                                    <p className="text-sm text-red-700">{selectedVerification.data.rejectionReason}</p>
                                </div>
                            )}
                        </div>
                        <div className="p-6 border-t border-slate-200 flex gap-4">
                            {selectedVerification.status === "pending" && (
                                <>
                                    <button onClick={() => handleApprove(selectedVerification.id)} disabled={!!processingId}
                                        className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                                        {processingId === selectedVerification.id + "_approve" ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                                        Approve Seller
                                    </button>
                                    <button onClick={() => handleReject(selectedVerification.id)} disabled={!!processingId}
                                        className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                                        {processingId === selectedVerification.id + "_reject" ? <Loader2 className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5" />}
                                        Reject
                                    </button>
                                </>
                            )}
                            {selectedVerification.status === "approved" && (
                                <>
                                    <button onClick={() => handleSuspend(selectedVerification.id)} disabled={!!processingId}
                                        className="px-5 py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2">
                                        {processingId === selectedVerification.id + "_suspend" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                                        Suspend
                                    </button>
                                    {/* Verified Badge Toggle */}
                                    <button
                                        onClick={() => handleToggleBadge(selectedVerification.data)}
                                        disabled={isBadgeProcessing}
                                        className={`px-5 py-3 font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 ${selectedVerification.data.isVerifiedBadge
                                                ? "bg-amber-50 border border-amber-300 text-amber-700 hover:bg-amber-100"
                                                : "bg-amber-500 hover:bg-amber-600 text-white"
                                            }`}
                                    >
                                        {isBadgeProcessing
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : selectedVerification.data.isVerifiedBadge
                                                ? <BadgeX className="w-4 h-4" />
                                                : <BadgeCheck className="w-4 h-4" />
                                        }
                                        {selectedVerification.data.isVerifiedBadge ? "Revoke Badge" : "Grant Badge"}
                                    </button>
                                </>
                            )}
                            <button onClick={() => handleOpenEdit(selectedVerification)}
                                className="px-5 py-3 bg-blue-50 border border-blue-200 text-blue-700 font-bold rounded-xl hover:bg-blue-100 transition-all flex items-center gap-2">
                                <Pencil className="w-4 h-4" /> Edit
                            </button>
                            <button onClick={() => setIsRawDetailsOpen(true)}
                                className="px-5 py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all flex items-center gap-2">
                                <Eye className="w-4 h-4" /> Full Details
                            </button>
                            <button onClick={() => setIsDetailsModalOpen(false)}
                                className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-900 font-bold rounded-xl transition-all">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Raw Details Modal */}
            {selectedVerification && (
                <DynamicDetailModal 
                    isOpen={isRawDetailsOpen}
                    onClose={() => setIsRawDetailsOpen(false)}
                    title={`Raw Seller Data: ${selectedVerification.data.businessName}`}
                    data={selectedVerification.data}
                />
            )}

            {/* Rejection / Suspension Modal */}
            <RejectionModal
                isOpen={rejectionModalOpen}
                onClose={() => { setRejectionModalOpen(false); setRejectionTargetId(null); }}
                onConfirm={handleConfirmRejection}
                title={rejectionMode === "reject" ? "Reject Seller Verification" : "Suspend Seller"}
                description={rejectionMode === "reject"
                    ? "The seller will be notified of this rejection with the reason below."
                    : "The seller's account will be suspended. Please provide a reason."
                }
                isProcessing={!!processingId}
            />
            {/* Edit Seller Modal */}
            {editingVerification && (
                <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">Edit Seller Verification</h2>
                                <p className="text-sm text-slate-500 mt-0.5">Changes are logged with a full audit trail</p>
                            </div>
                            <button onClick={() => setEditingVerification(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {([
                                { key: "businessName", label: "Business Name" },
                                { key: "phone", label: "Phone" },
                                { key: "residentialAddress", label: "Address" },
                                { key: "stateOfOrigin", label: "State" },
                                { key: "lga", label: "LGA" },
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
                                <input type="text" value={editNote} onChange={(e) => setEditNote(e.target.value)}
                                    placeholder="Reason for this edit..." className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button onClick={() => setEditingVerification(null)} disabled={editSaving} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition disabled:opacity-50">Cancel</button>
                            <button onClick={handleSaveEdit} disabled={editSaving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2">
                                {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isExportModalOpen && (
                <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                                <Download className="w-5 h-5 text-blue-600" /> Export Sellers
                            </h3>
                            <button onClick={() => setIsExportModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">Status Filter</label>
                                <select
                                    value={exportConfig.status}
                                    onChange={(e) => setExportConfig(c => ({ ...c, status: e.target.value as any }))}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm"
                                >
                                    <option value="all">All Statuses</option>
                                    <option value="pending">Pending</option>
                                    <option value="approved">Approved</option>
                                    <option value="rejected">Rejected</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">Export Limit</label>
                                <select
                                    value={exportConfig.limit}
                                    onChange={(e) => setExportConfig(c => ({ ...c, limit: Number(e.target.value) }))}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm"
                                >
                                    <option value={5000}>All Available (Up to 5,000)</option>
                                    <option value={1000}>Latest 1,000</option>
                                    <option value={500}>Latest 500</option>
                                    <option value={100}>Latest 100</option>
                                </select>
                                <p className="text-xs text-slate-500 mt-2">
                                    The active search term "{searchQuery || 'none'}" will also be applied to this export.
                                </p>
                            </div>
                        </div>
                        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button
                                onClick={() => setIsExportModalOpen(false)}
                                className="px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleExportCSV(exportConfig)}
                                disabled={isExporting}
                                className="px-5 py-2 font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition shadow-sm flex items-center gap-2 disabled:opacity-50"
                            >
                                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                Export CSV
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
