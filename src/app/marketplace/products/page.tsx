"use client";

import { useState, useEffect, useCallback } from "react";
import { Package, Search, Loader2, Star, MapPin, Plus, Eye, AlertCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { getMarketplaceProductsAction } from "@/app/actions/marketplace";
import type { Product } from "@/lib/types/marketplace";
import { formatCurrency } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { firstImageSrc } from "@/lib/first-image";

const CATEGORY_MAP = [
    { id: "all", label: "All" },
    { id: "grains", label: "Grains & Cereals" },
    { id: "roots", label: "Tubers & Roots" },
    { id: "fruits", label: "Fruits" },
    { id: "vegetables", label: "Vegetables" },
    { id: "spices", label: "Spices" },
    { id: "nuts", label: "Nuts & Seeds" },
    { id: "processed", label: "Processed Foods" },
    { id: "livestock", label: "Livestock" },
    { id: "poultry", label: "Poultry" },
    { id: "other", label: "Other" }
];

export default function MarketplaceProductsPage() {
    const { data: session } = useSession();
    const isSeller = session?.user?.roles?.includes("seller") || session?.user?.roles?.includes("admin") || session?.user?.roles?.includes("super_admin");

    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<Product[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterCategory, setFilterCategory] = useState("all");
    const [lastId, setLastId] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const debouncedSearch = useDebounce(searchQuery, 500);

    const fetchProducts = useCallback(async (isReset: boolean = false) => {
        try {
            setError(null);
            if (isReset) {
                setLoading(true);
            } else {
                setLoadingMore(true);
            }

            const currentLastId = isReset ? undefined : lastId;

            const result = await getMarketplaceProductsAction({
                limit: 12,
                lastId: currentLastId,
                category: filterCategory,
                search: debouncedSearch
            });

            if (result.success && result.data?.products) {
                setProducts(prev => isReset ? result.data.products : [...prev, ...result.data.products]);
                setLastId(result.data?.lastId);
                setHasMore(!!result.data?.hasMore);
            } else if (result.error) {
                setError(result.error);
            }
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [filterCategory, debouncedSearch, lastId]);

    useEffect(() => {
        fetchProducts(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterCategory, debouncedSearch]);

    const loadMore = () => {
        if (!loadingMore && hasMore) {
            fetchProducts(false);
        }
    };

    const getStockConfig = (availableQuantity: number) => {
        if (availableQuantity <= 0) {
            return { bg: "bg-rose-50 text-rose-700 border border-rose-200", label: "Out of Stock" };
        }
        if (availableQuantity < 50) {
            return { bg: "bg-orange-50 text-orange-700 border border-orange-200", label: "Low Stock" };
        }
        return { bg: "bg-emerald-50 text-emerald-700 border border-emerald-200", label: "In Stock" };
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-linear-to-r from-green-600 to-emerald-600 text-white py-16">
                <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <Package className="w-8 h-8" />
                            <h1 className="text-4xl font-bold">Commodity Marketplace</h1>
                        </div>
                        <p className="text-green-100 text-lg max-w-2xl">
                            Browse and purchase premium agricultural commodities directly from verified Nigerian farmers
                        </p>
                    </div>
                    {isSeller ? (
                        <Link
                            href="/marketplace/sell/create"
                            className="self-start md:self-auto flex items-center gap-2 px-6 py-3.5 bg-white text-green-700 rounded-xl font-bold hover:bg-green-50 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-95"
                        >
                            <Plus className="w-5 h-5" />
                            Add New Product
                        </Link>
                    ) : (
                        <Link
                            href="/marketplace/onboarding"
                            className="self-start md:self-auto flex items-center gap-2 px-6 py-3.5 bg-white text-green-700 rounded-xl font-bold hover:bg-green-50 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-95"
                        >
                            Become a Seller
                        </Link>
                    )}
                </div>
            </div>

            {/* Filters & Search */}
            <div className="max-w-7xl mx-auto px-8 py-8">
                <div className="bg-white rounded-2xl p-6 shadow-lg mb-8">
                    <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                        {/* Search */}
                        <div className="relative w-full md:flex-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search agricultural products..."
                                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition text-slate-800"
                            />
                        </div>

                        {/* Category Filter Tab-like buttons */}
                        <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 scrollbar-none">
                            {CATEGORY_MAP.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setFilterCategory(tab.id)}
                                    className={`px-4 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap ${
                                        filterCategory === tab.id
                                            ? "bg-green-600 text-white shadow-md shadow-green-600/10"
                                            : "bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Error State */}
                {/* data-testid: when the products query fails this banner renders
                    alongside the "No products found" empty state, so an e2e
                    assertion that accepts either state cannot tell a failed
                    query from an empty catalogue. This gives it something
                    unambiguous to assert on. */}
                {error && (
                    <div
                        data-testid="products-error"
                        className="bg-rose-50 border border-rose-200 text-rose-600 p-4 rounded-xl mb-8 text-center flex items-center justify-center gap-2"
                    >
                        <AlertCircle className="w-5 h-5" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Products Grid */}
                {products.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {products.map((product) => {
                            const stockConfig = getStockConfig(product.availableQuantity);
                            const retailPrice = product.pricingTiers?.find((t: any) => t.type === "retail")?.price || product.pricingTiers?.[0]?.price || 0;
                            const categoryObj = CATEGORY_MAP.find(c => c.id === product.category);
                            const categoryLabel = categoryObj ? categoryObj.label : product.category;

                            return (
                                <div key={product.id} className="bg-white rounded-3xl overflow-hidden shadow-md hover:shadow-xl border border-slate-100 hover:border-slate-200/80 transition-all duration-300 hover:-translate-y-1.5 h-full flex flex-col group">
                                    {/* Product Image */}
                                    <div className="relative h-60 bg-slate-100 overflow-hidden">
                                        {firstImageSrc(product.images) ? (
                                            <Image
                                                src={firstImageSrc(product.images)!}
                                                alt={product.title}
                                                fill
                                                className="object-cover group-hover:scale-[1.03] transition-transform duration-500"
                                                sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-slate-300">
                                                <Package className="w-16 h-16" />
                                            </div>
                                        )}
                                        {/* Stock Badge */}
                                        <div className="absolute top-4 left-4">
                                            <span className={`px-3 py-1.5 rounded-full text-xs font-bold shadow-sm backdrop-blur-md ${stockConfig.bg}`}>
                                                {stockConfig.label}
                                            </span>
                                        </div>
                                        {/* Export Ready Badge */}
                                        {product.exportReady && (
                                            <div className="absolute top-4 right-4">
                                                <span className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-full shadow-sm">
                                                    Export Ready
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Product Details */}
                                    <div className="p-6 flex-1 flex flex-col">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                                                <span>{categoryLabel}</span>
                                                <span>•</span>
                                                <div className="flex items-center gap-1">
                                                    <MapPin className="w-3.5 h-3.5" />
                                                    {product.location?.state || "Nigeria"}
                                                </div>
                                            </div>
                                            <h3 className="text-xl font-bold text-slate-900 group-hover:text-green-600 transition-colors mb-2 line-clamp-1">
                                                {product.title}
                                            </h3>
                                            <p className="text-slate-500 text-sm line-clamp-2 mb-4">
                                                {product.description}
                                            </p>
                                        </div>

                                        {/* Stock & Stats Info */}
                                        <div className="grid grid-cols-2 gap-4 py-3 px-4 bg-slate-50 rounded-2xl mb-6">
                                            <div>
                                                <div className="text-xs text-slate-400 font-medium">Available Stock</div>
                                                <div className={`text-sm font-bold ${
                                                    product.availableQuantity === 0 ? "text-rose-600" :
                                                    product.availableQuantity < 50 ? "text-orange-600" :
                                                    "text-slate-800"
                                                }`}>
                                                    {product.availableQuantity} {product.unit}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-slate-400 font-medium">Views & Rating</div>
                                                <div className="text-sm font-bold text-slate-800 flex items-center gap-1">
                                                    <Eye className="w-4 h-4 text-slate-400" />
                                                    <span>{product.views || 0}</span>
                                                    <span className="text-slate-300">•</span>
                                                    <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                                                    <span>{product.rating || "New"}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
                                            <div>
                                                <div className="text-2xl font-black text-green-600">
                                                    {formatCurrency(retailPrice)}
                                                </div>
                                                <div className="text-xs text-slate-400 font-semibold">per {product.unit}</div>
                                            </div>
                                            
                                            <div className="flex items-center gap-2 w-1/2">
                                                <Link
                                                    href={`/marketplace/products/${product.id}`}
                                                    className="w-full text-center py-3.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold shadow-lg shadow-green-600/10 hover:shadow-green-600/20 transition-all hover:scale-[1.02] active:scale-95"
                                                >
                                                    View Details
                                                </Link>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    !loading && (
                        <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200 p-8 shadow-sm">
                            <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">No products found</h3>
                            <p className="text-slate-500 max-w-md mx-auto mb-6">
                                {searchQuery 
                                    ? "We couldn't find any products matching your search query. Try adjusting your search term."
                                    : "No agricultural products found in this category. Try exploring other categories or check back later!"
                                }
                            </p>
                            {searchQuery ? (
                                <button
                                    onClick={() => { setSearchQuery(""); setFilterCategory("all"); }}
                                    className="px-6 py-2.5 bg-green-50 text-green-700 font-bold rounded-xl hover:bg-green-100 transition"
                                >
                                    Clear Search
                                </button>
                            ) : isSeller ? (
                                <Link
                                    href="/marketplace/sell/create"
                                    className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold shadow-lg transition"
                                >
                                    <Plus className="w-5 h-5" />
                                    Add Your First Product
                                </Link>
                            ) : (
                                <Link
                                    href="/marketplace/onboarding"
                                    className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold shadow-lg transition"
                                >
                                    Become a Seller
                                </Link>
                            )}
                        </div>
                    )
                )}

                {/* Loading State */}
                {loading && products.length === 0 && (
                    <div className="py-24 flex flex-col items-center justify-center gap-4 text-slate-500">
                        <Loader2 className="w-10 h-10 text-green-600 animate-spin" />
                        <p className="font-semibold text-sm">Loading products...</p>
                    </div>
                )}

                {/* Loading More State */}
                {loadingMore && (
                    <div className="py-12 flex justify-center">
                        <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
                    </div>
                )}

                {/* Pagination */}
                {hasMore && !loading && !loadingMore && (
                    <div className="mt-12 flex justify-center">
                        <button
                            onClick={loadMore}
                            className="px-8 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition shadow-sm hover:shadow-md active:scale-95"
                        >
                            Load More Products
                        </button>
                    </div>
                )}

                {/* CTA Section */}
                <div className="mt-20 bg-linear-to-br from-slate-900 to-slate-800 rounded-3xl p-12 text-center text-white relative overflow-hidden shadow-xl">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.1),transparent_50%)]" />
                    <div className="relative z-10">
                        <h2 className="text-3xl font-bold mb-4">
                            {isSeller ? "List Your Commodities" : "Start Trading on Easy Market"}
                        </h2>
                        <p className="text-slate-300 text-lg mb-8 max-w-2xl mx-auto">
                            {isSeller 
                                ? "List new produce types or increase availability to match demand from local and international buyers."
                                : "Join thousands of farmers and buyers across Nigeria. Secure escrow payments and verified delivery."
                            }
                        </p>
                        <Link
                            href={isSeller ? "/marketplace/sell/create" : "/marketplace/onboarding"}
                            className="inline-flex items-center gap-2 px-8 py-4 bg-green-600 hover:bg-green-700 text-white font-bold text-lg rounded-xl shadow-lg hover:shadow-green-600/20 transition-all hover:scale-105 active:scale-95"
                        >
                            {isSeller ? (
                                <>
                                    <Plus className="w-5 h-5" />
                                    List a Product
                                </>
                            ) : (
                                "Become a Seller"
                            )}
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
