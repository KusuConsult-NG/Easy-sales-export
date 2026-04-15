"use client";

import { useEffect, useState, useRef } from "react";
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
import { editApplicationAction, toggleVerifiedBadgeAction } from "@/app/actions/admin";

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
    const [verifications, setVerifications] = useState<SellerVerification[]>([]);
    const [filteredVerifications, setFilteredVerifications] = useState<SellerVerification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState<FilterType>("all");
    const [selectedVerification, setSelectedVerification] = useState<SellerVerification | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const unsubscribeRef = useRef<Unsubscribe | null>(null);
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

    // Real-time listener
    useEffect(() => {
        if (unsubscribeRef.current) unsubscribeRef.current();

        setIsLoading(true);

        const q = query(collection(db, "seller_verifications"), orderBy("createdAt", "desc"));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const docs = snapshot.docs.map((doc) => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        createdAt: data.createdAt?.toDate() || new Date(),
                        approvedAt: data.approvedAt?.toDate(),
                    } as SellerVerification;
                });
                setVerifications(docs);
                setIsLoading(false);
            },
            (err) => {
                logger.error("Seller verifications snapshot error:", err);
                showToast("Failed to load seller verifications", "error");
                setIsLoading(false);
            }
        );

        unsubscribeRef.current = unsubscribe;
        return () => { unsubscribeRef.current?.(); };
    }, [showToast]);

    // Local filter
    useEffect(() => {
        let filtered = verifications;
        if (filterStatus !== "all") filtered = filtered.filter(v => v.status === filterStatus);
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(v =>
                v.businessName?.toLowerCase().includes(q) ||
                v.userName?.toLowerCase().includes(q) ||
                v.userEmail?.toLowerCase().includes(q) ||
                v.phone?.toLowerCase().includes(q)
            );
        }
        setFilteredVerifications(filtered);
    }, [verifications, searchQuery, filterStatus]);

    const handleExportCSV = () => {
        if (verifications.length === 0) return;
        const headers = [
            "Business Name", "Business Type", "Owner Name", "Email", "Phone",
            "State", "LGA", "Address", "Bank Name", "Account Number", "Account Name",
            "Status", "Applied Date"
        ];
        const rows = verifications.map(v => [
            v.businessName || "", v.businessType || "",
            v.userName || "", v.email || v.userEmail || "", v.phone || "",
            v.state || "", v.lga || "", v.address || "",
            v.bankDetails?.bankName || "", v.bankDetails?.accountNumber || "", v.bankDetails?.accountName || "",
            v.status, new Date(v.createdAt).toLocaleDateString("en-NG")
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
    };

    const handleApprove = async (verificationId: string) => {
        if (!confirm("Approve this seller?")) return;
        setIsProcessing(true);
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
            } else {
                showToast(data.data?.message || "Failed to approve seller", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = (verificationId: string) => {
        setRejectionTargetId(verificationId);
        setRejectionMode("reject");
        setRejectionModalOpen(true);
    };

    const handleSuspend = (verificationId: string) => {
        setRejectionTargetId(verificationId);
        setRejectionMode("suspend");
        setRejectionModalOpen(true);
    };

    const handleConfirmRejection = async (reason: string) => {
        if (!rejectionTargetId) return;
        setRejectionModalOpen(false);
        setIsProcessing(true);
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
            } else {
                showToast(data.data?.message || "Operation failed", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setIsProcessing(false);
            setRejectionTargetId(null);
        }
    };

    const handleOpenEdit = (v: SellerVerification) => {
        setEditingVerification(v);
        setEditDraft({
            businessName: v.businessName || "",
            phone: v.phone || "",
            residentialAddress: v.address || "",
            stateOfOrigin: v.state || "",
            lga: v.lga || "",
        });
        setEditNote("");
    };

    const handleSaveEdit = async () => {
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
        } else {
            showToast(result.error || "Failed to update seller", "error");
        }
        setEditSaving(false);
    };

    const handleToggleBadge = async (verification: SellerVerification) => {
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
        total: verifications.length,
        pending: verifications.filter(v => v.status === "pending").length,
        approved: verifications.filter(v => v.status === "approved").length,
        rejected: verifications.filter(v => v.status === "rejected").length,
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
                    onClick={handleExportCSV}
                    disabled={verifications.length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                >
                    <Download className="w-4 h-4" /> Export CSV ({verifications.length})
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
                        <p className="text-3xl font-bold text-slate-900">{value}</p>
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
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${filterStatus === status ? "bg-primary text-white" : "bg-slate-100 text-slate-900 hover:bg-slate-200"}`}
                            >
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                            </button>
                        ))}
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
                                {filteredVerifications.map((v) => (
                                    <tr key={v.id} className="hover:bg-slate-50">
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
                                            <p className="text-sm text-slate-500">{v.email}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-sm text-slate-900">{v.state}</p>
                                            <p className="text-sm text-slate-500">{v.lga}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold ${v.status === "pending" ? "bg-yellow-100 text-yellow-700"
                                                : v.status === "approved" ? "bg-green-100 text-green-700"
                                                    : "bg-red-100 text-red-700"
                                                }`}>
                                                {v.status.charAt(0).toUpperCase() + v.status.slice(1)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-600">
                                            {new Date(v.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => { setSelectedVerification(v); setIsDetailsModalOpen(true); }}
                                                className="text-primary hover:text-primary/80 font-medium flex items-center gap-1"
                                            >
                                                <Eye className="w-4 h-4" /> View Details
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
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
                                    <div><p className="text-sm text-slate-600">Business Name</p><p className="font-semibold">{selectedVerification.businessName}</p></div>
                                    <div><p className="text-sm text-slate-600">Type</p><p className="font-semibold capitalize">{selectedVerification.businessType}</p></div>
                                    <div className="col-span-2"><p className="text-sm text-slate-600">Description</p><p className="text-slate-900">{selectedVerification.businessDescription}</p></div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                                    <MapPin className="w-5 h-5" /> Contact & Location
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><p className="text-sm text-slate-600">Phone</p><p className="font-semibold">{selectedVerification.phone}</p></div>
                                    <div><p className="text-sm text-slate-600">Email</p><p className="font-semibold">{selectedVerification.email}</p></div>
                                    <div className="col-span-2"><p className="text-sm text-slate-600">Address</p><p className="text-slate-900">{selectedVerification.address}</p></div>
                                    <div><p className="text-sm text-slate-600">State</p><p className="font-semibold">{selectedVerification.state}</p></div>
                                    <div><p className="text-sm text-slate-600">LGA</p><p className="font-semibold">{selectedVerification.lga}</p></div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                                    <CreditCard className="w-5 h-5" /> Bank Details
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><p className="text-sm text-slate-600">Bank</p><p className="font-semibold">{selectedVerification.bankDetails?.bankName || "N/A"}</p></div>
                                    <div><p className="text-sm text-slate-600">Account No</p><p className="font-semibold">{selectedVerification.bankDetails?.accountNumber || "N/A"}</p></div>
                                    <div className="col-span-2"><p className="text-sm text-slate-600">Account Name</p><p className="font-semibold">{selectedVerification.bankDetails?.accountName || "N/A"}</p></div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                                    <FileText className="w-5 h-5" /> Documents
                                </h3>
                                <div className="space-y-2 text-sm text-slate-600">
                                    <p>• Business: {selectedVerification.documents?.businessDoc || "Not uploaded"}</p>
                                    <p>• ID: {selectedVerification.documents?.idDoc || "Not uploaded"}</p>
                                    <p>• Address Proof: {selectedVerification.documents?.addressProof || "Not uploaded"}</p>
                                </div>
                            </div>
                            {selectedVerification.rejectionReason && (
                                <div className="p-4 bg-red-50 rounded-lg">
                                    <p className="text-sm font-semibold text-red-900 mb-1">Rejection Reason:</p>
                                    <p className="text-sm text-red-700">{selectedVerification.rejectionReason}</p>
                                </div>
                            )}
                        </div>
                        <div className="p-6 border-t border-slate-200 flex gap-4">
                            {selectedVerification.status === "pending" && (
                                <>
                                    <button onClick={() => handleApprove(selectedVerification.id)} disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50">
                                        <CheckCircle className="w-5 h-5 inline mr-2" />Approve Seller
                                    </button>
                                    <button onClick={() => handleReject(selectedVerification.id)} disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50">
                                        <XCircle className="w-5 h-5 inline mr-2" />Reject
                                    </button>
                                </>
                            )}
                            {selectedVerification.status === "approved" && (
                                <>
                                    <button onClick={() => handleSuspend(selectedVerification.id)} disabled={isProcessing}
                                        className="px-5 py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2">
                                        <Ban className="w-4 h-4" />Suspend
                                    </button>
                                    {/* Verified Badge Toggle */}
                                    <button
                                        onClick={() => handleToggleBadge(selectedVerification)}
                                        disabled={isBadgeProcessing}
                                        className={`px-5 py-3 font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2 ${selectedVerification.isVerifiedBadge
                                                ? "bg-amber-50 border border-amber-300 text-amber-700 hover:bg-amber-100"
                                                : "bg-amber-500 hover:bg-amber-600 text-white"
                                            }`}
                                    >
                                        {isBadgeProcessing
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : selectedVerification.isVerifiedBadge
                                                ? <BadgeX className="w-4 h-4" />
                                                : <BadgeCheck className="w-4 h-4" />
                                        }
                                        {selectedVerification.isVerifiedBadge ? "Revoke Badge" : "Grant Badge"}
                                    </button>
                                </>
                            )}
                            <button onClick={() => handleOpenEdit(selectedVerification)}
                                className="px-5 py-3 bg-blue-50 border border-blue-200 text-blue-700 font-bold rounded-xl hover:bg-blue-100 transition-all flex items-center gap-2">
                                <Pencil className="w-4 h-4" /> Edit
                            </button>
                            <button onClick={() => setIsDetailsModalOpen(false)}
                                className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-900 font-bold rounded-xl transition-all">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
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
                isProcessing={isProcessing}
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
        </div>
    );
}
