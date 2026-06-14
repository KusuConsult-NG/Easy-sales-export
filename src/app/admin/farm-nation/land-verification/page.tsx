"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { MapPin, FileText, Check, X, Eye, Loader2, Download, Filter, ClipboardList, Send, Calendar, User } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useAdminData } from "@/hooks/useAdminData";
import { getAdminLandVerificationsAction, getFarmNationVerificationStatsAction } from "@/app/actions/farm-nation-admin";

type LandVerification = {
    id: string;
    userId: string;
    ownerName: string;
    title: string;
    category: string;
    state: string;
    lga: string;
    size: number;
    unit: string;
    totalPrice: number;
    gpsCoordinates?: { latitude: number; longitude: number; };
    documents: { landTitle: string; surveyPlan: string; taxClearance?: string; };
    images: string[];
    videoUrl?: string;
    verificationStatus: string;
    verificationNotes?: string;
    createdAt: Date;
    verifiedBy?: string;
    verifiedAt?: Date;
};

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
        refresh: loadVerifications
    } = useAdminData<LandVerification>({
        fetchAction: getAdminLandVerificationsAction,
        limit: 50
    });

    const filterStatus = (filters.status as string) || "pending";
    const [selectedVerification, setSelectedVerification] = useState<LandVerification | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    // Inspector dispatch state
    const [inspectorName, setInspectorName] = useState("");
    const [inspectorDate, setInspectorDate] = useState("");
    const [inspectorNotes, setInspectorNotes] = useState("");
    const [isDispatchingInspector, setIsDispatchingInspector] = useState(false);
    const [activeTab, setActiveTab] = useState<"details" | "inspector">("details");

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
    }, []);

    const filteredVerifications = verifications;

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
            showToast("Export downloaded successfully", "success");
        } catch (error: any) {
            console.error("Export error:", error);
            showToast(error.message || "Failed to export data", "error");
        }
    };

    // Use server-side stats when available; fall back to local page counts while loading
    const stats = serverStats ?? {
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
                        <button
                            onClick={handleExportCSV}
                            disabled={verifications.length === 0}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                        >
                            <Download className="w-4 h-4" /> Export CSV ({filteredVerifications.length})
                        </button>
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
                                                <p className="text-sm text-slate-500">{verification.category}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm text-slate-900">{verification.state}</p>
                                                <p className="text-xs text-slate-500">{verification.lga}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm font-semibold text-slate-900">{verification.size} {verification.unit}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm font-semibold text-green-600">₦{verification.totalPrice.toLocaleString()}</p>
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
                        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-8">
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

                            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                                {activeTab === "details" && (
                                    <>
                                        <section>
                                            <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                                                <MapPin className="w-5 h-5" /> Land Information
                                            </h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div><p className="text-sm text-slate-600">Title</p><p className="font-semibold">{selectedVerification.title}</p></div>
                                                <div><p className="text-sm text-slate-600">Category</p><p className="font-semibold">{selectedVerification.category}</p></div>
                                                <div><p className="text-sm text-slate-600">Location</p><p className="font-semibold">{selectedVerification.state}, {selectedVerification.lga}</p></div>
                                                <div><p className="text-sm text-slate-600">Size &amp; Price</p><p className="font-semibold">{selectedVerification.size} {selectedVerification.unit} — ₦{selectedVerification.totalPrice.toLocaleString()}</p></div>
                                                {selectedVerification.gpsCoordinates && (
                                                    <div><p className="text-sm text-slate-600">GPS</p><p className="font-semibold">{selectedVerification.gpsCoordinates.latitude.toFixed(6)}, {selectedVerification.gpsCoordinates.longitude.toFixed(6)}</p></div>
                                                )}
                                            </div>
                                        </section>
                                        <section>
                                            <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                                                <FileText className="w-5 h-5" /> Legal Documents
                                            </h3>
                                            <div className="space-y-2">
                                                {selectedVerification.documents.landTitle && (
                                                    <a href={selectedVerification.documents.landTitle} target="_blank" rel="noopener noreferrer"
                                                        className="flex items-center gap-2 p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition group">
                                                        <FileText className="w-5 h-5 text-blue-600" />
                                                        <span className="text-sm font-semibold text-blue-700 group-hover:underline">Land Title Document</span>
                                                    </a>
                                                )}
                                                {selectedVerification.documents.surveyPlan && (
                                                    <a href={selectedVerification.documents.surveyPlan} target="_blank" rel="noopener noreferrer"
                                                        className="flex items-center gap-2 p-3 bg-green-50 hover:bg-green-100 rounded-lg transition group">
                                                        <FileText className="w-5 h-5 text-green-600" />
                                                        <span className="text-sm font-semibold text-green-700 group-hover:underline">Survey Plan Document</span>
                                                    </a>
                                                )}
                                                {selectedVerification.documents.taxClearance && (
                                                    <a href={selectedVerification.documents.taxClearance} target="_blank" rel="noopener noreferrer"
                                                        className="flex items-center gap-2 p-3 bg-amber-50 hover:bg-amber-100 rounded-lg transition group">
                                                        <FileText className="w-5 h-5 text-amber-600" />
                                                        <span className="text-sm font-semibold text-amber-700 group-hover:underline">Tax Clearance Document</span>
                                                    </a>
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
                            {selectedVerification.verificationStatus === "pending" && (
                                <div className="p-6 border-t border-slate-200 flex gap-4">
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
