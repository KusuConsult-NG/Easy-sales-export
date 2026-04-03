/**
 * Marketplace Product Browser
 * Live Firestore data — replaces hardcoded fake products
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Search,
    Filter,
    Star,
    ShoppingCart,
    MapPin,
    Loader2,
    Package,
    AlertCircle,
    ShieldCheck,
    RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { getProductsAction } from "@/app/actions/marketplace-buyer";
import type { Product, ProductCategory } from "@/lib/types/marketplace";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: { id: string; name: string }[] = [
    { id: "all",         name: "All Products" },
    { id: "grains",      name: "Grains & Cereals" },
    { id: "roots",       name: "Roots & Tubers" },
    { id: "vegetables",  name: "Vegetables" },
    { id: "fruits",      name: "Fruits" },
    { id: "nuts",        name: "Nuts & Seeds" },
    { id: "spices",      name: "Spices & Herbs" },
    { id: "livestock",   name: "Livestock" },
    { id: "poultry",     name: "Poultry" },
    { id: "dairy",       name: "Dairy & Eggs" },
    { id: "processed",   name: "Processed Foods" },
    { id: "organic",     name: "Organic Products" },
];

const NIGERIAN_STATES = [
    "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
    "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
    "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
    "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba",
    "Yobe","Zamfara",
];

const PRICE_RANGES = [
    { value: "all",          label: "All Prices" },
    { value: "under_2000",   label: "Under ₦2,000" },
    { value: "2000_5000",    label: "₦2,000 – ₦5,000" },
    { value: "5000_10000",   label: "₦5,000 – ₦10,000" },
    { value: "over_10000",   label: "Over ₦10,000" },
];

function priceRangeToFilter(range: string): { minPrice?: number; maxPrice?: number } {
    switch (range) {
        case "under_2000":  return { maxPrice: 2000 };
        case "2000_5000":   return { minPrice: 2000, maxPrice: 5000 };
        case "5000_10000":  return { minPrice: 5000, maxPrice: 10000 };
        case "over_10000":  return { minPrice: 10000 };
        default:            return {};
    }
}

function formatCurrency(amount: number) {
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProductsPage() {
    const [searchQuery,      setSearchQuery]      = useState("");
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [selectedState,    setSelectedState]    = useState("all");
    const [priceRange,       setPriceRange]       = useState("all");
    const [sortBy,           setSortBy]           = useState("newest");

    const [products,  setProducts]  = useState<Product[]>([]);
    const [loading,   setLoading]   = useState(true);
    const [error,     setError]     = useState<string | null>(null);

    // Debounced fetch
    const fetchProducts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { minPrice, maxPrice } = priceRangeToFilter(priceRange);
            const result = await getProductsAction({
                category:   selectedCategory !== "all" ? (selectedCategory as ProductCategory) : undefined,
                state:      selectedState !== "all" ? selectedState : undefined,
                searchTerm: searchQuery || undefined,
                minPrice,
                maxPrice,
            });

            if (result.success && result.products) {
                const sorted = [...result.products];
                if (sortBy === "price_low")  sorted.sort((a, b) => (a.pricingTiers[0]?.price ?? 0) - (b.pricingTiers[0]?.price ?? 0));
                if (sortBy === "price_high") sorted.sort((a, b) => (b.pricingTiers[0]?.price ?? 0) - (a.pricingTiers[0]?.price ?? 0));
                if (sortBy === "rating")     sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
                setProducts(sorted);
            } else {
                setError((result as any).error ?? "Failed to load products");
                setProducts([]);
            }
        } catch (e: any) {
            setError(e.message ?? "Unexpected error");
            setProducts([]);
        } finally {
            setLoading(false);
        }
    }, [selectedCategory, selectedState, priceRange, sortBy, searchQuery]);

    // Re-fetch when filters change (debounce search)
    useEffect(() => {
        const timer = setTimeout(() => { fetchProducts(); }, searchQuery ? 400 : 0);
        return () => clearTimeout(timer);
    }, [fetchProducts, searchQuery]);

    // Category counts derived from loaded products
    const categoryCounts = CATEGORIES.reduce((acc, cat) => {
        acc[cat.id] = cat.id === "all"
            ? products.length
            : products.filter(p => p.category === cat.id).length;
        return acc;
    }, {} as Record<string, number>);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-8 py-6">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Browse Products</h1>
                    <p className="text-slate-600">
                        Discover quality agricultural products from verified sellers across Nigeria
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-8">
                {/* Search + Filters */}
                <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
                    <div className="relative mb-6">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search products, sellers, or categories..."
                            className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Sort */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">Sort By</label>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                            >
                                <option value="newest">Newest First</option>
                                <option value="price_low">Price: Low to High</option>
                                <option value="price_high">Price: High to Low</option>
                                <option value="rating">Highest Rated</option>
                            </select>
                        </div>

                        {/* Location */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">Location</label>
                            <select
                                value={selectedState}
                                onChange={(e) => setSelectedState(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                            >
                                <option value="all">All States</option>
                                {NIGERIAN_STATES.map(state => (
                                    <option key={state} value={state}>{state}</option>
                                ))}
                            </select>
                        </div>

                        {/* Price Range */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-2">Price Range</label>
                            <select
                                value={priceRange}
                                onChange={(e) => setPriceRange(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                            >
                                {PRICE_RANGES.map(r => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Categories Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-xl border border-slate-200 p-6 sticky top-8">
                            <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                                <Filter className="w-5 h-5" />
                                Categories
                            </h3>
                            <div className="space-y-1">
                                {CATEGORIES.map((cat) => (
                                    <button
                                        key={cat.id}
                                        onClick={() => setSelectedCategory(cat.id)}
                                        className={`w-full text-left px-4 py-2.5 rounded-lg transition-colors ${
                                            selectedCategory === cat.id
                                                ? "bg-green-50 text-green-700 font-semibold"
                                                : "text-slate-700 hover:bg-slate-50"
                                        }`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm">{cat.name}</span>
                                            <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full">
                                                {loading ? "…" : (categoryCounts[cat.id] ?? 0)}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Products Grid */}
                    <div className="lg:col-span-3">
                        {/* Result count */}
                        <div className="flex items-center justify-between mb-6">
                            <p className="text-slate-600 text-sm">
                                {loading ? (
                                    "Loading products…"
                                ) : (
                                    <>Showing <span className="font-semibold text-slate-900">{products.length}</span> product{products.length !== 1 ? "s" : ""}</>
                                )}
                            </p>
                            {!loading && (
                                <button
                                    onClick={fetchProducts}
                                    className="flex items-center gap-1 text-sm text-slate-500 hover:text-green-600 transition"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Refresh
                                </button>
                            )}
                        </div>

                        {/* Loading */}
                        {loading && (
                            <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
                                <Loader2 className="w-10 h-10 animate-spin text-green-600" />
                                <p className="text-slate-500 text-sm">Loading products…</p>
                            </div>
                        )}

                        {/* Error */}
                        {!loading && error && (
                            <div className="flex flex-col items-center justify-center min-h-[30vh] gap-4">
                                <AlertCircle className="w-10 h-10 text-red-400" />
                                <p className="text-slate-600">{error}</p>
                                <button
                                    onClick={fetchProducts}
                                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition"
                                >
                                    Retry
                                </button>
                            </div>
                        )}

                        {/* Empty State */}
                        {!loading && !error && products.length === 0 && (
                            <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3">
                                <Package className="w-14 h-14 text-slate-300" />
                                <h3 className="font-semibold text-slate-800">No products found</h3>
                                <p className="text-slate-500 text-sm text-center max-w-xs">
                                    {searchQuery
                                        ? `No results for "${searchQuery}". Try a different search term or filter.`
                                        : "No products match your current filters. Try adjusting the category or location."}
                                </p>
                                <button
                                    onClick={() => {
                                        setSearchQuery("");
                                        setSelectedCategory("all");
                                        setSelectedState("all");
                                        setPriceRange("all");
                                    }}
                                    className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                                >
                                    Clear All Filters
                                </button>
                            </div>
                        )}

                        {/* Product Cards */}
                        {!loading && !error && products.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                {products.map((product) => {
                                    const basePrice = product.pricingTiers?.[0]?.price ?? 0;
                                    const minQty    = product.pricingTiers?.[0]?.minQuantity ?? 1;
                                    const productId = (product as any).id ?? (product as any).productId;

                                    return (
                                        <div
                                            key={productId}
                                            className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg transition-shadow group flex flex-col"
                                        >
                                            {/* Product Image */}
                                            <div className="h-44 bg-slate-100 relative overflow-hidden">
                                                {product.images?.[0] ? (
                                                    <img
                                                        src={product.images[0]}
                                                        alt={product.title}
                                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center">
                                                        <Package className="w-10 h-10 text-slate-300" />
                                                    </div>
                                                )}
                                                {product.sellerVerified && (
                                                    <span
                                                        title="Verified Seller"
                                                        className="absolute top-3 left-3 flex items-center gap-1 bg-white/90 backdrop-blur-sm text-emerald-700 text-xs font-semibold px-2 py-1 rounded-full shadow-sm"
                                                    >
                                                        <ShieldCheck className="w-3 h-3" />
                                                        Verified
                                                    </span>
                                                )}
                                                {product.status === "out_of_stock" && (
                                                    <span className="absolute top-3 right-3 bg-red-100 text-red-700 text-xs font-semibold px-2 py-1 rounded-full">
                                                        Out of Stock
                                                    </span>
                                                )}
                                            </div>

                                            {/* Product Info */}
                                            <div className="p-5 flex flex-col flex-1">
                                                <h3 className="font-bold text-slate-900 mb-1 group-hover:text-green-600 transition-colors line-clamp-1">
                                                    {product.title}
                                                </h3>
                                                <p className="text-sm text-slate-500 mb-3 line-clamp-2 flex-1">
                                                    {product.description}
                                                </p>

                                                {/* Seller & Location */}
                                                <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
                                                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                                                    <span className="truncate">
                                                        {product.sellerName ?? "Seller"} · {product.location?.state ?? "Nigeria"}
                                                    </span>
                                                </div>

                                                {/* Rating */}
                                                {product.rating > 0 && (
                                                    <div className="flex items-center gap-1.5 mb-3">
                                                        <Star className="w-3.5 h-3.5 text-yellow-500 fill-current" />
                                                        <span className="text-sm font-semibold text-slate-900">
                                                            {product.rating.toFixed(1)}
                                                        </span>
                                                        <span className="text-xs text-slate-400">
                                                            ({(product as any).reviewCount ?? 0} reviews)
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Price + CTA */}
                                                <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-auto">
                                                    <div>
                                                        <div className="text-lg font-bold text-green-600">
                                                            {formatCurrency(basePrice)}
                                                        </div>
                                                        <div className="text-xs text-slate-400">
                                                            per {product.unit} · Min: {minQty} {product.unit}
                                                        </div>
                                                    </div>
                                                    <Link
                                                        href={`/marketplace/products/${productId}`}
                                                        className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-semibold"
                                                    >
                                                        <ShoppingCart className="w-4 h-4" />
                                                        View
                                                    </Link>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
