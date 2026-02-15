"use client";

import { Package, Search, Filter, Grid, List } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function MarketplaceProductsPage() {
    const products = [
        {
            id: 1,
            name: "Premium Cashew Nuts",
            price: "₦8,500/kg",
            location: "Kogi State",
            rating: 4.8,
            image: "/images/logo.jpg",
            badge: "Export Ready",
            seller: "AgriPro Farms"
        },
        {
            id: 2,
            name: "Organic Shea Butter",
            price: "₦12,000/kg",
            location: "Kaduna State",
            rating: 4.9,
            image: "/images/logo.jpg",
            badge: "Organic",
            seller: "Natural Harvest Co."
        },
        {
            id: 3,
            name: "Fresh Ginger Roots",
            price: "₦4,200/kg",
            location: "Plateau State",
            rating: 4.6,
            image: "/images/logo.jpg",
            badge: "Fresh",
            seller: "Plateau Organics"
        },
        {
            id: 4,
            name: "Dried Hibiscus Flowers",
            price: "₦6,800/kg",
            location: "Kano State",
            rating: 4.7,
            image: "/images/logo.jpg",
            badge: "Certified",
            seller: "Kano Agro Export"
        },
        {
            id: 5,
            name: "Premium Sesame Seeds",
            price: "₦9,200/kg",
            location: "Benue State",
            rating: 4.8,
            image: "/images/logo.jpg",
            badge: "Export Ready",
            seller: "Benue Commodities"
        },
        {
            id: 6,
            name: "Raw Cocoa Beans",
            price: "₦11,500/kg",
            location: "Cross River",
            rating: 4.9,
            image: "/images/logo.jpg",
            badge: "Premium",
            seller: "Cross River Cocoa"
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
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
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-lg mb-8">
                    <div className="flex flex-col md:flex-row gap-4">
                        {/* Search */}
                        <div className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search products..."
                                    className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition"
                                />
                            </div>
                        </div>

                        {/* Category Filter */}
                        <select className="px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition">
                            <option>All Categories</option>
                            <option>Grains & Cereals</option>
                            <option>Nuts & Seeds</option>
                            <option>Spices & Herbs</option>
                            <option>Fruits & Vegetables</option>
                            <option>Processed Products</option>
                        </select>

                        {/* Location Filter */}
                        <select className="px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 transition">
                            <option>All Locations</option>
                            <option>Northern Nigeria</option>
                            <option>Southern Nigeria</option>
                            <option>Western Nigeria</option>
                            <option>Eastern Nigeria</option>
                        </select>

                        {/* View Toggle */}
                        <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-700 rounded-xl">
                            <button className="p-2 bg-white dark:bg-slate-600 rounded-lg shadow-sm">
                                <Grid className="w-5 h-5 text-green-600" />
                            </button>
                            <button className="p-2 hover:bg-white/50 dark:hover:bg-slate-600/50 rounded-lg transition">
                                <List className="w-5 h-5 text-slate-400" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Products Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {products.map((product) => (
                        <div
                            key={product.id}
                            className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all hover:-translate-y-1"
                        >
                            {/* Product Image */}
                            <div className="relative h-56 bg-slate-200 dark:bg-slate-700">
                                <Image
                                    src={product.image}
                                    alt={product.name}
                                    fill
                                    className="object-cover"
                                />
                                <div className="absolute top-4 right-4">
                                    <span className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full">
                                        {product.badge}
                                    </span>
                                </div>
                            </div>

                            {/* Product Details */}
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    {product.name}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                                    by {product.seller}
                                </p>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                    📍 {product.location}
                                </p>

                                <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <div>
                                        <div className="text-2xl font-bold text-green-600">
                                            {product.price}
                                        </div>
                                        <div className="flex items-center gap-1 text-yellow-500 text-sm">
                                            ⭐ <span className="font-semibold">{product.rating}</span>
                                        </div>
                                    </div>
                                    <Link
                                        href={`/marketplace/products/${product.id}`}
                                        className="px-6 py-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition"
                                    >
                                        View Details
                                    </Link>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Pagination */}
                <div className="mt-12 flex justify-center gap-2">
                    <button className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                        Previous
                    </button>
                    <button className="px-4 py-2 bg-green-600 text-white rounded-xl font-semibold">
                        1
                    </button>
                    <button className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                        2
                    </button>
                    <button className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                        3
                    </button>
                    <button className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                        Next
                    </button>
                </div>

                {/* CTA Section */}
                <div className="mt-16 bg-gradient-to-r from-green-600 to-emerald-600 rounded-3xl p-12 text-center text-white">
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
