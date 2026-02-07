"use client";

import { useState, useEffect } from "react";
import { MapPin, FileText, Calendar, Check, X, Eye } from "lucide-react";

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
    gpsCoordinates?: {
        latitude: number;
        longitude: number;
    };
    documents: {
        landTitle: string;
        surveyPlan: string;
        taxClearance?: string;
    };
    images: string[];
    videoUrl?: string;
    verificationStatus: string;
    verificationNotes?: string;
    createdAt: Date;
};

export default function AdminLandVerificationPage() {
    const [verifications, setVerifications] = useState<LandVerification[]>([]);
    const [filteredVerifications, setFilteredVerifications] = useState<LandVerification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState("pending");
    const [selectedVerification, setSelectedVerification] = useState<LandVerification | null>(null);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        fetchVerifications();
    }, []);

    useEffect(() => {
        filterVerificationsByStatus();
    }, [verifications, filterStatus]);

    const fetchVerifications = async () => {
        setIsLoading(true);
        try {
            const response = await fetch("/api/admin/farm-nation/land-verifications");
            const data = await response.json();

            if (data.success) {
                setVerifications(data.verifications);
            }
        } catch (error) {
            console.error("Failed to fetch verifications:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const filterVerificationsByStatus = () => {
        if (filterStatus === "all") {
            setFilteredVerifications(verifications);
        } else {
            setFilteredVerifications(verifications.filter(v => v.verificationStatus === filterStatus));
        }
    };

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
                alert("Land listing approved!");
                fetchVerifications();
                setIsDetailsModalOpen(false);
            } else {
                alert(data.message || "Failed to approve");
            }
        } catch (error) {
            alert("An error occurred");
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
                alert("Land listing rejected");
                fetchVerifications();
                setIsDetailsModalOpen(false);
            } else {
                alert(data.message || "Failed to reject");
            }
        } catch (error) {
            alert("An error occurred");
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
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8">
            <div className="max-w-7xl mx-auto px-4">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Land Verification
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Review and verify land listing submissions
                    </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Total Submissions</p>
                        <p className="text-3xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Pending Review</p>
                        <p className="text-3xl font-bold text-yellow-600">{stats.pending}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Verified</p>
                        <p className="text-3xl font-bold text-green-600">{stats.verified}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Rejected</p>
                        <p className="text-3xl font-bold text-red-600">{stats.rejected}</p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 mb-6">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setFilterStatus("all")}
                            className={`px-4 py-2 rounded-lg font-semibold transition-all ${filterStatus === "all"
                                    ? "bg-primary text-white"
                                    : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                                }`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilterStatus("pending")}
                            className={`px-4 py-2 rounded-lg font-semibold transition-all ${filterStatus === "pending"
                                    ? "bg-yellow-600 text-white"
                                    : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                                }`}
                        >
                            Pending ({stats.pending})
                        </button>
                        <button
                            onClick={() => setFilterStatus("verified")}
                            className={`px-4 py-2 rounded-lg font-semibold transition-all ${filterStatus === "verified"
                                    ? "bg-green-600 text-white"
                                    : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                                }`}
                        >
                            Verified ({stats.verified})
                        </button>
                        <button
                            onClick={() => setFilterStatus("rejected")}
                            className={`px-4 py-2 rounded-lg font-semibold transition-all ${filterStatus === "rejected"
                                    ? "bg-red-600 text-white"
                                    : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                                }`}
                        >
                            Rejected ({stats.rejected})
                        </button>
                    </div>
                </div>

                {/* Verifications Table */}
                {isLoading ? (
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-12 text-center">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600 dark:text-slate-400">Loading verifications...</p>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50 dark:bg-slate-900">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Owner</th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Land Title</th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Location</th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Size</th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Price</th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Status</th>
                                        <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                    {filteredVerifications.map((verification) => (
                                        <tr key={verification.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                            <td className="px-6 py-4">
                                                <p className="font-semibold text-slate-900 dark:text-white">{verification.ownerName}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="font-semibold text-slate-900 dark:text-white">{verification.title}</p>
                                                <p className="text-sm text-slate-500">{verification.category}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm text-slate-900 dark:text-white">{verification.state}</p>
                                                <p className="text-xs text-slate-500">{verification.lga}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                                    {verification.size} {verification.unit}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-sm font-semibold text-green-600">
                                                    ₦{verification.totalPrice.toLocaleString()}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${verification.verificationStatus === "pending"
                                                        ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                                        : verification.verificationStatus === "verified"
                                                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                    }`}>
                                                    {verification.verificationStatus}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <button
                                                    onClick={() => {
                                                        setSelectedVerification(verification);
                                                        setIsDetailsModalOpen(true);
                                                    }}
                                                    className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
                                                >
                                                    <Eye className="w-4 h-4" />
                                                    Review
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
                        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full my-8">
                            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                    Land Verification Details
                                </h2>
                                <button
                                    onClick={() => setIsDetailsModalOpen(false)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                                {/* Basic Info */}
                                <section>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                        <MapPin className="w-5 h-5" />
                                        Land Information
                                    </h3>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">Title</p>
                                            <p className="font-semibold text-slate-900 dark:text-white">{selectedVerification.title}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">Category</p>
                                            <p className="font-semibold text-slate-900 dark:text-white">{selectedVerification.category}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">Location</p>
                                            <p className="font-semibold text-slate-900 dark:text-white">
                                                {selectedVerification.state}, {selectedVerification.lga}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">Size & Price</p>
                                            <p className="font-semibold text-slate-900 dark:text-white">
                                                {selectedVerification.size} {selectedVerification.unit} - ₦{selectedVerification.totalPrice.toLocaleString()}
                                            </p>
                                        </div>
                                        {selectedVerification.gpsCoordinates && (
                                            <div>
                                                <p className="text-sm text-slate-600 dark:text-slate-400">GPS Coordinates</p>
                                                <p className="font-semibold text-slate-900 dark:text-white">
                                                    {selectedVerification.gpsCoordinates.latitude.toFixed(6)}, {selectedVerification.gpsCoordinates.longitude.toFixed(6)}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </section>

                                {/* Documents */}
                                <section>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                        <FileText className="w-5 h-5" />
                                        Legal Documents
                                    </h3>
                                    <div className="space-y-2">
                                        <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                            <p className="text-sm font-semibold text-slate-900 dark:text-white">Land Title: {selectedVerification.documents.landTitle}</p>
                                        </div>
                                        <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                            <p className="text-sm font-semibold text-slate-900 dark:text-white">Survey Plan: {selectedVerification.documents.surveyPlan}</p>
                                        </div>
                                        {selectedVerification.documents.taxClearance && (
                                            <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                                <p className="text-sm font-semibold text-slate-900 dark:text-white">Tax Clearance: {selectedVerification.documents.taxClearance}</p>
                                            </div>
                                        )}
                                    </div>
                                </section>

                                {/* Images */}
                                {selectedVerification.images.length > 0 && (
                                    <section>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Land Photos</h3>
                                        <div className="grid grid-cols-4 gap-2">
                                            {selectedVerification.images.map((img, idx) => (
                                                <div key={idx} className="aspect-square bg-slate-200 dark:bg-slate-700 rounded-lg">
                                                    {/* Image preview */}
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </div>

                            {/* Actions */}
                            {selectedVerification.verificationStatus === "pending" && (
                                <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex gap-4">
                                    <button
                                        onClick={() => handleApprove(selectedVerification.id)}
                                        disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        <Check className="w-5 h-5" />
                                        Approve Listing
                                    </button>
                                    <button
                                        onClick={() => handleReject(selectedVerification.id)}
                                        disabled={isProcessing}
                                        className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        <X className="w-5 h-5" />
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
