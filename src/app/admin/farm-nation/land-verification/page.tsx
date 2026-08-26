"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { MapPin, FileText, Check, X, Eye, Loader2, Download, Filter, ClipboardList, Send, Calendar, User, Edit3, Save, RotateCcw } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useAdminData } from "@/hooks/useAdminData";
import { getAdminLandVerificationsAction, getFarmNationVerificationStatsAction, updateAdminLandListingAction } from "@/app/actions/farm-nation-admin";
import { recordExport } from "@/lib/record-export";

type LandVerification = {
    id: string;
    userId: string;
    ownerName: string;
    title: string;
    category: any;
    state: string;
    lga: string;
    size: number;
    unit: string;
    totalPrice: number;
    price?: number;
    gpsCoordinates?: { latitude: number; longitude: number; };
    documents: any;
    images: string[];
    videoUrl?: string;
    verificationStatus: string;
    verificationNotes?: string;
    createdAt: Date;
    verifiedBy?: string;
    verifiedAt?: Date;
    location?: { state: string; lga: string; address: string; };
    address?: string;
};

function getNormalizedDocs(docs: any) {
    if (!docs) return { landTitle: "", surveyPlan: "", taxClearance: "" };
    if (Array.isArray(docs)) {
        const landTitle = docs.find((url: string) => url && (url.includes("_title_") || url.includes("title"))) || docs[0] || "";
        const surveyPlan = docs.find((url: string) => url && (url.includes("_survey_") || url.includes("survey"))) || docs[1] || "";
        const taxClearance = docs.find((url: string) => url && (url.includes("_tax_") || url.includes("tax"))) || docs[2] || undefined;
        return { landTitle, surveyPlan, taxClearance };
    }
    if (typeof docs === "object") {
        return {
            landTitle: docs.landTitle || "",
            surveyPlan: docs.surveyPlan || "",
            taxClearance: docs.taxClearance || undefined
        };
    }
    return { landTitle: "", surveyPlan: "", taxClearance: "" };
}

export default function AdminLandVerificationPage() {
    const { showToast } = useToast();
    
    const {
        data: verifications,
        loading: isLoading,
        error: fetchError,
        filters,
        updateFilter,
        hasMore,
        setData: setVerifications,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: loadVerifications,
        meta
    } = useAdminData<LandVerification>({
        fetchAction: getAdminLandVerificationsAction,
        limit: 50
    });

    const filterStatus = (filters.status as string) || "pending";
    const [selectedVerification, setSelectedVerification] = useState<LandVerification | null>(null);
    const docs = selectedVerification ? getNormalizedDocs(selectedVerification.documents) : { landTitle: "", surveyPlan: "", taxClearance: "" };
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    
    // Edit Land Details State
    const [isEditingDetails, setIsEditingDetails] = useState(false);
    const [editTitle, setEditTitle] = useState("");
    const [editCategory, setEditCategory] = useState("");
    const [editState, setEditState] = useState("");
    const [editLga, setEditLga] = useState("");
    const [editAddress, setEditAddress] = useState("");
    const [editSize, setEditSize] = useState(0);
    const [editUnit, setEditUnit] = useState("");
    const [editPrice, setEditPrice] = useState(0);
    const [editLat, setEditLat] = useState("");
    const [editLng, setEditLng] = useState("");
    const [isSavingDetails, setIsSavingDetails] = useState(false);

    const startEditing = () => {
        if (!selectedVerification) return;
        setEditTitle(selectedVerification.title || "");
        const catVal = Array.isArray(selectedVerification.category)
            ? selectedVerification.category[0] || ""
            : (selectedVerification.category || "");
        setEditCategory(catVal);
        setEditState(selectedVerification.state || "");
        setEditLga(selectedVerification.lga || "");
        setEditAddress(selectedVerification.location?.address || selectedVerification.address || "");
        setEditSize(selectedVerification.size || 0);
        setEditUnit(selectedVerification.unit || "Acres");
        setEditPrice(selectedVerification.totalPrice ?? selectedVerification.price ?? 0);
        setEditLat(selectedVerification.gpsCoordinates?.latitude?.toString() || "");
        setEditLng(selectedVerification.gpsCoordinates?.longitude?.toString() || "");
        setIsEditingDetails(true);
    };

    // Inspector dispatch state
    const [inspectorName, setInspectorName] = useState("");
    const [inspectorDate, setInspectorDate] = useState("");
    const [inspectorNotes, setInspectorNotes] = useState("");
    const [isDispatchingInspector, setIsDispatchingInspector] = useState(false);
    const [activeTab, setActiveTab] = useState<"details" | "inspector">("details");
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewTitle, setPreviewTitle] = useState<string>("");

    useEffect(() => {
        if (!isDetailsModalOpen) {
            setPreviewUrl(null);
            setPreviewTitle("");
            setIsEditingDetails(false);
        }
    }, [isDetailsModalOpen]);

    // Server-side aggregate stats — independent of pagination
    const [serverStats, setServerStats] = useState<{
        total: number; pending: number; verified: number; rejected: number;
    } | null>(null);

    useEffect(() => {
        getFarmNationVerificationStatsAction().then((result) => {
            if (result.success && result.data?.stats) {
                setServerStats(result.data.stats);
            }
        }).catch(() => {});
    }, [verifications]);

    const filteredVerifications = verifications;

    async function handleSaveDetails() {
        if (!selectedVerification) return;
        if (!editTitle.trim()) {
            showToast("Title is required", "error");
            return;
        }
        if (!editState.trim()) {
            showToast("State is required", "error");
            return;
        }
        if (!editLga.trim()) {
            showToast("LGA is required", "error");
            return;
        }
        if (Number(editSize) <= 0) {
            showToast("Size must be positive", "error");
            return;
        }
        if (Number(editPrice) <= 0) {
            showToast("Price must be positive", "error");
            return;
        }

        setIsSavingDetails(true);
        try {
            const gpsCoords = editLat && editLng ? {
                latitude: Number(editLat),
                longitude: Number(editLng)
            } : undefined;

            const result = await updateAdminLandListingAction({
                listingId: selectedVerification.id,
                title: editTitle,
                category: editCategory,
                state: editState,
                lga: editLga,
                address: editAddress,
                size: Number(editSize),
                price: Number(editPrice),
                gpsCoordinates: gpsCoords
            });

            if (result.success) {
                showToast("Land listing details updated successfully", "success");
                
                // Update local states
                const updatedVerification = {
                    ...selectedVerification,
                    title: editTitle,
                    category: editCategory,
                    state: editState,
                    lga: editLga,
                    size: Number(editSize),
                    unit: editUnit,
                    totalPrice: Number(editPrice),
                    price: Number(editPrice),
                    gpsCoordinates: gpsCoords ? { latitude: gpsCoords.latitude, longitude: gpsCoords.longitude } : undefined
                };

                setVerifications(prev => prev.map(v => v.id === selectedVerification.id ? updatedVerification : v));
                setSelectedVerification(updatedVerification);
                setIsEditingDetails(false);
            } else {
                showToast(result.error || "Failed to update details", "error");
            }
        } catch (error) {
            logger.error("Save details error:", error);
            showToast("Failed to update details", "error");
        } finally {
            setIsSavingDetails(false);
        }
    }

    async function handleApprove(verificationId: string) {
        if (!confirm("Approve this land listing? Ensure the inspector report has been reviewed.")) return;
        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/farm-nation/approve-land", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationId }),
            });
            const data = await response.json();
            if (data.success) {
                showToast("Land listing approved!", "success");
                setIsDetailsModalOpen(false);
                loadVerifications();
            } else {
                showToast(data.message || "Failed to approve", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    async function handleDispatchInspector(verificationId: string) {
        if (!inspectorName.trim()) { showToast("Please enter inspector name", "error"); return; }
        if (!inspectorDate) { showToast("Please select inspection date", "error"); return; }
        setIsDispatchingInspector(true);
        try {
            const response = await fetch("/api/admin/farm-nation/dispatch-inspector", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    verificationId,
                    inspectorName: inspectorName.trim(),
                    scheduledDate: inspectorDate,
                    notes: inspectorNotes.trim(),
                }),
            });
            const data = await response.json();
            if (data.success) {
                showToast("Inspector dispatched successfully!", "success");
                setInspectorName(""); setInspectorDate(""); setInspectorNotes("");
                setActiveTab("details");
                loadVerifications();
            } else {
                showToast(data.message || "Failed to dispatch inspector", "error");
            }
        } catch {
            showToast("An error occurred dispatching inspector", "error");
        } finally {
            setIsDispatchingInspector(false);
        }
    }

    async function handleReject(verificationId: string) {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;
        setIsProcessing(true);
        try {
            const response = await fetch("/api/admin/farm-nation/reject-land", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ verificationId, reason }),
            });
            const data = await response.json();
            if (data.success) {
                showToast("Land listing rejected", "success");
                setIsDetailsModalOpen(false);
                loadVerifications();
            } else {
                showToast(data.message || "Failed to reject", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    async function handleExportCSV() {
        if (verifications.length === 0) return;
        
        try {
            showToast("Preparing export...", "success");
            
            // Fetch all items matching the current filter (limit 5000)
            const result = await getAdminLandVerificationsAction({
                limit: 5000,
                status: filters.status
            });

            if (!result.success || !result.data) {
                throw new Error(result.error || "Failed to fetch data for export");
            }

            const exportData = result.data;
            
            const headers = [
                "Owner Name", "Phone", "Title", "Category", "State", "LGA",
                "Size", "Unit", "Total Price (₦)", "GPS Lat", "GPS Lng",
                "Verification Status", "Submitted Date"
            ];
            const rows = exportData.map(v => [
                v.ownerName || "", v.owner?.phone || v.phone || "", v.title || "", v.category || "",
                v.state || "", v.lga || "",
                v.size, v.unit || "", v.totalPrice,
                v.gpsCoordinates?.latitude || "", v.gpsCoordinates?.longitude || "",
                v.verificationStatus || "",
                new Date(v.createdAt).toLocaleDateString("en-NG")
            ]);
            const csv = [
                headers.join(","),
                ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
            ].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `land_verifications_${filterStatus}_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
            // #309 The download is recorded. Fourteen admin screens built a CSV
            // and two of them left a trace; several of these carry BVN, NIN and
            // bank details. recordExport never throws and never blocks.
            recordExport("farm_nation_land_verification");
            showToast("Export downloaded successfully", "success");
        } catch (error: any) {
            console.error("Export error:", error);
            showToast(error.message || "Failed to export data", "error");
        }
    };

    // Use server-side stats when available; fall back to local page counts while loading
    const stats = meta?.stats || serverStats || {
        total:    verifications.length,
        pending:  verifications.filter(v => v.verificationStatus === "pending").length,
        verified: verifications.filter(v => v.verificationStatus === "verified").length,
        rejected: verifications.filter(v => v.verificationStatus === "rejected").length,
    };

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">Land Verification</h1>
                        <p className="text-slate-600">Review and verify land listing submissions</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-xs text-slate-500">Live</span>
                        </div>
                        {/* Temporarily removed Export CSV button */}
                        {/* <button
                            onClick={handleExportCSV}
                            disabled={verifications.length === 0}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                        >
                            <Download className="w-4 h-4" /> Export CSV ({filteredVerifications.length})
                        </button> */}
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    {[
                        { label: "Total Submissions", value: stats.total, color: "text-slate-900" },
                        { label: "Pending Review", value: stats.pending, color: "text-yellow-600" },
                        { label: "Verified", value: stats.verified, color: "text-green-600" },
                        { label: "Rejected", value: stats.rejected, color: "text-red-600" },
                    ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white rounded-xl shadow-lg p-6">
                            <p className="text-sm text-slate-600 mb-1">{label}</p>
                            <p className={`text-3xl font-bold ${color}`}>{value}</p>
                        </div>
                    ))}
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                    <div className="flex items-center gap-4">
                        {[
                            { value: "all", label: "All", activeClass: "bg-primary text-white" },
                            { value: "pending", label: `Pending (${stats.pending})`, activeClass: "bg-yellow-600 text-white" },
                            { value: "verified", label: `Verified (${stats.verified})`, activeClass: "bg-green-600 text-white" },
                            { value: "rejected", label: `Rejected (${stats.rejected})`, activeClass: "bg-red-600 text-white" },
                        ].map(({ value, label, activeClass }) => (
                            <button
                                key={value}
                                onClick={() => updateFilter("status", value)}
                                className={`px-4 py-2 rounded-lg font-semibold transition-all ${filterStatus === value ? activeClass : "bg-slate-100 text-slate-900"}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table */}
                {isLoading ? (
                    <div className="bg-white rounded-xl shadow-lg p-12 text-center">
                        <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                        <p className="text-slate-600">Loading verifications...</p>
                    </div>
                ) : filteredVerifications.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-lg p-12 text-center">
                        <MapPin className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">No Listings Found</h3>
                        <p className="text-slate-600">No {filterStatus !== "all" ? filterStatus : ""} listings available</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50">
                                    <tr>
                                        {["Owner", "Land Title", "Location", "Size", "Price", "Status", "Actions"].map(h => (
                                            <th key={h} className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {filteredVerifications.map((verification) => (
                                        <tr key={verification.id} className="hover:bg-slate-50">
                                            <td className="px-6 py-4">
                                                <p className="font-semibold text-slate-900">{verification.ownerName}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="font-semibold text-slate-900">{verification.title}</p>
                                                <p className="text-sm text-slate-500">
                                                    {Array.isArray(verification.category)
                                                        ? verification.category.map(c => typeof c === 'object' && c ? (c.label || JSON.stringify(c)) : String(c).replace(/_/g, " ")).join(", ")
                                                        : (typeof verification.category === "string"
                                                            ? verification.category.replace(/_/g, " ")
                                                            : (typeof verification.category === "object" && verification.category
                                                                ? (verification.category.label || JSON.stringify(verification.category))
                                                                : String(verification.category || "—").replace(/_/g, " ")))}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm text-slate-900">{verification.state}</p>
                                                <p className="text-xs text-slate-500">{verification.lga}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm font-semibold text-slate-900">{verification.size} {verification.unit}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm font-semibold text-green-600">₦{(verification.totalPrice ?? verification.price ?? 0).toLocaleString()}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${verification.verificationStatus === "pending" ? "bg-yellow-100 text-yellow-700"
                                                    : verification.verificationStatus === "verified" ? "bg-green-100 text-green-700"
                                                        : "bg-red-100 text-red-700"
                                                    }`}>
                                                    {verification.verificationStatus}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    {verification.verificationStatus === "pending" && (
                                                        <>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleApprove(verification.id); }}
                                                                disabled={isProcessing}
                                                                className="text-slate-400 hover:text-green-600 transition p-1.5 hover:bg-green-50 rounded disabled:opacity-50"
                                                                title="Approve"
                                                            >
                                                                <Check className="w-5 h-5" />
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleReject(verification.id); }}
                                                                disabled={isProcessing}
                                                                className="text-slate-400 hover:text-red-600 transition p-1.5 hover:bg-red-50 rounded disabled:opacity-50"
                                                                title="Reject"
                                                            >
                                                                <X className="w-5 h-5" />
                                                            </button>
                                                        </>
                                                    )}
                                                    <button
                                                        onClick={() => { setSelectedVerification(verification); setIsDetailsModalOpen(true); }}
                                                        className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
                                                    >
                                                        <Eye className="w-4 h-4" /> Review
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
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
                )}

                {isDetailsModalOpen && selectedVerification && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
                        <div className={`bg-white rounded-2xl shadow-2xl w-full my-8 transition-all duration-300 ${
                            previewUrl ? "max-w-6xl" : "max-w-4xl"
                        }`}>
                            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-slate-900">Land Verification Details</h2>
                                <button onClick={() => { setIsDetailsModalOpen(false); setActiveTab("details"); }} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            {/* Tab Navigation */}
                            <div className="flex border-b border-slate-200">
                                {(["details", "inspector"] as const).map(tab => (
                                    <button key={tab} onClick={() => setActiveTab(tab)}
                                        className={`flex-1 px-6 py-3 text-sm font-semibold transition capitalize flex items-center justify-center gap-2 ${
                                            activeTab === tab
                                                ? "border-b-2 border-blue-600 text-blue-700 bg-blue-50"
                                                : "text-slate-500 hover:text-slate-800"
                                        }`}>
                                        {tab === "details" ? <MapPin className="w-4 h-4" /> : <ClipboardList className="w-4 h-4" />}
                                        {tab === "details" ? "Property Details" : "Inspector Dispatch"}
                                    </button>
                                ))}
                            </div>

                            <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-[500px]">
                                {/* Left Side: Details */}
                                <div className={`p-6 space-y-6 overflow-y-auto max-h-[60vh] flex-1 transition-all ${
                                    previewUrl ? "lg:max-w-[50%]" : ""
                                }`}>
                                    {activeTab === "details" && (
                                        <>
                                            <section className="bg-slate-50 border border-slate-200 rounded-2xl p-6 relative">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                                        <MapPin className="w-5 h-5 text-blue-600" /> Land Information
                                                    </h3>
                                                    {!isEditingDetails ? (
                                                        <button
                                                            onClick={startEditing}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                                        >
                                                            <Edit3 className="w-3.5 h-3.5" /> Edit Details
                                                        </button>
                                                    ) : (
                                                        <span className="text-xs text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded-full">Editing Mode</span>
                                                    )}
                                                </div>

                                                {!isEditingDetails ? (
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div><p className="text-sm text-slate-600">Title</p><p className="font-semibold text-slate-900">{selectedVerification.title}</p></div>
                                                        <div><p className="text-sm text-slate-600">Category</p><p className="font-semibold text-slate-900 capitalize">
                                                            {Array.isArray(selectedVerification.category)
                                                                ? selectedVerification.category.map(c => typeof c === 'object' && c ? (c.label || JSON.stringify(c)) : String(c).replace(/_/g, " ")).join(", ")
                                                                : (typeof selectedVerification.category === "string"
                                                                    ? selectedVerification.category.replace(/_/g, " ")
                                                                    : (typeof selectedVerification.category === "object" && selectedVerification.category
                                                                        ? (selectedVerification.category.label || JSON.stringify(selectedVerification.category))
                                                                        : String(selectedVerification.category || "—").replace(/_/g, " ")))}
                                                        </p></div>
                                                        <div><p className="text-sm text-slate-600">Location</p><p className="font-semibold text-slate-900">{selectedVerification.state}, {selectedVerification.lga}</p></div>
                                                        <div><p className="text-sm text-slate-600">Size &amp; Price</p><p className="font-semibold text-slate-900">{selectedVerification.size} {selectedVerification.unit} — ₦{(selectedVerification.totalPrice ?? selectedVerification.price ?? 0).toLocaleString()}</p></div>
                                                        {selectedVerification.gpsCoordinates && (
                                                            <div><p className="text-sm text-slate-600">GPS</p><p className="font-semibold text-slate-900">{selectedVerification.gpsCoordinates.latitude.toFixed(6)}, {selectedVerification.gpsCoordinates.longitude.toFixed(6)}</p></div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="space-y-4">
                                                        <div className="grid grid-cols-1 gap-3">
                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">Property Title</label>
                                                                <input
                                                                    type="text"
                                                                    value={editTitle}
                                                                    onChange={e => setEditTitle(e.target.value)}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
                                                                <select
                                                                    value={editCategory}
                                                                    onChange={e => setEditCategory(e.target.value)}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                >
                                                                    <option value="farmland">Farmland</option>
                                                                    <option value="ranch">Ranch</option>
                                                                    <option value="commercial_farm">Commercial Farm</option>
                                                                    <option value="agricultural_land">Agricultural Land</option>
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">Address</label>
                                                                <input
                                                                    type="text"
                                                                    value={editAddress}
                                                                    onChange={e => setEditAddress(e.target.value)}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">State</label>
                                                                <input
                                                                    type="text"
                                                                    value={editState}
                                                                    onChange={e => setEditState(e.target.value)}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">LGA</label>
                                                                <input
                                                                    type="text"
                                                                    value={editLga}
                                                                    onChange={e => setEditLga(e.target.value)}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-3 gap-3">
                                                            <div className="col-span-2">
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">Size</label>
                                                                <input
                                                                    type="number"
                                                                    value={editSize}
                                                                    onChange={e => setEditSize(Number(e.target.value))}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">Unit</label>
                                                                <select
                                                                    value={editUnit}
                                                                    onChange={e => setEditUnit(e.target.value)}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                >
                                                                    <option value="Acres">Acres</option>
                                                                    <option value="Hectares">Hectares</option>
                                                                    <option value="Plots">Plots</option>
                                                                </select>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 gap-3">
                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">Price (₦)</label>
                                                                <input
                                                                    type="number"
                                                                    value={editPrice}
                                                                    onChange={e => setEditPrice(Number(e.target.value))}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">GPS Latitude</label>
                                                                <input
                                                                    type="number"
                                                                    step="any"
                                                                    value={editLat}
                                                                    onChange={e => setEditLat(e.target.value)}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">GPS Longitude</label>
                                                                <input
                                                                    type="number"
                                                                    step="any"
                                                                    value={editLng}
                                                                    onChange={e => setEditLng(e.target.value)}
                                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="flex gap-2 justify-end pt-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => setIsEditingDetails(false)}
                                                                className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                                            >
                                                                <RotateCcw className="w-3.5 h-3.5" /> Cancel
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={handleSaveDetails}
                                                                disabled={isSavingDetails}
                                                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                                                            >
                                                                {isSavingDetails ? (
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                ) : (
                                                                    <Save className="w-3.5 h-3.5" />
                                                                )}
                                                                Save Changes
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </section>
                                            <section>
                                                <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                                                    <FileText className="w-5 h-5" /> Legal Documents
                                                </h3>
                                                <div className="space-y-2">
                                                    {docs.landTitle && (
                                                        <div className="flex items-center justify-between p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition group">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setPreviewUrl(docs.landTitle);
                                                                    setPreviewTitle("Land Title Document");
                                                                }}
                                                                className="flex items-center gap-2 text-left"
                                                            >
                                                                <FileText className="w-5 h-5 text-blue-600" />
                                                                <span className="text-sm font-semibold text-blue-700 group-hover:underline">Land Title Document</span>
                                                            </button>
                                                            <a href={docs.landTitle} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                                                Download
                                                            </a>
                                                        </div>
                                                    )}
                                                    {docs.surveyPlan && (
                                                        <div className="flex items-center justify-between p-3 bg-green-50 hover:bg-green-100 rounded-lg transition group">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setPreviewUrl(docs.surveyPlan);
                                                                    setPreviewTitle("Survey Plan Document");
                                                                }}
                                                                className="flex items-center gap-2 text-left"
                                                            >
                                                                <FileText className="w-5 h-5 text-green-600" />
                                                                <span className="text-sm font-semibold text-green-700 group-hover:underline">Survey Plan Document</span>
                                                            </button>
                                                            <a href={docs.surveyPlan} target="_blank" rel="noopener noreferrer" className="text-xs text-green-600 hover:underline">
                                                                Download
                                                            </a>
                                                        </div>
                                                    )}
                                                    {docs.taxClearance && (
                                                        <div className="flex items-center justify-between p-3 bg-amber-50 hover:bg-amber-100 rounded-lg transition group">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setPreviewUrl(docs.taxClearance!);
                                                                    setPreviewTitle("Tax Clearance Document");
                                                                }}
                                                                className="flex items-center gap-2 text-left"
                                                            >
                                                                <FileText className="w-5 h-5 text-amber-600" />
                                                                <span className="text-sm font-semibold text-amber-700 group-hover:underline">Tax Clearance Document</span>
                                                            </button>
                                                            <a href={docs.taxClearance} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-600 hover:underline">
                                                                Download
                                                            </a>
                                                        </div>
                                                    )}
                                                </div>
                                            </section>
                                            {selectedVerification.verificationNotes && (
                                                <section className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                                    <h3 className="text-sm font-bold text-blue-800 mb-1">Inspector / Verification Notes</h3>
                                                    <p className="text-sm text-blue-700 whitespace-pre-line">{selectedVerification.verificationNotes}</p>
                                                </section>
                                            )}
                                        </>
                                    )}

                                    {activeTab === "inspector" && (
                                        <div className="space-y-5">
                                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                                                <p className="text-sm font-semibold text-amber-800">🔍 Inspector Dispatch</p>
                                                <p className="text-xs text-amber-700 mt-1">Assign a field inspector to visit and confirm the GPS coordinates, land boundaries, and document authenticity before final approval.</p>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                                                    <User className="w-4 h-4 inline mr-1" />Inspector Name <span className="text-red-500">*</span>
                                                </label>
                                                <input type="text" value={inspectorName} onChange={e => setInspectorName(e.target.value)}
                                                    placeholder="e.g. Adeola Bello" className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                                                    <Calendar className="w-4 h-4 inline mr-1" />Scheduled Inspection Date <span className="text-red-500">*</span>
                                                </label>
                                                <input type="date" value={inspectorDate} onChange={e => setInspectorDate(e.target.value)}
                                                    min={new Date().toISOString().split("T")[0]}
                                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-slate-900 mb-1.5">Dispatch Notes (optional)</label>
                                                <textarea value={inspectorNotes} onChange={e => setInspectorNotes(e.target.value)}
                                                    placeholder="Any specific instructions for the inspector..." rows={3}
                                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                                            </div>
                                            <button
                                                onClick={() => handleDispatchInspector(selectedVerification.id)}
                                                disabled={isDispatchingInspector}
                                                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl transition shadow-lg shadow-blue-600/20"
                                            >
                                                {isDispatchingInspector ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                                                {isDispatchingInspector ? "Dispatching…" : "Dispatch Inspector"}
                                            </button>
                                            <p className="text-xs text-slate-500 text-center">An email notification will be sent to the inspector with the property location and document links.</p>
                                        </div>
                                    )}
                                </div>

                                {/* Right Side: Preview */}
                                {previewUrl && (
                                    <div className="w-full lg:w-1/2 border-t lg:border-t-0 lg:border-l border-slate-200 flex flex-col bg-slate-50 max-h-[60vh]">
                                        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white sticky top-0 z-10">
                                            <h4 className="font-bold text-slate-800 text-sm truncate max-w-[200px]" title={previewTitle}>{previewTitle}</h4>
                                            <div className="flex items-center gap-3">
                                                <a 
                                                    href={previewUrl} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer" 
                                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                                                >
                                                    Open Full
                                                </a>
                                                <button 
                                                    onClick={() => setPreviewUrl(null)}
                                                    className="text-slate-400 hover:text-slate-600 transition"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex-1 p-4 flex items-center justify-center overflow-hidden h-full min-h-[400px]">
                                            {previewUrl.toLowerCase().includes(".pdf") || previewUrl.toLowerCase().includes("/raw/") ? (
                                                <iframe 
                                                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(previewUrl)}&embedded=true`}
                                                    className="w-full h-full min-h-[400px] border-0 rounded-lg bg-white"
                                                    title={previewTitle}
                                                />
                                            ) : (
                                                <img 
                                                    src={previewUrl} 
                                                    alt={previewTitle} 
                                                    className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                            {selectedVerification.verificationStatus === "pending" && (
                                <div className="p-6 border-t border-slate-200 flex gap-4 bg-white">
                                    <button
                                        onClick={() => handleApprove(selectedVerification.id)}
                                        disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                                        Approve Listing
                                    </button>
                                    <button
                                        onClick={() => handleReject(selectedVerification.id)}
                                        disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5" />}
                                        Reject
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
