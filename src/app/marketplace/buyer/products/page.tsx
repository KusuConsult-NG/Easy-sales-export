/**
 * Marketplace Product Browser
 * 
 * Browse all products with filters and categories
 */

"use client";

import { useState } from "react";
import { Search, Filter, Star, ShoppingCart, MapPin, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

export default function ProductsPage() {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [selectedState, setSelectedState] = useState("all");
    const [priceRange, setPriceRange] = useState("all");
    const [sortBy, setSortBy] = useState("featured");

    const categories = [
        { id: "all", name: "All Products", count: 156 },
        { id: "grains", name: "Grains & Cereals", count: 32 },
        { id: "roots", name: "Roots & Tubers", count: 18 },
        { id: "vegetables", name: "Vegetables", count: 24 },
        { id: "fruits", name: "Fruits", count: 28 },
        { id: "nuts", name: "Nuts & Seeds", count: 21 },
        { id: "spices", name: "Spices", count: 15 },
        { id: "organic", name: "Organic Products", count: 18 }
    ];

    const products = [
        {
            id: 1,
            name: "Premium Cashew Nuts",
            description: "Grade A Nigerian cashews, sorted and cleaned",
            price: 8500,
            unit: "kg",
            minOrder: "20kg",
            seller: "Kogi Farms Cooperative",
            location: "Kogi State",
            rating: 4.9,
            reviews: 127,
            inStock: true,
            category: "nuts"
        },
        {
            id: 2,
            name: "Organic Shea Butter",
            description: "100% pure unrefined shea butter",
            price: 6200,
            unit: "kg",
            minOrder: "10kg",
            seller: "Kaduna Naturals",
            location: "Kaduna State",
            rating: 4.8,
            reviews: 94,
            inStock: true,
            category: "organic"
        },
        {
            id: 3,
            name: "Fresh Ginger Roots",
            description: "Fresh Nigerian ginger, harvested weekly",
            price: 3800,
            unit: "kg",
            minOrder: "50kg",
            seller: "Plateau Agro Hub",
            location: "Plateau State",
            rating: 4.7,
            reviews: 156,
            inStock: true,
            category: "spices"
        },
        {
            id: 4,
            name: "Dried Hibiscus Flowers",
            description: "Premium quality zobo leaves for export",
            price: 4500,
            unit: "kg",
            minOrder: "25kg",
            seller: "Kano Export Hub",
            location: "Kano State",
            rating: 4.9,
            reviews: 203,
            inStock: true,
            category: "spices"
        },
        {
            id: 5,
            name: "Tiger Nuts (Aya)",
            description: "Clean, sorted tiger nuts ready for processing",
            price: 3200,
            unit: "kg",
            minOrder: "30kg",
            seller: "Lagos Agro Ventures",
            location: "Lagos State",
            rating: 4.6,
            reviews: 88,
            inStock: true,
            category: "nuts"
        },
        {
            id: 6,
            name: "White Sesame Seeds",
            description: "Export quality sesame, 99% purity",
            price: 5800,
            unit: "kg",
            minOrder: "40kg",
            seller: "Benue Farms Alliance",
            location: "Benue State",
            rating: 4.8,
            reviews: 145,
            inStock: true,
            category: "nuts"
        },
        {
            id: 7,
            name: "Yellow Maize",
            description: "High quality maize for feed and processing",
            price: 1800,
            unit: "kg",
            minOrder: "100kg",
            seller: "Kaduna Grains Co-op",
            location: "Kaduna State",
            rating: 4.5,
            reviews: 67,
            inStock: true,
            category: "grains"
        },
        {
            id: 8,
            name: "Sweet Potatoes",
            description: "Fresh sweet potatoes, various sizes",
            price: 1200,
            unit: "kg",
            minOrder: "80kg",
            seller: "Enugu Farm Network",
            location: "Enugu State",
            rating: 4.7,
            reviews: 92,
            inStock: true,
            category: "roots"
        }
    ];

    // Filter products
    const filteredProducts = products.filter(product => {
        const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            product.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === "all" || product.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                <div className="max-w-7xl mx-auto px-8 py-6">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Browse Products
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Discover quality agricultural products from verified sellers across Nigeria
                    </p>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-8 py-8">
                {/* Search and Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 mb-8">
                    {/* Search Bar */}
                    <div className="relative mb-6">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search products, sellers, or categories..."
                            className="w-full pl-12 pr-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
                        />
                    </div>

                    {/* Filter Row */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Sort By
                            </label>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            >
                                <option value="featured">Featured</option>
                                <option value="price_low">Price: Low to High</option>
                                <option value="price_high">Price: High to Low</option>
                                <option value="rating">Highest Rated</option>
                                <option value="newest">Newest</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Location
                            </label>
                            <select
                                value={selectedState}
                                onChange={(e) => setSelectedState(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            >
                                <option value="all">All States</option>
                                <option value="lagos">Lagos</option>
                                <option value="kano">Kano</option>
                                <option value="kaduna">Kaduna</option>
                                <option value="oyo">Oyo</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Price Range
                            </label>
                            <select
                                value={priceRange}
                                onChange={(e) => setPriceRange(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                            >
                                <option value="all">All Prices</option>
                                <option value="under_2000">Under ₦2,000</option>
                                <option value="2000_5000">₦2,000 - ₦5,000</option>
                                <option value="5000_10000">₦5,000 - ₦10,000</option>
                                <option value="over_10000">Over ₦10,000</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                                Availability
                            </label>
                            <select className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                                <option value="all">All Products</option>
                                <option value="in_stock">In Stock</option>
                                <option value="pre_order">Pre-Order</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Categories Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 sticky top-8">
                            <h3 className="font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                <Filter className="w-5 h-5" />
                                Categories
                            </h3>
                            <div className="space-y-2">
                                {categories.map((category) => (
                                    <button
                                        key={category.id}
                                        onClick={() => setSelectedCategory(category.id)}
                                        className={`w-full text-left px-4 py-2.5 rounded-lg transition-colors ${selectedCategory === category.id
                                                ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 font-semibold"
                                                : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                                            }`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <span>{category.name}</span>
                                            <span className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded">
                                                {category.count}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Products Grid */}
                    <div className="lg:col-span-3">
                        <div className="flex items-center justify-between mb-6">
                            <p className="text-slate-600 dark:text-slate-400">
                                Showing <span className="font-semibold text-slate-900 dark:text-white">{filteredProducts.length}</span> products
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {filteredProducts.map((product) => (
                                <div
                                    key={product.id}
                                    className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-shadow group"
                                >
                                    {/* Product Image */}
                                    <div className="h-48 bg-slate-200 dark:bg-slate-700 relative">
                                        <div className="absolute top-3 right-3 bg-white dark:bg-slate-800 rounded-full p-2 shadow">
                                            <Star className="w-5 h-5 text-slate-400" />
                                        </div>
                                    </div>

                                    {/* Product Info */}
                                    <div className="p-5">
                                        <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-1 group-hover:text-green-600 transition-colors">
                                            {product.name}
                                        </h3>
                                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 line-clamp-2">
                                            {product.description}
                                        </p>

                                        {/* Seller Info */}
                                        <div className="flex items-center gap-2 mb-3 text-sm text-slate-600 dark:text-slate-400">
                                            <MapPin className="w-4 h-4" />
                                            <span>{product.seller}</span>
                                        </div>

                                        {/* Rating */}
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="flex items-center gap-1">
                                                <Star className="w-4 h-4 text-yellow-500 fill-current" />
                                                <span className="font-semibold text-slate-900 dark:text-white text-sm">
                                                    {product.rating}
                                                </span>
                                            </div>
                                            <span className="text-xs text-slate-500">
                                                ({product.reviews} reviews)
                                            </span>
                                        </div>

                                        {/* Price and Action */}
                                        <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                                            <div>
                                                <div className="text-2xl font-bold text-green-600">
                                                    ₦{product.price.toLocaleString()}
                                                </div>
                                                <div className="text-xs text-slate-500">
                                                    per {product.unit} • Min: {product.minOrder}
                                                </div>
                                            </div>
                                            <button className="p-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                                <ShoppingCart className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Load More */}
                        {filteredProducts.length >= 6 && (
                            <div className="text-center mt-8">
                                <button className="px-8 py-3 border-2 border-green-600 text-green-600 font-semibold rounded-xl hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors">
                                    Load More Products
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
