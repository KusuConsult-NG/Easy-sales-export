"use client";

import { useState, useEffect, Suspense } from "react";
import { isPurchasable } from "@/lib/land-listing-status";
import { logger } from '@/lib/logger';
import { MapPin, ArrowRight, Filter, Search, Home, TrendingUp, Layers, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { searchLandListingsAction, type LandListing } from "@/app/actions/land-listings";
//   One vocabulary for what kind of land this is, and one name for the query
//   parameter carrying it — see lib/land-categories.
import { LAND_CATEGORIES, LAND_CATEGORY_PARAM } from "@/lib/land-categories";
import { isOnOffer, discountPercent } from "@/lib/price-reduction";
import { useServerSeed } from "@/hooks/useServerSeed";
import { useSearchParams, useRouter } from "next/navigation";
import { firstImageSrc } from "@/lib/first-image";

//   #791 A broken thumbnail must not paint its alt text over the
//   badges in the same box — see components/ui/ThumbnailImage.
import { ThumbnailImage } from "@/components/ui/ThumbnailImage";

function PropertiesContent({ initial }: { initial: any | null }) {
    const searchParams = useSearchParams();
    const router = useRouter();

    // State for filters
    const [searchTerm, setSearchTerm] = useState("");
    const [filters, setFilters] = useState({
        //   The landing page's category tiles link with this exact parameter
        //   now. They used to write `?category=`, which nothing read.
        propertyType: searchParams.get(LAND_CATEGORY_PARAM) || "",
        location: searchParams.get("location") || "",
        priceRange: "",
        listingType: searchParams.get("listingType") || "",
        /**
         *   #867 FARM NATION HAD NO HOT DEALS AT ALL.
         *
         *   THE OWNER: "products that get price reduction should automatically
         *   go to flash sales / hot deals, and YOU NEED TO CREATE THAT FOR FARM
         *   NATION."
         *
         *   The marketplace at least had a Flash Sales tab, fed by Village
         *   Market events. This module had nothing — a seller could halve the
         *   price of a parcel and no screen anywhere would say so.
         *
         *   A client-side filter rather than a server one, deliberately: whether
         *   a listing is on offer is COMPUTED from the two stored facts (see
         *   lib/price-reduction), so it expires on its own. Asking the database
         *   for it would mean either a stored boolean nothing ever clears, or a
         *   range query on a timestamp that changes meaning every day.
         */
        hotDealsOnly: searchParams.get("deals") === "1",
    });

    // State for data
    const [properties, setProperties] = useState<LandListing[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [lastDocId, setLastDocId] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initial load & Filter change
    const takeSeed = useServerSeed(initial);

    async function loadProperties(reset = true) {
        if (reset) {
            setLoading(true);
            setProperties([]);
        } else {
            setLoadingMore(true);
        }
        setError(null);

        try {
            // Parse price range
            let minPrice, maxPrice;
            if (filters.priceRange === "under-20m") { maxPrice = 20000000; }
            else if (filters.priceRange === "20m-50m") { minPrice = 20000000; maxPrice = 50000000; }
            else if (filters.priceRange === "50m-100m") { minPrice = 50000000; maxPrice = 100000000; }
            else if (filters.priceRange === "above-100m") { minPrice = 100000000; }

            const currentLastDoc = reset ? undefined : lastDocId || undefined;

            //   #553 The seed answers the first UNFILTERED reset only. Any
            //   filter, any search term or any page beyond the first must ask
            //   the server, or a filtered view would render unfiltered rows.
            const unfiltered = reset
                && !filters.location && !filters.propertyType
                && !filters.priceRange && !filters.listingType && !searchTerm;
            const seeded = unfiltered ? takeSeed() : null;

            const result = seeded ?? await searchLandListingsAction({
                state: filters.location || undefined,
                category: filters.propertyType || undefined,
                minPrice,
                maxPrice,
                limit: 12,
                lastDocId: currentLastDoc,
                type: (filters.listingType || undefined) as "sale" | "rent" | "lease" | undefined,
            });

            if (result.success && result.data) {
                // Client-side text search (basic)
                let filteredResults = result.data.listings;
                if (searchTerm) {
                    const lowerTerm = searchTerm.toLowerCase();
                    filteredResults = result.data.listings.filter((p: LandListing) => {
                        const titleMatch = p.title?.toLowerCase().includes(lowerTerm);
                        const descMatch = p.description?.toLowerCase().includes(lowerTerm);
                        
                        let locMatch = false;
                        if (typeof p.location === "object" && p.location) {
                            locMatch = !!(p.location.lga?.toLowerCase().includes(lowerTerm) || 
                                         p.location.address?.toLowerCase().includes(lowerTerm) || 
                                         p.location.state?.toLowerCase().includes(lowerTerm));
                        } else {
                            locMatch = String(p.location || "").toLowerCase().includes(lowerTerm);
                        }
                        return titleMatch || descMatch || locMatch;
                    });
                }

                if (reset) {
                    setProperties(filteredResults);
                } else {
                    setProperties(prev => [...prev, ...filteredResults]);
                }

                setLastDocId(result.data.lastDocId);
                setHasMore(!!result.data.lastDocId);
            } else if (result.error) {
                setError(result.error);
            }

        } catch (err: any) {
            logger.error("Error:", err);
            setError(err.message || "An unexpected error occurred");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    // Trigger load on filter change
    useEffect(() => {
        // Debounce search
        const timer = setTimeout(() => {
            loadProperties(true);
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.propertyType, filters.location, filters.priceRange, filters.listingType, searchTerm]);

    function handleLoadMore() {
        if (!loadingMore && hasMore) {
            loadProperties(false);
        }
    };

    function handleFilterChange(key: keyof typeof filters, value: string) {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const nigerianStates = [
        "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
        "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo",
        "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
        "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
        "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT"
    ];

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-linear-to-r from-teal-600 to-cyan-600 text-white py-16">
                <div className="max-w-7xl mx-auto px-8">
                    <div className="flex items-center gap-3 mb-4">
                        <Home className="w-8 h-8" />
                        <h1 className="text-4xl font-bold">Browse Agricultural Farms</h1>
                    </div>
                    <p className="text-teal-100 text-lg max-w-2xl">
                        Find verified agricultural land and facilities across Nigeria
                    </p>
                </div>
            </div>

            {/* Filters & Search */}
            <div className="max-w-7xl mx-auto px-8 py-8">
                <div className="bg-white rounded-2xl p-6 shadow-lg mb-8">
                    <div className="flex flex-col md:flex-row gap-4">
                        {/* Search */}
                        <div className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search farms by keyword..."
                                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                                />
                            </div>
                        </div>

                        {/* Property Type Filter */}
                        <select
                            value={filters.propertyType}
                            onChange={(e) => handleFilterChange("propertyType", e.target.value)}
                            className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                        >
                            <option value="">All Types</option>
                            {LAND_CATEGORIES.map((category) => (
                                <option key={category.value} value={category.value}>
                                    {category.label}
                                </option>
                            ))}
                        </select>

                        {/* Listing Type Filter */}
                        <select
                            value={filters.listingType}
                            onChange={(e) => handleFilterChange("listingType", e.target.value)}
                            className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                        >
                            <option value="">All Listing Types</option>
                            <option value="sale">For Sale</option>
                            <option value="rent">For Rent</option>
                            <option value="lease">For Lease</option>
                        </select>

                        {/*
                          *   #867 THE HOT DEALS SWITCH.
                          *
                          *   A filter nobody can turn on is the same as no
                          *   filter, which is how a "deals" feature usually ends
                          *   up existing only in the data. Rendered beside the
                          *   other filters rather than as a separate page,
                          *   because it is one more way to narrow the same list.
                          */}
                        <button
                            type="button"
                            onClick={() => setFilters(prev => ({ ...prev, hotDealsOnly: !prev.hotDealsOnly }))}
                            aria-pressed={filters.hotDealsOnly}
                            className={`px-4 py-3 rounded-xl font-semibold border transition ${
                                filters.hotDealsOnly
                                    ? "bg-red-600 text-white border-red-600"
                                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                            }`}
                        >
                            🔥 Hot Deals
                        </button>

                        {/* Location Filter */}
                        <select
                            value={filters.location}
                            onChange={(e) => handleFilterChange("location", e.target.value)}
                            className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                        >
                            <option value="">All Locations</option>
                            {nigerianStates.map(state => (
                                <option key={state} value={state}>{state}</option>
                            ))}
                        </select>

                        {/* Price Range Filter */}
                        <select
                            value={filters.priceRange}
                            onChange={(e) => handleFilterChange("priceRange", e.target.value)}
                            className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                        >
                            <option value="">Any Price</option>
                            <option value="under-20m">Under ₦20M</option>
                            <option value="20m-50m">₦20M - ₦50M</option>
                            <option value="50m-100m">₦50M - ₦100M</option>
                            <option value="above-100m">Above ₦100M</option>
                        </select>
                    </div>
                </div>

                {/* Results Header */}
                <div className="flex items-center justify-between mb-6">
                    <p className="text-slate-600">
                        Showing <span className="font-bold text-slate-900">{properties.length}</span> verified farms
                    </p>
                    <div className="flex items-center gap-3">
                        {/* #105 — the heart on a property page persists now, so
                            there is a list to reach. */}
                        <Link href="/farm-nation/saved" className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition">
                            Saved Properties
                        </Link>
                        <Link href="/farm-nation/list-land" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
                            + List Your Land
                        </Link>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Properties Grid */}
                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="w-12 h-12 animate-spin text-teal-600" />
                    </div>
                ) : properties.length === 0 ? (
                    <div className="text-center py-16 bg-slate-50 rounded-2xl">
                        <Home className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">No properties found</h3>
                        <p className="text-slate-600 mb-6">
                            Try adjusting your filters or search term to find what you're looking for.
                        </p>
                        <button
                            onClick={() => {
                                setFilters({ propertyType: "", location: "", priceRange: "", listingType: "", hotDealsOnly: false });
                                setSearchTerm("");
                            }}
                            className="px-6 py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition"
                        >
                            Clear Filters
                        </button>
                    </div>
                ) : (
                    <>
                        <div data-testid="property-grid" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {properties
                                .filter((property: any) => !filters.hotDealsOnly
                                    || isOnOffer(property, Number(property.price)))
                                .map((property) => (
                                <div
                                    key={property.id}
                                    data-testid="property-card"
                                    className="bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all hover:-translate-y-1 group"
                                >
                                    {/* Property Image */}
                                    <div className="relative h-48 bg-slate-200">
                                        {/*   #791 A broken image here printed the property
                                          *   title under the category pills opposite it. */}
                                        <ThumbnailImage
                                            //   #829 — `/placeholder-land.jpg` has never existed in public/.
                                            //   Handing it here guaranteed a 404 on every property
                                            //   with no photo, and then ThumbnailImage's own
                                            //   `fallback` rendered anyway. Passing null lets the
                                            //   component do the job it was written for.
                                            src={firstImageSrc(property.images)}
                                            alt={property.title}
                                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                                            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                            fallback={<MapPin className="w-12 h-12 text-slate-400" />}
                                        />
                                        <div className="absolute top-4 right-4 flex flex-wrap gap-1">
                                            {Array.isArray(property.category) ? (
                                                property.category.map((cat, idx) => (
                                                    <span key={idx} className="px-3 py-1 bg-teal-600 text-white text-xs font-bold rounded-full capitalize shadow-sm">
                                                        {cat}
                                                    </span>
                                                ))
                                            ) : property.category ? (
                                                <span className="px-3 py-1 bg-teal-600 text-white text-xs font-bold rounded-full capitalize shadow-sm">
                                                    {property.category}
                                                </span>
                                            ) : (
                                                <span className="px-3 py-1 bg-slate-600 text-white text-xs font-bold rounded-full">
                                                    Farmland
                                                </span>
                                            )}
                                        </div>
                                        <div className="absolute top-4 left-4">
                                            <span className={`px-3 py-1 text-white text-xs font-bold rounded-full capitalize ${
                                                property.status === 'sold' ? 'bg-red-600' :
                                                property.status === 'leased' ? 'bg-blue-600' :
                                                property.availableForRent ? 'bg-yellow-600' : 'bg-green-600'
                                            }`}>
                                                {property.status === 'sold' ? 'Sold' :
                                                 property.status === 'leased' ? 'Leased' :
                                                 property.availableForRent ? 'Leasing' : 'For Sale'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Property Details */}
                                    <div className="p-6">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-sm uppercase tracking-wider ${
                                                //   #856 — the third of the three screens
                                                //   carrying this badge. See the note on the
                                                //   property details page for why one
                                                //   expression gave three different wrong
                                                //   answers, and #340 for why the STATUS is
                                                //   the verification decision.
                                                isPurchasable(property.status)
                                                    ? "bg-emerald-100 text-emerald-800"
                                                    : "bg-red-100 text-red-800"
                                            }`}>
                                                {isPurchasable(property.status) ? "Verified Land" : "Unverified Land"}
                                            </span>
                                        </div>
                                        <h3 className="text-xl font-bold text-slate-900 mb-2 line-clamp-1">
                                            {property.title}
                                        </h3>
                                        <div className="flex items-center gap-2 text-slate-600 mb-4">
                                            <MapPin className="w-4 h-4 shrink-0" />
                                            <span className="text-sm line-clamp-1">
                                                {typeof property.location === "object" && property.location
                                                    ? `${property.location.address || property.location.lga || ""}, ${property.location.state || ""}`.trim().replace(/^,\s*/, "")
                                                    : (property.location as any || "Nigeria")}
                                            </span>
                                        </div>

                                        {/* Features / Details */}
                                        <div className="flex flex-wrap gap-2 mb-4">
                                            {property.soilType && (
                                                <span className="px-2 py-1 bg-slate-100 text-xs text-slate-600 rounded">
                                                    {property.soilType}
                                                </span>
                                            )}
                                            {property.waterSource && (
                                                <span className="px-2 py-1 bg-slate-100 text-xs text-slate-600 rounded">
                                                    {property.waterSource}
                                                </span>
                                            )}
                                        </div>

                                        {/* Price & Size */}
                                        <div className="flex items-center justify-between pt-4 border-t border-slate-200 mb-4">
                                            <div>
                                                <p className="text-xs text-slate-500 mb-1">Size</p>
                                                <p className="font-semibold text-slate-900 flex items-center gap-1">
                                                    <Layers className="w-4 h-4" />
                                                    {property.size}
                                                </p>
                                            </div>
                                            {/*
                                              *   #867 When the price has been cut, the card says so:
                                              *   the old figure struck through and how much off. A
                                              *   reduction nobody can see is the same as no
                                              *   reduction, which is the state this module was in.
                                              */}
                                            <div className="text-right">
                                                <p className="text-xs text-slate-500 mb-1">Price</p>
                                                {isOnOffer(property, Number((property as any).price)) ? (
                                                    <>
                                                        <p className="text-xl font-bold text-red-600">
                                                            ₦{Number(property.price || 0).toLocaleString()}
                                                        </p>
                                                        <p className="text-xs text-slate-400 line-through">
                                                            ₦{Number((property as any).previousPrice || 0).toLocaleString()}
                                                        </p>
                                                        <p className="text-[10px] font-extrabold text-red-600">
                                                            {discountPercent(property, Number((property as any).price))}% OFF · Hot Deal
                                                        </p>
                                                    </>
                                                ) : (
                                                    <p className="text-xl font-bold text-teal-600">
                                                        ₦{Number(property.price || 0).toLocaleString()}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* CTA */}
                                        <Link
                                            href={`/farm-nation/property/${property.id}`}
                                            className="block w-full text-center px-6 py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition"
                                        >
                                            View Details
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Load More Button */}
                        {hasMore && (
                            <div className="mt-12 flex justify-center">
                                <button
                                    onClick={handleLoadMore}
                                    disabled={loadingMore}
                                    className="flex items-center gap-2 px-8 py-4 bg-white text-slate-900 font-semibold rounded-xl shadow-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-all"
                                >
                                    {loadingMore ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            Loading more...
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw className="w-5 h-5" />
                                            Load More Listings
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* CTA Section */}
                <div className="mt-16 bg-linear-to-r from-teal-600 to-cyan-600 rounded-3xl p-12 text-center text-white">
                    <h2 className="text-3xl font-bold mb-4">Can't Find What You're Looking For?</h2>
                    <p className="text-xl mb-8 text-teal-100 max-w-2xl mx-auto">
                        Let us know your requirements and we'll help you find the perfect agricultural property
                    </p>
                    <Link
                        href="/contact"
                        className="inline-flex items-center gap-2 px-10 py-4 bg-white text-teal-600 font-bold text-lg rounded-xl shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                    >
                        <TrendingUp className="w-5 h-5" />
                        Contact Our Team
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default function PropertiesClient({ initial = null }: {
    /**
     *   #553 The FIRST, unfiltered search, already run.
     *
     *   A take-once seed, guarded. This effect re-runs on every filter and on a
     *   debounced search term, so the seed answers only the initial unfiltered
     *   load — otherwise a filtered view could render unfiltered listings,
     *   which is the mistake seller/orders nearly made in #552.
     */
    initial?: Awaited<ReturnType<typeof searchLandListingsAction>> | null;
}) {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin text-teal-600" />
            </div>
        }>
            <PropertiesContent initial={initial} />
        </Suspense>
    );
}
