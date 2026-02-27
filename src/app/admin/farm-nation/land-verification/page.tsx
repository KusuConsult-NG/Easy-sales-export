"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { logger } from '@/lib/logger';
import { MapPin, FileText, Check, X, Eye, Loader2 } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot, Unsubscribe } from "firebase/firestore";

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
    const [verifications, setVerifications] = useState<LandVerification[]>([]);
    const [filteredVerifications, setFilteredVerifications] = useState<LandVerification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState("pending");
    const [selectedVerification, setSelectedVerification] = useState<LandVerification | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const unsubscribeRef = useRef<Unsubscribe | null>(null);

    // Real-time listener
    useEffect(() => {
        if (unsubscribeRef.current) unsubscribeRef.current();

        setIsLoading(true);

        const q = query(collection(db, "land_listings"), orderBy("createdAt", "desc"));

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const docs = snapshot.docs.map((doc) => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        createdAt: data.createdAt?.toDate() || new Date(),
                        verifiedAt: data.verifiedAt?.toDate(),
                        images: data.images || [],
                    } as LandVerification;
                });
                setVerifications(docs);
                setIsLoading(false);
            },
            (err) => {
                logger.error("Land verifications snapshot error:", err);
                showToast("Failed to load land verifications", "error");
                setIsLoading(false);
            }
        );

        unsubscribeRef.current = unsubscribe;
        return () => { unsubscribeRef.current?.(); };
    }, [showToast]);

    // Local filter
    const filterVerificationsByStatus = useCallback(() => {
        if (filterStatus === "all") {
            setFilteredVerifications(verifications);
        } else {
            setFilteredVerifications(verifications.filter(v => v.verificationStatus === filterStatus));
        }
    }, [verifications, filterStatus]);

    useEffect(() => { filterVerificationsByStatus(); }, [filterVerificationsByStatus]);

    const handleApprove = async (verificationId: string) => {
        if (!confirm("Approve this land listing?")) return;
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
            } else {
                showToast(data.message || "Failed to approve", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async (verificationId: string) => {
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
            } else {
                showToast(data.message || "Failed to reject", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const stats = {
        total: verifications.length,
        pending: verifications.filter(v => v.verificationStatus === "pending").length,
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
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-xs text-slate-500">Live</span>
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
                                onClick={() => setFilterStatus(value)}
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
                                                <button
                                                    onClick={() => { setSelectedVerification(verification); setIsDetailsModalOpen(true); }}
                                                    className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
                                                >
                                                    <Eye className="w-4 h-4" /> Review
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Details Modal */}
                {isDetailsModalOpen && selectedVerification && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-8">
                            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-slate-900">Land Verification Details</h2>
                                <button onClick={() => setIsDetailsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                                <section>
                                    <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                                        <MapPin className="w-5 h-5" /> Land Information
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div><p className="text-sm text-slate-600">Title</p><p className="font-semibold">{selectedVerification.title}</p></div>
                                        <div><p className="text-sm text-slate-600">Category</p><p className="font-semibold">{selectedVerification.category}</p></div>
                                        <div><p className="text-sm text-slate-600">Location</p><p className="font-semibold">{selectedVerification.state}, {selectedVerification.lga}</p></div>
                                        <div><p className="text-sm text-slate-600">Size & Price</p><p className="font-semibold">{selectedVerification.size} {selectedVerification.unit} — ₦{selectedVerification.totalPrice.toLocaleString()}</p></div>
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
                                        <div className="p-3 bg-slate-50 rounded-lg"><p className="text-sm font-semibold">Land Title: {selectedVerification.documents.landTitle}</p></div>
                                        <div className="p-3 bg-slate-50 rounded-lg"><p className="text-sm font-semibold">Survey Plan: {selectedVerification.documents.surveyPlan}</p></div>
                                        {selectedVerification.documents.taxClearance && (
                                            <div className="p-3 bg-slate-50 rounded-lg"><p className="text-sm font-semibold">Tax Clearance: {selectedVerification.documents.taxClearance}</p></div>
                                        )}
                                    </div>
                                </section>
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
