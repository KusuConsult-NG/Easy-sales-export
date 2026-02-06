"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { SoilQuality, type LandListing } from "@/types/strict";
import { getVerifiedLandListings } from "@/app/actions/land";
import { logger } from "@/lib/logger";

//Dynamically import LandMap to prevent SSR issues with leaflet
const LandMap = dynamic(
    () => import("@/components/land/LandMap").then(mod => ({ default: mod.LandMap })),
    {
        ssr: false,
        loading: () => (
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg" style={{ height: '600px' }}>
                <div className="w-full h-full bg-slate-200 dark:bg-slate-700 rounded-xl flex items-center justify-center">
                    <p className="text-slate-600 dark:text-slate-400">Loading map...</p>
                </div>
            </div>
        )
    }
);


export default function LandMapPage() {
    const [listings, setListings] = useState<LandListing[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadListings() {
            const data = await getVerifiedLandListings();
            setListings(data);
            setLoading(false);
        }
        loadListings();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-linear-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="mt-4 text-slate-600 dark:text-slate-400">Loading land listings...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-linear-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
                        Land Listings Map
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Browse available agricultural land with interactive map
                    </p>
                </div>

                {/* Map */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg">
                    <LandMap
                        listings={listings}
                        height="600px"
                        onListingClick={(listing) => {
                            logger.debug("Land listing clicked", { listingId: listing.id, title: listing.title });
                            // Handle listing click (e.g., open modal)
                        }}
                    />
                </div>

                {/* Listings Grid */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {listings.map((listing) => (
                        <div
                            key={listing.id}
                            className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow"
                        >
                            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                {listing.title}
                            </h3>
                            <p className="text-2xl font-bold text-[#1358ec] mb-4">
                                ₦{listing.price.toLocaleString()}
                            </p>
                            <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                                <p>📍 {listing.location.city}, {listing.location.state}</p>
                                <p>📏 {listing.acreage} acres</p>
                                <p>🌱 {listing.soilQuality} soil quality</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

