"use client";

import { useState } from "react";
import Link from "next/link";
import {
    ArrowRight, Search, Filter, ShoppingCart, MapPin, CheckCircle,
    Plus, Minus, X, ChevronRight
} from "lucide-react";
import BackToHub from "@/components/common/BackToHub";
import { useExportCart, type ExportProduct } from "@/contexts/ExportCartContext";

// ── Product Data ──────────────────────────────────────────────────────────────

const PRODUCTS: ExportProduct[] = [
    {
        id: "cashew-nuts",
        name: "Cashew Nuts",
        icon: "🥜",
        origin: "Ogbomoso, Oyo State",
        season: "Feb - May",
        category: "nuts",
        grades: ["W320", "W240", "W210", "Scorched"],
        certifications: ["NAFDAC", "SON", "Phytosanitary"],
        pricePerMT: 2850,
        minOrderMT: 20,
    },
    {
        id: "sesame-seeds",
        name: "Sesame Seeds",
        icon: "🌰",
        origin: "Jigawa & Nassarawa",
        season: "Oct - Jan",
        category: "nuts",
        grades: ["White (99%)", "Brown (98%)", "Black (97%)"],
        certifications: ["NAFDAC", "SGS", "Phytosanitary"],
        pricePerMT: 1750,
        minOrderMT: 25,
    },
    {
        id: "dried-hibiscus",
        name: "Dried Hibiscus (Zobo)",
        icon: "🌺",
        origin: "Kano & Jigawa",
        season: "Nov - Mar",
        category: "spices",
        grades: ["Dark Red", "Light Red", "Machine-Cut"],
        certifications: ["NAFDAC", "SON", "EU Compliant"],
        pricePerMT: 2200,
        minOrderMT: 15,
    },
    {
        id: "cocoa-beans",
        name: "Cocoa Beans",
        icon: "🫘",
        origin: "Ondo & Cross River",
        season: "Sep - Feb",
        category: "nuts",
        grades: ["Grade A", "Grade B", "Fermented"],
        certifications: ["NAFDAC", "ICO", "Rainforest Alliance"],
        pricePerMT: 3400,
        minOrderMT: 10,
    },
    {
        id: "shea-butter",
        name: "Shea Butter",
        icon: "🧴",
        origin: "Niger & Kwara",
        season: "Year-round",
        category: "oils",
        grades: ["Unrefined Grade A", "Refined", "Ultra-Refined"],
        certifications: ["NAFDAC", "Organic Certified"],
        pricePerMT: 1900,
        minOrderMT: 5,
    },
    {
        id: "ginger",
        name: "Ginger",
        icon: "🫚",
        origin: "Kaduna & Nasarawa",
        season: "Nov - Mar",
        category: "spices",
        grades: ["Split Dried", "Whole Dried", "Powder"],
        certifications: ["NAFDAC", "SON", "EU Compliant"],
        pricePerMT: 2600,
        minOrderMT: 15,
    },
    {
        id: "moringa-leaves",
        name: "Moringa Leaves (Dried)",
        icon: "🍃",
        origin: "Kebbi & Sokoto",
        season: "Year-round",
        category: "spices",
        grades: ["Grade A Powder", "Whole Dried", "Tea Cut"],
        certifications: ["NAFDAC", "Organic Certified", "EU Compliant"],
        pricePerMT: 3200,
        minOrderMT: 5,
    },
    {
        id: "charcoal",
        name: "Hardwood Charcoal",
        icon: "🪵",
        origin: "Benue & Nassarawa",
        season: "Year-round",
        category: "other",
        grades: ["Lump (80mm+)", "Restaurant Grade", "BBQ Grade"],
        certifications: ["SON", "FSC Compliant"],
        pricePerMT: 450,
        minOrderMT: 28,
    },
];

const CATEGORIES = [
    { id: "all", name: "All Products", icon: "📦" },
    { id: "nuts", name: "Nuts & Seeds", icon: "🥜" },
    { id: "spices", name: "Spices & Herbs", icon: "🌿" },
    { id: "oils", name: "Oils & Butters", icon: "🧴" },
    { id: "other", name: "Other", icon: "📋" },
];

// ── Product Card ──────────────────────────────────────────────────────────────

function ProductCard({ product }: { product: ExportProduct }) {
    const { addToCart, cart } = useExportCart();
    const [selectedGrade, setSelectedGrade] = useState(product.grades[0]);
    const [quantity, setQuantity] = useState(product.minOrderMT);
    const [showDetails, setShowDetails] = useState(false);

    const inCart = cart.find(item => item.product.id === product.id);

    const handleAddToCart = () => {
        addToCart(product, quantity, selectedGrade);
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg transition-all duration-300 group">
            {/* Header with emoji + name */}
            <div className="p-5 pb-3">
                <div className="flex items-start gap-3 mb-3">
                    <div className="text-4xl">{product.icon}</div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                            {product.name}
                        </h3>
                        <p className="text-sm text-slate-500 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {product.origin}
                        </p>
                    </div>
                    {inCart && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg">
                            In Cart
                        </span>
                    )}
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-2xl font-bold text-blue-600">
                        ${product.pricePerMT.toLocaleString()}
                    </span>
                    <span className="text-sm text-slate-500">/ MT</span>
                </div>

                {/* Quick info */}
                <div className="flex items-center gap-4 text-xs text-slate-600 mb-3">
                    <span>Min: {product.minOrderMT} MT</span>
                    <span>•</span>
                    <span>{product.season}</span>
                </div>

                {/* Certifications */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                    {product.certifications.map((cert, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 text-xs font-medium rounded-md">
                            <CheckCircle className="w-3 h-3" />
                            {cert}
                        </span>
                    ))}
                </div>
            </div>

            {/* Expandable details */}
            <div className="px-5 border-t border-slate-100">
                <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="w-full py-3 flex items-center justify-between text-sm font-medium text-slate-600 hover:text-blue-600 transition"
                >
                    <span>{showDetails ? "Hide details" : "Select grade & quantity"}</span>
                    <ChevronRight className={`w-4 h-4 transition-transform ${showDetails ? "rotate-90" : ""}`} />
                </button>

                {showDetails && (
                    <div className="pb-4 space-y-4 animate-in fade-in duration-200">
                        {/* Grade selector */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                Select Grade
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {product.grades.map((grade) => (
                                    <button
                                        key={grade}
                                        onClick={() => setSelectedGrade(grade)}
                                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${selectedGrade === grade
                                            ? "bg-blue-600 text-white"
                                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                            }`}
                                    >
                                        {grade}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Quantity selector */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                Quantity (Metric Tons)
                            </label>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setQuantity(Math.max(product.minOrderMT, quantity - 5))}
                                    className="w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                                >
                                    <Minus className="w-4 h-4" />
                                </button>
                                <input
                                    type="number"
                                    value={quantity}
                                    onChange={(e) => setQuantity(Math.max(product.minOrderMT, Number(e.target.value)))}
                                    className="w-24 text-center px-3 py-2 border border-slate-300 rounded-lg font-semibold text-slate-900"
                                    min={product.minOrderMT}
                                />
                                <button
                                    onClick={() => setQuantity(quantity + 5)}
                                    className="w-10 h-10 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                                <span className="text-sm text-slate-500">MT</span>
                            </div>
                        </div>

                        {/* Subtotal + Add to cart */}
                        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                            <div>
                                <p className="text-xs text-slate-500">Estimated value</p>
                                <p className="text-lg font-bold text-slate-900">
                                    ${(product.pricePerMT * quantity).toLocaleString()}
                                </p>
                            </div>
                            <button
                                onClick={handleAddToCart}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg hover:shadow-blue-500/25"
                            >
                                <ShoppingCart className="w-4 h-4" />
                                {inCart ? "Update Cart" : "Add to Cart"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Cart Sidebar ──────────────────────────────────────────────────────────────

function CartSidebar() {
    const { cart, removeFromCart, updateQuantity, cartTotal, isCartOpen, setIsCartOpen, cartCount } = useExportCart();

    if (!isCartOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
                onClick={() => setIsCartOpen(false)}
            />

            {/* Sidebar */}
            <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-200">
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        <ShoppingCart className="w-5 h-5 text-blue-600" />
                        Export Cart ({cartCount})
                    </h2>
                    <button
                        onClick={() => setIsCartOpen(false)}
                        className="p-2 hover:bg-slate-100 rounded-lg transition"
                    >
                        <X className="w-5 h-5 text-slate-600" />
                    </button>
                </div>

                {/* Cart Items */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {cart.length === 0 ? (
                        <div className="text-center py-12">
                            <ShoppingCart className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                            <p className="text-slate-500 font-medium">Your cart is empty</p>
                            <p className="text-sm text-slate-400 mt-1">Add export products to get started</p>
                        </div>
                    ) : (
                        cart.map((item) => (
                            <div
                                key={item.product.id}
                                className="bg-slate-50 rounded-xl p-4"
                            >
                                <div className="flex items-start gap-3">
                                    <div className="text-2xl">{item.product.icon}</div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-bold text-slate-900 text-sm">{item.product.name}</h4>
                                        <p className="text-xs text-slate-500">Grade: {item.grade}</p>
                                        <p className="text-xs text-slate-500">${item.product.pricePerMT.toLocaleString()} / MT</p>
                                    </div>
                                    <button
                                        onClick={() => removeFromCart(item.product.id)}
                                        className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500 transition"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>

                                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-200">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => updateQuantity(item.product.id, item.quantityMT - 5)}
                                            className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition"
                                        >
                                            <Minus className="w-3 h-3" />
                                        </button>
                                        <span className="text-sm font-semibold px-2">{item.quantityMT} MT</span>
                                        <button
                                            onClick={() => updateQuantity(item.product.id, item.quantityMT + 5)}
                                            className="w-8 h-8 flex items-center justify-center bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition"
                                        >
                                            <Plus className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <p className="font-bold text-slate-900">
                                        ${(item.product.pricePerMT * item.quantityMT).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                {cart.length > 0 && (
                    <div className="border-t border-slate-200 p-6 space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-600">Estimated Total</span>
                            <span className="text-2xl font-bold text-slate-900">
                                ${cartTotal.toLocaleString()}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500">
                            Final pricing will be confirmed in your quotation based on grade, quantity, and shipping terms.
                        </p>
                        <Link
                            href="/export/buyer/cart"
                            onClick={() => setIsCartOpen(false)}
                            className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg"
                        >
                            Proceed to Checkout
                            <ArrowRight className="w-5 h-5" />
                        </Link>
                    </div>
                )}
            </div>
        </>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExportBuyerPage() {
    const { cartCount, setIsCartOpen } = useExportCart();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("all");

    const filteredProducts = PRODUCTS.filter((product) => {
        const matchesSearch =
            product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.origin.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === "all" || product.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    return (
        <div className="min-h-screen bg-slate-50">
            <CartSidebar />

            {/* Header */}
            <div className="relative overflow-hidden bg-linear-to-br from-blue-700 via-blue-600 to-indigo-600 text-white">
                <BackToHub variant="dark" className="top-4 left-4 border-white/20" />
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-4 md:px-8 py-10 md:py-16">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl md:text-4xl font-bold mb-2">
                                Export Product Catalog
                            </h1>
                            <p className="text-blue-100 text-lg">
                                Browse, select, and request quotes for premium Nigerian agricultural products
                            </p>
                        </div>

                        {/* Cart button */}
                        <button
                            onClick={() => setIsCartOpen(true)}
                            className="relative p-3 md:p-4 bg-white/10 backdrop-blur-sm border-2 border-white/30 rounded-xl hover:bg-white/20 transition"
                        >
                            <ShoppingCart className="w-6 h-6" />
                            {cartCount > 0 && (
                                <span className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                    {cartCount}
                                </span>
                            )}
                        </button>
                    </div>
                </div>
                {/* Wave */}
                <div className="absolute bottom-0 left-0 right-0">
                    <svg viewBox="0 0 1440 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
                        <path d="M0 0L60 5C120 10 240 20 360 23.3C480 27 600 23 720 21.7C840 20 960 20 1080 23.3C1200 27 1320 33 1380 36.7L1440 40V60H0V0Z" fill="rgb(248 250 252)" />
                    </svg>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
                {/* Search and Filters */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 md:p-6 mb-8">
                    <div className="flex flex-col md:flex-row gap-4">
                        {/* Search */}
                        <div className="relative flex-1">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search products, origins..."
                                className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-xl bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>

                        {/* Category filter */}
                        <div className="flex flex-wrap gap-2">
                            {CATEGORIES.map((cat) => (
                                <button
                                    key={cat.id}
                                    onClick={() => setSelectedCategory(cat.id)}
                                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition ${selectedCategory === cat.id
                                        ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
                                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                        }`}
                                >
                                    <span>{cat.icon}</span>
                                    {cat.name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Results count */}
                <p className="text-slate-600 mb-6">
                    Showing <span className="font-semibold text-slate-900">{filteredProducts.length}</span> products
                    {selectedCategory !== "all" && (
                        <> in <span className="font-semibold text-blue-600">{CATEGORIES.find(c => c.id === selectedCategory)?.name}</span></>
                    )}
                </p>

                {/* Product Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-12">
                    {filteredProducts.map((product) => (
                        <ProductCard key={product.id} product={product} />
                    ))}
                </div>

                {filteredProducts.length === 0 && (
                    <div className="text-center py-12">
                        <Filter className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-500 font-medium">No products match your search</p>
                        <p className="text-sm text-slate-400 mt-1">Try adjusting your filters or search terms</p>
                    </div>
                )}

                {/* Bottom CTA - Cart */}
                {cartCount > 0 && (
                    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
                        <button
                            onClick={() => setIsCartOpen(true)}
                            className="inline-flex items-center gap-3 px-8 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-2xl shadow-blue-500/30 hover:bg-blue-700 transition hover:scale-105"
                        >
                            <ShoppingCart className="w-5 h-5" />
                            View Cart ({cartCount} items)
                            <ArrowRight className="w-5 h-5" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
