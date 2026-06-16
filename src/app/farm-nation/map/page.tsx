"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logger } from '@/lib/logger';
import dynamic from "next/dynamic";
import { Filter, Grid, MapIcon, Search } from "lucide-react";
import Image from "next/image";

// Dynamically import map component to avoid SSR issues
const MapView = dynamic(() => import("@/components/farm-nation/MapView"), {
    ssr: false,
    loading: () => (
        <div className="h-[600px] bg-slate-100 rounded-xl flex items-center justify-center">
            <div className="text-center">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-slate-600">Loading map...</p>
            </div>
        </div>
    )
});

type LandListing = {
    id: string;
    title: string;
    category: string;
    state: string;
    lga: string;
    size: number;
    unit: string;
    pricePerUnit: number;
    totalPrice: number;
    price?: number;
    gpsCoordinates?: {
        latitude: number;
        longitude: number;
    };
    images: string[];
    verificationStatus: string;
    status?: string;
};

type ViewMode = "map" | "grid";

export default function FarmNationMapPage() {
    const router = useRouter();
    const [listings, setListings] = useState<LandListing[]>([]);
    const [filteredListings, setFilteredListings] = useState<LandListing[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [viewMode, setViewMode] = useState<ViewMode>("map");

    const [filters, setFilters] = useState({
        state: "",
        category: "",
        minPrice: 0,
        maxPrice: 0,
        minSize: 0,
        maxSize: 0,
    });

    const [searchQuery, setSearchQuery] = useState("");

    const landCategories = [
        { value: "farmland", label: "Farmland", icon: "🌾" },
        { value: "ranch", label: "Ranch/Pasture", icon: "🐄" },
        { value: "forest", label: "Forest Land", icon: "🌲" },
        { value: "mixed", label: "Mixed-Use", icon: "🌻" },
        { value: "orchard", label: "Orchard", icon: "🍊" },
        { value: "aquaculture", label: "Aquaculture", icon: "🐟" }
    ];

    const nigerianStates = [
        "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
        "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo",
        "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
        "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
        "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT"
    ];

    useEffect(() => {
        fetchListings();
    }, []);

    useEffect(() => {
        applyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listings, filters, searchQuery]);

    async function fetchListings() {
        setIsLoading(true);
        try {
            const response = await fetch("/api/farm-nation/listings");
            const data = await response.json();

            if (data.success && data.data?.listings) {
                // Only show verified listings with GPS coordinates on the map
                const mappableListings = data.data.listings.filter(
                    (l: LandListing) => (l.verificationStatus === "verified" || l.status === "verified") && l.gpsCoordinates
                );
                setListings(mappableListings);
            }
        } catch (error) {
            logger.error("Failed to fetch listings:", error);
        } finally {
            setIsLoading(false);
        }
    };

    function applyFilters() {
        let filtered = listings;

        if (filters.state) {
            filtered = filtered.filter(l => l.state === filters.state);
        }

        if (filters.category) {
            filtered = filtered.filter(l => l.category === filters.category);
        }

        if (filters.minPrice > 0) {
            filtered = filtered.filter(l => (l.totalPrice ?? l.price ?? 0) >= filters.minPrice);
        }

        if (filters.maxPrice > 0) {
            filtered = filtered.filter(l => (l.totalPrice ?? l.price ?? 0) <= filters.maxPrice);
        }

        if (filters.minSize > 0) {
            filtered = filtered.filter(l => l.size >= filters.minSize);
        }

        if (filters.maxSize > 0) {
            filtered = filtered.filter(l => l.size <= filters.maxSize);
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(l =>
                l.title?.toLowerCase().includes(query) ||
                l.state?.toLowerCase().includes(query) ||
                l.lga?.toLowerCase().includes(query)
            );
        }

        setFilteredListings(filtered);
    };

    function resetFilters() {
        setFilters({
            state: "",
            category: "",
            minPrice: 0,
            maxPrice: 0,
            minSize: 0,
            maxSize: 0,
        });
        setSearchQuery("");
    };

    return (
        <div className="min-h-screen bg-slate-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">
                        Explore Land Listings
                    </h1>
                    <p className="text-slate-600">
                        Discover verified agricultural land across Nigeria
                    </p>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Filter className="w-5 h-5 text-primary" />
                        <h2 className="text-lg font-bold text-slate-900">Filters</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Search
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="Search by title, state..."
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                State
                            </label>
                            <select
                                value={filters.state}
                                onChange={(e) => setFilters({ ...filters, state: e.target.value })}
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value="">All States</option>
                                {nigerianStates.map(state => (
                                    <option key={state} value={state}>{state}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Category
                            </label>
                            <select
                                value={filters.category}
                                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value="">All Categories</option>
                                {landCategories.map(cat => (
                                    <option key={cat.value} value={cat.value}>
                                        {cat.icon} {cat.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">
                                Price Range (₦)
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    value={filters.minPrice || ""}
                                    onChange={(e) => setFilters({ ...filters, minPrice: Number(e.target.value) })}
                                    className="w-1/2 px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="Min"
                                />
                                <input
                                    type="number"
                                    value={filters.maxPrice || ""}
                                    onChange={(e) => setFilters({ ...filters, maxPrice: Number(e.target.value) })}
                                    className="w-1/2 px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="Max"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <p className="text-sm text-slate-600">
                            {filteredListings.length} listing{filteredListings.length !== 1 ? 's' : ''} found
                        </p>
                        <button
                            onClick={resetFilters}
                            className="text-sm text-primary hover:underline font-semibold"
                        >
                            Reset Filters
                        </button>
                    </div>
                </div>

                {/* View Toggle */}
                <div className="flex items-center gap-2 mb-6">
                    <button
                        onClick={() => setViewMode("map")}
                        className={`px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 ${viewMode === "map"
                            ? "bg-primary text-white"
                            : "bg-white text-slate-900 hover:bg-slate-100"
                            }`}
                    >
                        <MapIcon className="w-4 h-4" />
                        Map View
                    </button>
                    <button
                        onClick={() => setViewMode("grid")}
                        className={`px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 ${viewMode === "grid"
                            ? "bg-primary text-white"
                            : "bg-white text-slate-900 hover:bg-slate-100"
                            }`}
                    >
                        <Grid className="w-4 h-4" />
                        Grid View
                    </button>
                </div>

                {/* Content */}
                {isLoading ? (
                    <div className="bg-white rounded-xl shadow-lg p-12 text-center">
                        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-slate-600">Loading listings...</p>
                    </div>
                ) : viewMode === "map" ? (
                    <MapView listings={filteredListings} />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredListings.map(listing => (
                            <div
                                key={listing.id}
                                className="bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow cursor-pointer"
                                onClick={() => router.push(`/farm-nation/property/${listing.id}`)}
                            >
                                <div className="relative h-48 bg-slate-200">
                                    {listing.images[0] && (
                                        <Image
                                            src={listing.images[0]}
                                            alt={listing.title}
                                            fill
                                            className="object-cover"
                                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                        />
                                    )}
                                </div>
                                <div className="p-4">
                                    <h3 className="text-lg font-bold text-slate-900 mb-2">
                                        {listing.title}
                                    </h3>
                                    <p className="text-sm text-slate-600 mb-3">
                                        {listing.state}, {listing.lga}
                                    </p>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs text-slate-500">Size</p>
                                            <p className="font-bold text-slate-900">
                                                {listing.size} {listing.unit}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-slate-500">Total Price</p>
                                            <p className="font-bold text-green-600">
                                                ₦{(listing.totalPrice ?? listing.price ?? 0).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
