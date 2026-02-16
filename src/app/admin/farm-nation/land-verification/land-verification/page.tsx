"use client";

import { useEffect, useState } from "react";
import { MapPin, FileText, CheckCircle, XCircle, Eye, Download, Loader2 } from "lucide-react";
import { getPendingLandListings, verifyLandListing } from "@/app/actions/admin";
import { useToast } from "@/contexts/ToastContext";
import type { LandListing } from "@/types";

export default function LandVerificationPage() {
    const [listings, setListings] = useState<LandListing[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedListing, setSelectedListing] = useState<LandListing | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [rejectionReason, setRejectionReason] = useState("");
    const { showToast } = useToast();

    useEffect(() => {
        let mounted = true;
        async function loadPendingListings() {
            setLoading(true);
            const result = await getPendingLandListings();
            if (mounted) {
                if (result.success && result.listings) {
                    setListings(result.listings);
                }
                setLoading(false);
            }
        }
        loadPendingListings();
        return () => { mounted = false; };
    }, []);

    async function handleApprove(listingId: string) {
        if (!confirm("Approve this land listing? It will be published immediately.")) return;

        setActionLoading(true);
        const result = await verifyLandListing(listingId, "approved", "");

        if (result.success) {
            showToast("Land listing approved successfully!", "success");
            setSelectedListing(null);
            // Manually update state to remove the approved listing
            setListings(prev => prev.filter(l => l.id !== listingId));
        } else {
            showToast(result.error || "Failed to approve listing", "error");
        }
        setActionLoading(false);
    }

    async function handleReject(listingId: string) {
        if (!rejectionReason.trim()) {
            showToast("Please provide a reason for rejection", "error");
            return;
        }

        if (!confirm("Reject this land listing? The owner will be notified.")) return;

        setActionLoading(true);
        const result = await verifyLandListing(listingId, "rejected", rejectionReason);

        if (result.success) {
            showToast("Land listing rejected. Owner has been notified.", "success");
            setSelectedListing(null);
            setRejectionReason("");
            // Manually update state to remove the rejected listing
            setListings(prev => prev.filter(l => l.id !== listingId));
        } else {
            showToast(result.error || "Failed to reject listing", "error");
        }
        setActionLoading(false);
    }

    if (loading) {
        return (
            <div className="p-8">
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            </div>
        );
    }

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center space-x-3 mb-2">
                    <MapPin className="w-8 h-8 text-green-600" />
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                        Land Verification
                    </h1>
                </div>
                <p className="text-slate-600 dark:text-slate-400">
                    Review and verify land listings submitted by landowners
                </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Pending Review</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                                {listings.length}
                            </p>
                        </div>
                        <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg flex items-center justify-center">
                            <FileText className="w-6 h-6 text-yellow-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Approved Today</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">0</p>
                        </div>
                        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center">
                            <CheckCircle className="w-6 h-6 text-green-600" />
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-lg p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">Rejected Today</p>
                            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">0</p>
                        </div>
                        <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-lg flex items-center justify-center">
                            <XCircle className="w-6 h-6 text-red-600" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Listings Grid */}
            {listings.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-lg p-12 text-center">
                    <MapPin className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                        No Pending Listings
                    </h3>
                    <p className="text-slate-600 dark:text-slate-400">
                        All land listings have been reviewed
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {listings.map((listing) => (
                        <div
                            key={listing.id}
                            className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden"
                        >
                            {/* Listing Header */}
                            <div className="p-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                                            {listing.title}
                                        </h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            {listing.location.state}, {listing.location.lga}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1 capitalize">
                                            {listing.category || "Farmland"}
                                        </p>
                                    </div>
                                    <span className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 text-xs font-medium rounded-full">
                                        Pending
                                    </span>
                                </div>

                                {/* Details */}
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Size</p>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                                            {(listing.sizeInAcres || (listing.size * 2.47)).toFixed(2)} acres
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Price</p>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                                            ₦{(listing.pricePerAcre || (listing.price / (listing.size * 2.47))).toLocaleString(undefined, { maximumFractionDigits: 0 })}/acre
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Soil Type</p>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white capitalize">
                                            {listing.soilType}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Water Access</p>
                                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                                            {listing.waterAccess ? "Yes" : "No"}
                                        </p>
                                    </div>
                                </div>

                                {/* Documents */}
                                <div className="mb-4">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Documents</p>
                                    <div className="space-y-2">
                                        {listing.documents?.landTitle && (
                                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 p-2 rounded">
                                                <span className="text-sm text-slate-900 dark:text-white">Title Deed</span>
                                                <a href={listing.documents.landTitle} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">
                                                    <Download className="w-4 h-4" />
                                                </a>
                                            </div>
                                        )}
                                        {listing.documents?.surveyPlan && (
                                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 p-2 rounded">
                                                <span className="text-sm text-slate-900 dark:text-white">Survey Plan</span>
                                                <a href={listing.documents.surveyPlan} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">
                                                    <Download className="w-4 h-4" />
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center space-x-3">
                                    <button
                                        onClick={() => setSelectedListing(listing)}
                                        className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition"
                                    >
                                        <Eye className="w-4 h-4" />
                                        <span>Review</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Review Modal */}
            {selectedListing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        {/* Modal Header */}
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                Review Land Listing
                            </h2>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                {selectedListing.title}
                            </p>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 space-y-6">
                            {/* Verification Checklist */}
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-3">
                                    Verification Checklist
                                </h3>
                                <div className="space-y-2">
                                    <label className="flex items-center space-x-3">
                                        <input type="checkbox" className="w-4 h-4 text-blue-600 rounded" />
                                        <span className="text-sm text-slate-900 dark:text-white">
                                            Title deed is valid and matches listing details
                                        </span>
                                    </label>
                                    <label className="flex items-center space-x-3">
                                        <input type="checkbox" className="w-4 h-4 text-blue-600 rounded" />
                                        <span className="text-sm text-slate-900 dark:text-white">
                                            Survey plan is recent and accurate
                                        </span>
                                    </label>
                                    <label className="flex items-center space-x-3">
                                        <input type="checkbox" className="w-4 h-4 text-blue-600 rounded" />
                                        <span className="text-sm text-slate-900 dark:text-white">
                                            Location details are correct
                                        </span>
                                    </label>
                                    <label className="flex items-center space-x-3">
                                        <input type="checkbox" className="w-4 h-4 text-blue-600 rounded" />
                                        <span className="text-sm text-slate-900 dark:text-white">
                                            Pricing is reasonable for the area
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {/* Rejection Reason (conditional) */}
                            <div>
                                <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                                    Rejection Reason (if rejecting)
                                </label>
                                <textarea
                                    value={rejectionReason}
                                    onChange={(e) => setRejectionReason(e.target.value)}
                                    placeholder="Provide a detailed reason for rejection..."
                                    className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    rows={3}
                                />
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <button
                                onClick={() => {
                                    setSelectedListing(null);
                                    setRejectionReason("");
                                }}
                                disabled={actionLoading}
                                className="px-4 py-2 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <div className="flex items-center space-x-3">
                                <button
                                    onClick={() => handleReject(selectedListing.id!)}
                                    disabled={actionLoading}
                                    className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {actionLoading ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <XCircle className="w-4 h-4" />
                                    )}
                                    <span>Reject</span>
                                </button>
                                <button
                                    onClick={() => handleApprove(selectedListing.id!)}
                                    disabled={actionLoading}
                                    className="flex items-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {actionLoading ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <CheckCircle className="w-4 h-4" />
                                    )}
                                    <span>Approve</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
