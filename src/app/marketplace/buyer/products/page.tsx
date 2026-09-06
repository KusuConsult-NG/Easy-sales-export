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
import Image from "next/image";
import { getProductsAction } from "@/app/actions/marketplace";
import { getActiveFlashSaleProductsAction } from "@/app/actions/village-market";
import type { Product, ProductCategory } from "@/lib/types/marketplace";
import { SELLER_NAME_FALLBACK } from "@/lib/seller-trust";
import { firstImageSrc } from "@/lib/first-image";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES: { id: string; name: string }[] = [
    { id: "all",         name: "All Products" },
    { id: "flash_sales", name: "Flash Sales ⚡" },
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

const categoryMapping: Record<string, string[]> = {
    grains: ["grains", "cereal", "cereals"],
    roots: ["roots", "roots_tubers", "roots & tubers", "tuber", "tubers", "yam", "yams", "cassava"],
    vegetables: ["vegetables", "vegetable", "horticultural"],
    fruits: ["fruits", "fruit"],
    nuts: ["nuts", "nut", "seed", "seeds", "sesame", "sesame seeds", "sesame_seeds"],
    spices: ["spices", "spices_herbs_seasonings", "spices & herbs", "spices_herbs", "hibiscus", "zobo"],
    livestock: ["livestock"],
    poultry: ["poultry"],
    dairy: ["dairy", "dairy & eggs", "dairy_eggs"],
    processed: ["processed", "processed foods", "processed_foods", "natural_oils", "beverages"],
    organic: ["organic", "organics"],
    sea_foods: ["sea_foods", "fishery"],
    fishery: ["fishery", "sea_foods"],
};

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

function formatCurrency(amount: any) {
    const value = Number(amount);
    const safeAmount = isNaN(value) ? 0 : value;
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(safeAmount);
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
            
            // Fetch regular products
            const productsPromise = getProductsAction({
                state:      selectedState !== "all" ? selectedState : undefined,
                searchTerm: searchQuery || undefined,
                minPrice,
                maxPrice,
            });

            // Fetch flash sales products
            const flashPromise = getActiveFlashSaleProductsAction();

            const [productsRes, flashRes] = await Promise.all([productsPromise, flashPromise]);

            let regularProducts: Product[] = [];
            if (productsRes.success && productsRes.data?.products) {
                regularProducts = productsRes.data.products;
            } else if (productsRes.error) {
                setError(productsRes.error);
            }

            // Map FlashSaleProducts to Product-like shape
            const mappedFlashProducts: Product[] = (flashRes || []).map((fp: any) => ({
                id: fp.id,
                sellerId: fp.sellerId,
                title: fp.title,
                description: fp.description || "",
                category: "flash_sales" as any,
                images: fp.images && fp.images.length > 0 ? fp.images : (fp.imageUrl ? [fp.imageUrl] : []),
                pricingTiers: [{ type: "retail", price: fp.flashPrice || fp.price, minQuantity: 1 }],
                availableQuantity: fp.availableQuantity ?? 0,
                minimumOrderQuantity: 1,
                unit: fp.unit || "unit",
                location: {
                    state: fp.location?.state || "Nigeria",
                    lga: fp.location?.lga || "",
                },
                deliveryMethod: "delivery",
                status: fp.availableQuantity === 0 ? "out_of_stock" : "active",
                bulkAvailable: false,
                // Was `rating: 5.0` with reviewCount 0, so every Village Market
                // card showed a perfect score with no reviews behind it — the
                // card only renders a rating when `rating > 0` — and "Highest
                // Rated" sorted all of them above real products with genuine
                // ratings below 5.
                rating: 0,
                reviewCount: 0,
                // Both taken from the server now.
                //
                // `sellerVerified: true` was hardcoded here, and the shield
                // below renders from it, so every Village Market listing claimed
                // a verified seller regardless of whether that seller had ever
                // been verified. getActiveFlashSaleProductsAction resolves the
                // real badge from the seller's user document; this page has no
                // seller data of its own, so inventing a value was the only way
                // it could have got one.
                sellerName: fp.sellerName || SELLER_NAME_FALLBACK,
                sellerVerified: fp.sellerVerified === true,
                isFlashSale: true,
                originalPrice: fp.price,
                flashPrice: fp.flashPrice,
                eventId: fp.eventId,
            } as any));

            // Merge products
            const allProducts = [...mappedFlashProducts, ...regularProducts];

            const sorted = [...allProducts];
            if (sortBy === "price_low")  sorted.sort((a, b) => (a.pricingTiers?.[0]?.price ?? 0) - (b.pricingTiers?.[0]?.price ?? 0));
            if (sortBy === "price_high") sorted.sort((a, b) => (b.pricingTiers?.[0]?.price ?? 0) - (a.pricingTiers?.[0]?.price ?? 0));
            if (sortBy === "rating")     sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
            setProducts(sorted);
        } catch (e: any) {
            setError(e.message ?? "Unexpected error");
            setProducts([]);
        } finally {
            setLoading(false);
        }
    }, [selectedState, priceRange, sortBy, searchQuery]);

    // Re-fetch when filters change (debounce search)
    useEffect(() => {
        const timer = setTimeout(() => { fetchProducts(); }, searchQuery ? 400 : 0);
        return () => clearTimeout(timer);
    }, [fetchProducts, searchQuery]);

    // Category counts derived from loaded products
    const categoryCounts = CATEGORIES.reduce((acc, cat) => {
        acc[cat.id] = cat.id === "all"
            ? products.length
            : products.filter(p => {
                if (cat.id === "flash_sales") return (p as any).isFlashSale === true;
                if ((p as any).isFlashSale) return false;
                const pCat = p.category?.toLowerCase() || "";
                const mapped = categoryMapping[cat.id] || [cat.id];
                return mapped.includes(pCat);
              }).length;
        return acc;
    }, {} as Record<string, number>);

    // Client-side category filtering
    const displayedProducts = products.filter(p => {
        if (selectedCategory === "all") return true;
        if (selectedCategory === "flash_sales") return (p as any).isFlashSale === true;
        if ((p as any).isFlashSale) return false;
        
        const pCat = p.category?.toLowerCase() || "";
        const mapped = categoryMapping[selectedCategory] || [selectedCategory];
        return mapped.includes(pCat);
    });

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
                                    <>Showing <span className="font-semibold text-slate-900">{displayedProducts.length}</span> product{displayedProducts.length !== 1 ? "s" : ""}</>
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
                        {!loading && !error && displayedProducts.length === 0 && (
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
                        {!loading && !error && displayedProducts.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                {displayedProducts.map((product) => {
                                    const basePrice = product.pricingTiers?.[0]?.price ?? 0;
                                    const minQty    = product.pricingTiers?.[0]?.minQuantity ?? 1;
                                    const productId = (product as any).id ?? (product as any).productId;
                                    const isFS      = (product as any).isFlashSale === true;

                                    return (
                                        <div
                                            key={productId}
                                            className={`bg-white rounded-xl border overflow-hidden hover:shadow-lg transition-all duration-300 group flex flex-col ${
                                                isFS ? "border-red-200 ring-1 ring-red-50" : "border-slate-200"
                                            }`}
                                        >
                                            {/* Product Image */}
                                            <div className="h-44 bg-slate-100 relative overflow-hidden">
                                                {firstImageSrc(product.images) ? (
                                                    <Image
                                                        src={firstImageSrc(product.images)!}
                                                        alt={product.title}
                                                        fill
                                                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
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
                                                {product.availableQuantity === 0 || product.status === "out_of_stock" ? (
                                                    <span className="absolute top-3 right-3 bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm">
                                                        Out of Stock
                                                    </span>
                                                ) : (product.availableQuantity ?? 9999) <= 5 ? (
                                                    <span className="absolute top-3 right-3 bg-orange-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-md animate-pulse">
                                                        Only {product.availableQuantity} left!
                                                    </span>
                                                ) : null}
                                                {isFS && (
                                                    <span className="absolute top-3 right-3 bg-red-600 text-white text-xs font-extrabold px-2.5 py-1 rounded-full shadow animate-pulse">
                                                        FLASH DEAL
                                                    </span>
                                                )}
                                            </div>

                                            {/* Product Info */}
                                            <div className="p-5 flex flex-col flex-1">
                                                <h3 className={`font-bold text-slate-900 mb-1 transition-colors line-clamp-1 ${
                                                    isFS ? "group-hover:text-red-600" : "group-hover:text-green-600"
                                                }`}>
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
                                                        {isFS ? (
                                                            <div className="flex flex-col">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-lg font-bold text-red-600">
                                                                        {formatCurrency((product as any).flashPrice || basePrice)}
                                                                    </span>
                                                                    <span className="text-xs text-slate-400 line-through">
                                                                        {formatCurrency((product as any).originalPrice || basePrice)}
                                                                    </span>
                                                                </div>
                                                                <span className="text-[10px] text-red-600 font-extrabold">Village Market Flash Sale</span>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div className="text-lg font-bold text-green-600">
                                                                    {formatCurrency(basePrice)}
                                                                </div>
                                                                <div className="text-xs text-slate-400">
                                                                    per {product.unit} · Min: {minQty} {product.unit}
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                    <Link
                                                        href={isFS ? `/marketplace/village-market/${(product as any).eventId}` : `/marketplace/products/${productId}`}
                                                        className={`flex items-center gap-2 px-3 py-2 text-white rounded-lg transition text-sm font-semibold ${
                                                            isFS ? "bg-red-600 hover:bg-red-700 shadow-red-600/10" : "bg-green-600 hover:bg-green-700"
                                                        }`}
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
