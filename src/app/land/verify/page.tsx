"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
    CheckCircle,
    XCircle,
    MapPin,
    Droplets,
    Zap,
    Route,
    TrendingUp,
    Loader2,
    Eye
} from "lucide-react";
import { getLandListings, verifyLandListing } from "@/app/actions/land-actions";
import { type LandListing, SoilQuality } from "@/types/strict";

export default function LandVerificationPage() {
    const [listings, setListings] = useState<LandListing[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [selectedListing, setSelectedListing] = useState<LandListing | null>(null);

    useEffect(() => {
        loadListings();
    }, []);

    async function loadListings() {
        setLoading(true);
        const result = await getLandListings({ status: 'pending_verification' });
        if (result.success) {
            setListings(result.listings);
        }
        setLoading(false);
    }

    async function handleVerification(listingId: string, verified: boolean, rejectionReason?: string) {
        setProcessing(true);
        const result = await verifyLandListing({
            listingId,
            verified,
            rejectionReason,
            notes: verified ? "Verified by admin" : undefined,
        });

        if (result.success) {
            await loadListings();
            setSelectedListing(null);
        }

        setProcessing(false);
    }

    const getSoilQualityColor = (quality: SoilQuality) => {
        const colors = {
            [SoilQuality.EXCELLENT]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
            [SoilQuality.GOOD]: 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200',
            [SoilQuality.FAIR]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
            [SoilQuality.POOR]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        };
        return colors[quality];
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8"
                >
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Land Listing Verification
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Review and verify pending land listings
                    </p>
                </motion.div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900 rounded-full flex items-center justify-center">
                                <Eye className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white">{listings.length}</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Pending</p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                                <TrendingUp className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white">
                                    {listings.reduce((sum, l) => sum + l.acreage, 0).toFixed(1)}
                                </p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Total Acres</p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                                <MapPin className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                            <div>
                                <p className="text-3xl font-bold text-slate-900 dark:text-white">
                                    ₦{listings.length > 0 ? Math.round(listings.reduce((sum, l) => sum + l.price, 0) / listings.length).toLocaleString() : 0}
                                </p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Average Price</p>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Loading */}
                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-[#1358ec]" />
                    </div>
                )}

                {/* Empty State */}
                {!loading && listings.length === 0 && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center">
                        <CheckCircle className="w-16 h-16 text-green-300 dark:text-green-600 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                            All Caught Up!
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            No pending land listings to review
                        </p>
                    </div>
                )}

                {/* Listings */}
                {!loading && listings.length > 0 && (
                    <div className="grid grid-cols-1 gap-6">
                        {listings.map((listing, index) => (
                            <motion.div
                                key={listing.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                            {listing.title}
                                        </h3>
                                        <p className="text-slate-600 dark:text-slate-400 mb-4">
                                            {listing.description}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-3xl font-bold text-[#1358ec]">
                                            ₦{listing.price.toLocaleString()}
                                        </p>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            {listing.acreage} acres
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Location</p>
                                        <p className="font-semibold text-slate-900 dark:text-white text-sm">
                                            {listing.location.city}, {listing.location.state}
                                        </p>
                                        <p className="text-xs text-slate-600 dark:text-slate-400">{listing.location.address}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Soil Quality</p>
                                        <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${getSoilQualityColor(listing.soilQuality)}`}>
                                            {listing.soilQuality.toUpperCase()}
                                        </span>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Amenities</p>
                                        <div className="flex gap-2">
                                            <Droplets className={`w-4 h-4 ${listing.waterAccess ? 'text-blue-600' : 'text-slate-300'}`} />
                                            <Zap className={`w-4 h-4 ${listing.electricityAccess ? 'text-yellow-600' : 'text-slate-300'}`} />
                                            <Route className={`w-4 h-4 ${listing.roadAccess ? 'text-slate-600' : 'text-slate-300'}`} />
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Coordinates</p>
                                        <p className="text-xs font-mono text-slate-900 dark:text-white">
                                            {listing.location.lat.toFixed(4)}, {listing.location.lng.toFixed(4)}
                                        </p>
                                    </div>
                                </div>

                                {/* Images Preview */}
                                {listing.images.length > 0 && (
                                    <div className="mb-4">
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Images ({listing.images.length})</p>
                                        <div className="grid grid-cols-4 gap-2">
                                            {listing.images.slice(0, 4).map((img, i) => (
                                                <div key={i} className="aspect-square bg-slate-200 dark:bg-slate-700 rounded overflow-hidden">
                                                    <img src={img} alt="" className="w-full h-full object-cover" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => handleVerification(listing.id, true)}
                                        disabled={processing}
                                        className="flex-1 px-6 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <CheckCircle className="w-5 h-5" />
                                        {processing ? 'Processing...' : 'Verify'}
                                    </button>

                                    <button
                                        onClick={() => handleVerification(listing.id, false, "Does not meet quality standards")}
                                        disabled={processing}
                                        className="flex-1 px-6 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <XCircle className="w-5 h-5" />
                                        {processing ? 'Processing...' : 'Reject'}
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
