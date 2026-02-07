"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, Filter, ShoppingCart, X, Plus, Minus, Store, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getProductsAction, getFeaturedProductsAction } from "@/app/actions/marketplace-buyer";
import type { Product } from "@/lib/types/marketplace";

interface CartItem extends Product {
    quantity: number;
}

export default function MarketplacePage() {
    const router = useRouter();
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [priceRange, setPriceRange] = useState([0, 500000]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isCartOpen, setIsCartOpen] = useState(false);

    const categories = [
        { value: "all", label: "All Products" },
        { value: "grains", label: "Grains & Cereals" },
        { value: "vegetables", label: "Vegetables" },
        { value: "fruits", label: "Fruits" },
        { value: "livestock", label: "Livestock" },
        { value: "poultry", label: "Poultry" },
        { value: "fishery", label: "Fishery" },
        { value: "processed", label: "Processed Foods" },
        { value: "equipment", label: "Farm Equipment" },
        { value: "other", label: "Other" },
    ];

    // Load products on mount
    useEffect(() => {
        loadProducts();
    }, []);

    async function loadProducts() {
        setLoading(true);
        try {
            const result = await getProductsAction();
            if (result.success) {
                setProducts(result.products || []);
            }
        } catch (error) {
            console.error("Failed to load products:", error);
        } finally {
            setLoading(false);
        }
    }

    // Filter products
    const filteredProducts = products.filter((product) => {
        const matchesSearch = product.title
            .toLowerCase()
            .includes(searchQuery.toLowerCase());
        const matchesCategory =
            selectedCategory === "all" || product.category === selectedCategory;
        const price = product.pricingTiers[0]?.price || 0;
        const matchesPrice =
            price >= priceRange[0] && price <= priceRange[1];
        return matchesSearch && matchesCategory && matchesPrice;
    });

    // Add to cart
    const addToCart = (product: Product) => {
        const existingItem = cart.find((item) => item.id === product.id);
        if (existingItem) {
            setCart(
                cart.map((item) =>
                    item.id === product.id
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                )
            );
        } else {
            setCart([...cart, { ...product, quantity: 1 }]);
        }
        setIsCartOpen(true);
    };

    // Update quantity
    const updateQuantity = (id: string, delta: number) => {
        setCart(
            cart
                .map((item) =>
                    item.id === id ? { ...item, quantity: item.quantity + delta } : item
                )
                .filter((item) => item.quantity > 0)
        );
    };

    // Remove from cart
    const removeFromCart = (id: string) => {
        setCart(cart.filter((item) => item.id !== id));
    };

    // Calculate total
    const cartTotal = cart.reduce(
        (sum, item) => sum + (item.pricingTiers[0]?.price || 0) * item.quantity,
        0
    );

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="p-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Marketplace
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Browse and purchase premium agricultural commodities
                    </p>
                </div>

                {/* Search & Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Search Bar */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search products..."
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>

                        {/* Category Filter */}
                        <div className="flex items-center gap-2">
                            <Filter className="w-5 h-5 text-slate-500" />
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="flex-1 px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                {categories.map((cat) => (
                                    <option key={cat.value} value={cat.value}>
                                        {cat.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Cart Button */}
                        <button
                            onClick={() => setIsCartOpen(!isCartOpen)}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors relative"
                        >
                            <ShoppingCart className="w-5 h-5" />
                            Cart
                            {cart.length > 0 && (
                                <span className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                    {cart.length}
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Price Range Slider */}
                    <div className="mt-6">
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-3">
                            Price Range: {formatCurrency(priceRange[0])} -{" "}
                            {formatCurrency(priceRange[1])}
                        </label>
                        <div className="flex items-center gap-4">
                            <input
                                type="range"
                                min="0"
                                max="500000"
                                step="10000"
                                value={priceRange[0]}
                                onChange={(e) =>
                                    setPriceRange([parseInt(e.target.value), priceRange[1]])
                                }
                                className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                            <input
                                type="range"
                                min="0"
                                max="500000"
                                step="10000"
                                value={priceRange[1]}
                                onChange={(e) =>
                                    setPriceRange([priceRange[0], parseInt(e.target.value)])
                                }
                                className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
                            />
                        </div>
                    </div>
                </div>

                {/* Products Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {loading ? (
                        <div className="col-span-full flex items-center justify-center py-12">
                            <Loader2 className="w-12 h-12 animate-spin text-primary" />
                        </div>
                    ) : filteredProducts.length > 0 ? (
                        filteredProducts.map((product, index) => {
                            const price = product.pricingTiers[0]?.price || 0;
                            const inStock = product.status === "active" && product.availableQuantity > 0;

                            return (
                                <div
                                    key={product.id}
                                    className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-2 hover-lift animate-[slideInUp_0.6s_ease-out] cursor-pointer"
                                    style={{ animationDelay: `${index * 100}ms` }}
                                    onClick={() => router.push(`/marketplace/product/${product.id}`)}
                                >
                                    <div className="relative h-48 bg-slate-100 dark:bg-slate-700">
                                        {product.images[0] ? (
                                            <Image
                                                src={product.images[0]}
                                                alt={product.title}
                                                fill
                                                className="object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <Store className="w-12 h-12 text-gray-400" />
                                            </div>
                                        )}
                                        {product.exportReady && (
                                            <div className="absolute top-3 right-3 px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-full">
                                                Export Ready
                                            </div>
                                        )}
                                        {!inStock && (
                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                <span className="px-4 py-2 bg-red-500 text-white font-bold rounded-xl">
                                                    Out of Stock
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-6">
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                            {product.title}
                                        </h3>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
                                            {product.description}
                                        </p>
                                        <p className="text-2xl font-bold text-primary mb-1">
                                            {formatCurrency(price)}
                                        </p>
                                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                            per {product.unit} • Min: {product.minimumOrderQuantity} {product.unit}
                                        </p>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                addToCart(product);
                                            }}
                                            disabled={!inStock}
                                            className="w-full px-4 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            <ShoppingCart className="w-4 h-4" />
                                            {inStock ? "Add to Cart" : "Out of Stock"}
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="col-span-full text-center py-12">
                            <Store className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                            <p className="text-slate-500 dark:text-slate-400 text-lg mb-2">
                                {products.length === 0 ? (
                                    "No products available yet"
                                ) : (
                                    "No products match your filters"
                                )}
                            </p>
                            {products.length === 0 && (
                                <button
                                    onClick={() => router.push("/marketplace/verify")}
                                    className="mt-4 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition"
                                >
                                    Become a Seller
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Shopping Cart Sidebar */}
            {isCartOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-end">
                    <div
                        className="bg-white dark:bg-slate-800 h-full w-full md:w-96 elevation-3 overflow-y-auto animate-[slideInRight_0.3s_ease-out]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-6 z-10">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                                    Shopping Cart
                                </h2>
                                <button
                                    onClick={() => setIsCartOpen(false)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                {cart.length} {cart.length === 1 ? "item" : "items"}
                            </p>
                        </div>

                        <div className="p-6 space-y-4">
                            {cart.length > 0 ? (
                                <>
                                    {cart.map((item) => {
                                        const price = item.pricingTiers[0]?.price || 0;
                                        return (
                                            <div
                                                key={item.id}
                                                className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4"
                                            >
                                                <div className="flex items-start gap-3 mb-3">
                                                    <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700">
                                                        {item.images[0] ? (
                                                            <Image
                                                                src={item.images[0]}
                                                                alt={item.title}
                                                                fill
                                                                className="object-cover"
                                                            />
                                                        ) : (
                                                            <Store className="w-8 h-8 text-gray-400 mx-auto mt-4" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1">
                                                        <h3 className="font-bold text-slate-900 dark:text-white">
                                                            {item.title}
                                                        </h3>
                                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                                            {formatCurrency(price)} per {item.unit}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => removeFromCart(item.id)}
                                                        className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                    >
                                                        <X className="w-5 h-5 text-red-500" />
                                                    </button>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => updateQuantity(item.id, -1)}
                                                            className="w-8 h-8 flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                                        >
                                                            <Minus className="w-4 h-4" />
                                                        </button>
                                                        <span className="w-12 text-center font-semibold text-slate-900 dark:text-white">
                                                            {item.quantity}
                                                        </span>
                                                        <button
                                                            onClick={() => updateQuantity(item.id, 1)}
                                                            className="w-8 h-8 flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                                        >
                                                            <Plus className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                    <p className="font-bold text-primary">
                                                        {formatCurrency(price * item.quantity)}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 pt-6 mt-6 space-y-4">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-slate-600 dark:text-slate-400">
                                                Subtotal
                                            </span>
                                            <span className="font-semibold text-slate-900 dark:text-white">
                                                {formatCurrency(cartTotal)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-lg font-bold">
                                            <span className="text-slate-900 dark:text-white">
                                                Total
                                            </span>
                                            <span className="text-primary">
                                                {formatCurrency(cartTotal)}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => router.push("/marketplace/checkout")}
                                            className="w-full px-6 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition flex items-center justify-center gap-2"
                                        >
                                            <ShoppingCart className="w-5 h-5" />
                                            Proceed to Checkout
                                        </button>
                                        <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                                            All payments are escrow-protected
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center py-12">
                                    <ShoppingCart className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
                                    <p className="text-slate-500 dark:text-slate-400">
                                        Your cart is empty
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
