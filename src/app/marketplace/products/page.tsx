"use client";

import { Package, Search, Filter, Grid, List, Loader2, Star, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMarketplaceSearch } from "@/hooks/useMarketplaceSearch";

export default function MarketplaceProductsPage() {
    const {
        products,
        loading,
        error,
        hasMore,
        loadMore,
        filters: {
            query,
            setQuery,
            category,
            setCategory,
            state,
            setState
        }
    } = useMarketplaceSearch();

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-linear-to-r from-green-600 to-emerald-600 text-white py-16">
                <div className="max-w-7xl mx-auto px-8">
                    <div className="flex items-center gap-3 mb-4">
                        <Package className="w-8 h-8" />
                        <h1 className="text-4xl font-bold">Browse Products</h1>
                    </div>
                    <p className="text-green-100 text-lg max-w-2xl">
                        Discover quality agricultural commodities from verified sellers across Nigeria
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
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search products..."
                                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition"
                                />
                            </div>
                        </div>

                        {/* Category Filter */}
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition"
                        >
                            <option>All Categories</option>
                            <option value="grains">Grains & Cereals</option>
                            <option value="vegetables">Fruits & Vegetables</option>
                            <option value="nuts">Nuts & Seeds</option>
                            <option value="spices">Spices & Herbs</option>
                            <option value="livestock">Livestock</option>
                            <option value="processed">Processed Products</option>
                        </select>

                        {/* Location Filter */}
                        <select
                            value={state}
                            onChange={(e) => setState(e.target.value)}
                            className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition"
                        >
                            <option>All Locations</option>
                            <option>Abuja</option>
                            <option>Lagos</option>
                            <option>Kano</option>
                            <option>Kaduna</option>
                            <option>Benue</option>
                            <option>Plateau</option>
                            <option>Rivers</option>
                        </select>

                        {/* View Toggle (Visual only for now) */}
                        <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl">
                            <button className="p-2 bg-white rounded-lg shadow-sm">
                                <Grid className="w-5 h-5 text-green-600" />
                            </button>
                            <button className="p-2 hover:bg-white/50 rounded-lg transition">
                                <List className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Error State */}
                {error && (
                    <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-8 text-center">
                        {error}
                    </div>
                )}

                {/* Products Grid */}
                {products.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {products.map((product) => (
                            <Link href={`/marketplace/products/${product.id}`} key={product.id} className="block group">
                                <div className="bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all hover:-translate-y-1 h-full flex flex-col">
                                    {/* Product Image */}
                                    <div className="relative h-56 bg-slate-200">
                                        {product.images && product.images[0] ? (
                                            <Image
                                                src={product.images[0]}
                                                alt={product.title}
                                                fill
                                                className="object-cover group-hover:scale-105 transition-transform duration-500"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                <Package className="w-12 h-12" />
                                            </div>
                                        )}
                                        {product.exportReady && (
                                            <div className="absolute top-4 right-4">
                                                <span className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full shadow-sm">
                                                    Export Ready
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Product Details */}
                                    <div className="p-6 flex-1 flex flex-col">
                                        <h3 className="text-xl font-bold text-slate-900 mb-2 line-clamp-1">
                                            {product.title}
                                        </h3>
                                        <p className="text-sm text-slate-600 mb-1">
                                            by {product.sellerName || "Verified Seller"}
                                        </p>
                                        <div className="flex items-center gap-1 text-slate-500 mb-4 text-sm">
                                            <MapPin className="w-3 h-3" />
                                            {product.location?.state || "Nigeria"}
                                        </div>

                                        <div className="mt-auto pt-4 border-t border-slate-200 flex justify-between items-center">
                                            <div>
                                                <div className="text-2xl font-bold text-green-600">
                                                    ₦{product.pricingTiers?.[0]?.price?.toLocaleString() ?? "N/A"}
                                                </div>
                                                <div className="text-xs text-slate-500">per {product.unit}</div>
                                            </div>
                                            <div className="flex items-center gap-1 text-yellow-500 text-sm font-bold bg-yellow-50 px-2 py-1 rounded-lg">
                                                <Star className="w-3 h-3 fill-current" />
                                                {product.rating || "New"}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    !loading && (
                        <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-slate-200">
                            <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">No products found</h3>
                            <p className="text-slate-500 max-w-md mx-auto">
                                We couldn't find any products matching your search. Try adjusting your filters.
                            </p>
                            <button
                                onClick={() => { setQuery(""); setCategory("All Categories"); setState("All Locations"); }}
                                className="mt-6 text-green-600 font-semibold hover:underline"
                            >
                                Clear all filters
                            </button>
                        </div>
                    )
                )}

                {/* Loading State */}
                {loading && (
                    <div className="py-12 flex justify-center">
                        <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
                    </div>
                )}

                {/* Pagination */}
                {hasMore && !loading && (
                    <div className="mt-12 flex justify-center">
                        <button
                            onClick={loadMore}
                            className="px-8 py-3 bg-white border border-slate-200 rounded-xl font-semibold hover:bg-slate-50 transition shadow-sm hover:shadow-md"
                        >
                            Load More Products
                        </button>
                    </div>
                )}

                {/* CTA Section */}
                <div className="mt-16 bg-linear-to-r from-green-600 to-emerald-600 rounded-3xl p-12 text-center text-white">
                    <h2 className="text-3xl font-bold mb-4">
                        Want to Sell Your Products?
                    </h2>
                    <p className="text-xl mb-8 text-green-100 max-w-2xl mx-auto">
                        Join thousands of sellers reaching buyers across Nigeria
                    </p>
                    <Link
                        href="/marketplace/onboarding"
                        className="inline-flex items-center gap-2 px-10 py-4 bg-white text-green-600 font-bold text-lg rounded-xl shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                    >
                        <Package className="w-5 h-5" />
                        Start Selling Today
                    </Link>
                </div>
            </div>
        </div>
    );
}
