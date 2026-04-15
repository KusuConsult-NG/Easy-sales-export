"use client";

import { useState, useEffect } from "react";
import { Package2, TrendingUp, Calendar, MapPin, ArrowRight, Filter, Search, Database, Loader2, RefreshCw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getExportOpportunities, seedExportOpportunities, type ExportOpportunity } from "@/app/actions/export-investments";
import { toast } from "sonner";

export default function ExportWindowsPage() {
    const [exportWindows, setExportWindows] = useState<ExportOpportunity[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [seeding, setSeeding] = useState(false);
    const [lastDocId, setLastDocId] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);

    async function loadWindows(reset = true) {
        if (reset) {
            setLoading(true);
            setExportWindows([]);
        } else {
            setLoadingMore(true);
        }

        try {
            const currentLastId = reset ? undefined : lastDocId || undefined;
            const result = await getExportOpportunities(12, currentLastId);

            if (result.success) {
                const windows = (result.data ?? []) as ExportOpportunity[];
                if (reset) {
                    setExportWindows(windows);
                } else {
                    setExportWindows(prev => [...prev, ...windows]);
                }
                setLastDocId(result.meta?.cursor || null);
                setHasMore(!!result.meta?.cursor);
            } else {
                toast.error(result.error || "Failed to load export windows");
            }
        } catch (error) {
            console.error("Failed to load export windows:", error);
            toast.error("Failed to load export windows");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        loadWindows();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleSeed() {
        setSeeding(true);
        await seedExportOpportunities();
        await loadWindows(true);
        setSeeding(false);
    }

    function handleLoadMore() {
        if (!loadingMore && hasMore) {
            loadWindows(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-linear-to-r from-purple-600 to-pink-600 text-white py-16">
                <div className="max-w-7xl mx-auto px-8">
                    <div className="flex items-center gap-3 mb-4">
                        <Package2 className="w-8 h-8" />
                        <h1 className="text-4xl font-bold">Export Windows</h1>
                    </div>
                    <p className="text-purple-100 text-lg max-w-2xl">
                        Discover exclusive export opportunities and invest in high-return agricultural commodities
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
                                    placeholder="Search export opportunities..."
                                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                                />
                            </div>
                        </div>

                        {/* Commodity Filter */}
                        <select className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition">
                            <option>All Commodities</option>
                            <option>Grains & Tubers</option>
                            <option>Nuts & Seeds</option>
                            <option>Spices & Herbs</option>
                            <option>Processed Products</option>
                            <option>Animal Husbandry</option>
                            <option>Fishery</option>
                            <option>Poultry</option>
                        </select>

                        {/* Status Filter */}
                        <select className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition">
                            <option>All Status</option>
                            <option>Open</option>
                            <option>Opening Soon</option>
                            <option>Closing Soon</option>
                        </select>

                        {/* Destination Filter */}
                        <select className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition">
                            <option>All Destinations</option>
                            <option>Europe</option>
                            <option>Asia</option>
                            <option>Americas</option>
                            <option>Africa</option>
                            <option>Middle East</option>
                        </select>
                    </div>
                </div>

                {/* Export Windows Grid */}
                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="animate-spin h-12 w-12 text-purple-600" />
                    </div>
                ) : exportWindows.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl shadow-lg">
                        <Package2 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">No Export Windows Found</h3>
                        <p className="text-slate-500 mb-6">There are currently no open investment opportunities.</p>
                        <button
                            onClick={handleSeed}
                            disabled={seeding}
                            className="inline-flex items-center gap-2 px-6 py-2 bg-purple-600 text-white font-semibold rounded-xl hover:bg-purple-700 transition disabled:opacity-50"
                        >
                            <Database className="w-4 h-4" />
                            {seeding ? "Seeding..." : "Seed Initial Data"}
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {exportWindows.map((window) => (
                            <div
                                key={window.id}
                                className="bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all hover:-translate-y-1"
                            >
                                <div className="flex gap-6 p-6">
                                    {/* Commodity Image */}
                                    <div className="relative w-32 h-32 shrink-0 rounded-xl overflow-hidden bg-slate-200">
                                        <Image
                                            src={window.image}
                                            alt={window.commodity}
                                            fill
                                            className="object-cover"
                                        />
                                    </div>

                                    {/* Details */}
                                    <div className="flex-1">
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <h3 className="text-xl font-bold text-slate-900 mb-1">
                                                    {window.commodity}
                                                </h3>
                                                <div className="flex items-center gap-2 text-slate-600">
                                                    <MapPin className="w-4 h-4" />
                                                    <span className="text-sm">{window.destination}</span>
                                                </div>
                                            </div>
                                            <span
                                                className={`px-3 py-1 rounded-full text-xs font-bold ${window.status === "Open"
                                                    ? "bg-green-100 text-green-700"
                                                    : "bg-blue-100 text-blue-700"
                                                    }`}
                                            >
                                                {window.status}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 mb-4">
                                            <div>
                                                <div className="text-xs text-slate-500 mb-1">
                                                    Min. Investment
                                                </div>
                                                <div className="text-lg font-bold text-purple-600">
                                                    {new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(window.minInvestment)}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-slate-500 mb-1">
                                                    Projected ROI
                                                </div>
                                                <div className="text-lg font-bold text-green-600 flex items-center gap-1">
                                                    <TrendingUp className="w-4 h-4" />
                                                    {window.projectedROI}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 text-sm text-slate-600 mb-4">
                                            <div className="flex items-center gap-1">
                                                <Calendar className="w-4 h-4" />
                                                <span>Opens: {new Date(window.openDate).toLocaleDateString()}</span>
                                            </div>
                                            <div>•</div>
                                            <div className="flex items-center gap-1">
                                                <Calendar className="w-4 h-4" />
                                                <span>Closes: {new Date(window.closeDate).toLocaleDateString()}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                                            <div className="text-sm">
                                                <span className="font-semibold text-slate-900">
                                                    {window.spotsLeft} spots
                                                </span>{" "}
                                                <span className="text-slate-500">remaining</span>
                                            </div>
                                            <Link
                                                href={`/export/windows/${window.id}`}
                                                className="inline-flex items-center gap-2 px-6 py-2 bg-purple-600 text-white font-semibold rounded-xl hover:bg-purple-700 transition"
                                            >
                                                View Details
                                                <ArrowRight className="w-4 h-4" />
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {hasMore && !loading && (
                    <div className="mt-12 flex justify-center">
                        <button
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="flex items-center gap-2 px-6 py-3 bg-white text-slate-900 font-semibold rounded-lg shadow-sm border border-slate-200 hover:bg-slate-50 disabled:opacity-50 transition-all"
                        >
                            {loadingMore ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading more...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="w-4 h-4" />
                                    Load More
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* CTA Section */}
                <div className="mt-16 bg-linear-to-r from-purple-600 to-pink-600 rounded-3xl p-12 text-center text-white">
                    <h2 className="text-3xl font-bold mb-4">Ready to Start Investing?</h2>
                    <p className="text-xl mb-8 text-purple-100 max-w-2xl mx-auto">
                        Join thousands of investors earning returns from agricultural exports
                    </p>
                    <Link
                        href="/export/onboarding"
                        className="inline-flex items-center gap-2 px-10 py-4 bg-white text-purple-600 font-bold text-lg rounded-xl shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                    >
                        <TrendingUp className="w-5 h-5" />
                        Get Started Today
                    </Link>
                </div>
            </div>
        </div>
    );
}
