"use client";

import { ArrowRight, ShoppingCart, Star, TrendingUp, Shield, Package, CheckCircle, Home } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function MarketplaceLandingPage() {
    const featuredProducts = [
        {
            name: "Premium Cashew Nuts",
            price: "₦8,500/kg",
            location: "Kogi State",
            rating: 4.8,
            image: "/images/logo.jpg",
            badge: "Export Ready"
        },
        {
            name: "Organic Shea Butter",
            price: "₦12,000/kg",
            location: "Kaduna State",
            rating: 4.9,
            image: "/images/logo.jpg",
            badge: "Organic"
        },
        {
            name: "Fresh Ginger Roots",
            price: "₦4,200/kg",
            location: "Plateau State",
            rating: 4.6,
            image: "/images/logo.jpg",
            badge: "Fresh"
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Home Navigation Button */}
            <Link
                href="/"
                className="fixed top-6 left-6 z-50 flex items-center gap-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2.5 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 border border-slate-200 dark:border-slate-700"
            >
                <Home className="w-4 h-4" />
                <span className="font-semibold text-sm">Home</span>
            </Link>

            {/* Hero Section */}
            <div className="relative overflow-hidden bg-linear-to-br from-green-600 via-emerald-600 to-teal-600 text-white">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-8 py-24">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-semibold mb-6">
                            <ShoppingCart className="w-4 h-4" />
                            Agricultural Marketplace
                        </div>
                        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
                            Digital Marketplace
                        </h1>
                        <p className="text-xl md:text-2xl mb-4 text-green-50">
                            Buy & Sell Quality Agricultural Products
                        </p>
                        <p className="text-lg mb-8 text-green-100 max-w-2xl">
                            Connect with verified buyers and sellers across Nigeria. Trade premium agricultural commodities with confidence and security.
                        </p>
                        <div className="flex flex-wrap gap-4">
                            <Link
                                href="/marketplace/products"
                                className="group inline-flex items-center gap-3 bg-white text-green-600 px-8 py-4 rounded-xl font-bold text-lg shadow-2xl hover:shadow-green-500/50 transition-all hover:scale-105"
                            >
                                Browse Products
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link
                                href="/marketplace/onboarding"
                                className="group inline-flex items-center gap-3 bg-white/10 backdrop-blur-sm border-2 border-white text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-white/20 transition-all"
                            >
                                Become a Seller
                            </Link>
                        </div>
                    </div>
                </div>
                {/* Wave SVG */}
                <div className="absolute bottom-0 left-0 right-0">
                    <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
                        <path d="M0 0L60 10C120 20 240 40 360 46.7C480 53 600 47 720 43.3C840 40 960 40 1080 46.7C1200 53 1320 67 1380 73.3L1440 80V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0V0Z" fill="rgb(248 250 252)" className="dark:fill-slate-950" />
                    </svg>
                </div>
            </div>

            {/* Stats Section */}
            <div className="max-w-7xl mx-auto px-8 -mt-16 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-16">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-green-600 mb-2">5,000+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Products Listed</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-green-600 mb-2">12,000+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Active Traders</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-green-600 mb-2">₦2.5B+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Total Traded</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-green-600 mb-2">4.7/5</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Seller Rating</div>
                    </div>
                </div>
            </div>

            {/* Featured Products */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-4">
                    Featured Products
                </h2>
                <p className="text-center text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto">
                    Premium agricultural commodities from verified sellers across Nigeria
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                    {featuredProducts.map((product, index) => (
                        <div key={index} className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-2 hover-lift">
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
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    {product.name}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                    📍 {product.location}
                                </p>
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="flex items-center gap-1 text-yellow-500">
                                        <Star className="w-4 h-4 fill-current" />
                                        <span className="text-sm font-semibold">{product.rating}</span>
                                    </div>
                                </div>
                                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <span className="text-2xl font-bold text-green-600">
                                        {product.price}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="text-center">
                    <Link
                        href="/marketplace/products"
                        className="inline-flex items-center gap-2 px-8 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition"
                    >
                        View All Products
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </div>

            {/* Benefits Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                    {/* Buyer Benefits */}
                    <div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-8">
                            For Buyers
                        </h3>
                        <div className="space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center shrink-0">
                                    <Shield className="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-2">Verified Sellers</h4>
                                    <p className="text-slate-600 dark:text-slate-400">All sellers are verified with quality guarantees and secure payment protection.</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center shrink-0">
                                    <Package className="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-2">Quality Products</h4>
                                    <p className="text-slate-600 dark:text-slate-400">Access premium agricultural commodities with detailed certifications and specifications.</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center shrink-0">
                                    <TrendingUp className="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-2">Bulk Pricing</h4>
                                    <p className="text-slate-600 dark:text-slate-400">Competitive prices with special discounts for bulk orders and regular customers.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Seller Benefits */}
                    <div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-8">
                            For Sellers
                        </h3>
                        <div className="space-y-6">
                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" />
                                <div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Nationwide Reach</h4>
                                    <p className="text-slate-600 dark:text-slate-400">Connect with buyers across all 36 states and FCT</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" />
                                <div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Secure Payments</h4>
                                    <p className="text-slate-600 dark:text-slate-400">Escrow protection ensures you get paid for every sale</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" />
                                <div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Marketing Support</h4>
                                    <p className="text-slate-600 dark:text-slate-400">Featured listings and promotional opportunities</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" />
                                <div>
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Analytics Dashboard</h4>
                                    <p className="text-slate-600 dark:text-slate-400">Track sales, views, and customer insights</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* CTA Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="bg-linear-to-r from-green-600 to-emerald-600 rounded-3xl p-12 text-center text-white relative overflow-hidden">
                    <div className="absolute inset-0 bg-black/10"></div>
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Start Trading Today
                        </h2>
                        <p className="text-xl mb-8 text-green-100 max-w-2xl mx-auto">
                            Join Nigeria's fastest-growing agricultural marketplace. Buy or sell with confidence.
                        </p>
                        <div className="flex flex-wrap justify-center gap-4">
                            <Link
                                href="/marketplace/products"
                                className="group inline-flex items-center gap-3 bg-white text-green-600 px-10 py-5 rounded-xl font-bold text-lg shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                            >
                                Browse Products
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link
                                href="/marketplace/onboarding"
                                className="group inline-flex items-center gap-3 bg-white/10 backdrop-blur-sm border-2 border-white text-white px-10 py-5 rounded-xl font-bold text-lg hover:bg-white/20 transition-all"
                            >
                                Start Selling
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
