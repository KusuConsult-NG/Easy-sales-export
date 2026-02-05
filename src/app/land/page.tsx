import { LandMap } from "@/components/land/LandMap";
import { SoilQuality, type LandListing } from "@/types/strict";
import { getVerifiedLandListings } from "@/app/actions/land"; // Assuming this path for the server action

export default async function LandMapPage() {
    const listings = await getVerifiedLandListings();

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50 dark:from-slate-900 dark:to-slate-800 p-8">
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
                        listings={sampleListings}
                        height="600px"
                        onListingClick={(listing) => {
                            console.log("Clicked listing:", listing);
                            // Handle listing click (e.g., open modal)
                        }}
                    />
                </div>

                {/* Listings Grid */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sampleListings.map((listing) => (
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
