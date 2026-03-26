import { ArrowRight, ShoppingCart, Star, TrendingUp, Shield, Package, CheckCircle, Home } from "lucide-react";
import { logger } from '@/lib/logger';
import Image from "next/image";
import Link from "next/link";
import { getRecommendedProductsAction } from "@/app/actions/marketplace";
import BackToHub from "@/components/common/BackToHub";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Easy Market Nigeria — Buy & Sell Agricultural Products",
    description: "Connect with verified buyers and sellers across Nigeria. Trade premium yam, sesame seeds, hibiscus and more with secure escrow protection.",
    alternates: { canonical: "https://easysalesexport.com/marketplace" },
    openGraph: {
        title: "Easy Market Nigeria — Agricultural Marketplace",
        description: "Nigeria's largest agricultural marketplace. Buy or sell premium commodities with verified sellers and escrow-protected payments.",
        url: "https://easysalesexport.com/marketplace",
        images: [{ url: "/images/og-banner.png", width: 1200, height: 630, alt: "Easy Market Nigeria" }],
    },
};



// Removed force-dynamic to allow static rendering

export default async function MarketplaceLandingPage() {
    // Fetch real products (wrapped in try-catch to handle build-time errors gracefully)
    let products: any[] = [];
    try {
        const result = await getRecommendedProductsAction(3);
        products = result.products || [];
    } catch (error) {
        logger.error("Failed to fetch recommended products:", error);
        // Products will remain empty array, component will handle gracefully
    }

    return (
        <div className="min-h-screen bg-slate-50">


            {/* Hero Section */}
            <div className="relative overflow-hidden text-white">
                {/* Hero Background Image */}
                <div className="absolute inset-0">
                    <Image
                        src="/images/hero/hero-market.jpeg"
                        alt="Easy Market Nigeria"
                        fill
                        className="object-cover object-center"
                        priority
                        quality={90}
                    />
                    {/* Brand-tinted overlay */}
                    <div className="absolute inset-0 bg-linear-to-br from-green-900/80 via-emerald-900/75 to-teal-900/80" />
                </div>
                <BackToHub variant="dark" className="top-4 left-4 border-white/20" />
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-4 md:px-8 py-12 md:py-24">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-semibold mb-4 md:mb-6">
                            <ShoppingCart className="w-3 h-3 md:w-4 md:h-4" />
                            Agricultural Marketplace
                        </div>
                        <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 md:mb-6 leading-tight">
                            Easy Market Nigeria
                        </h1>
                        <p className="text-lg md:text-xl lg:text-2xl mb-3 md:mb-4 text-green-50">
                            Buy & Sell Quality Agricultural Products
                        </p>
                        <p className="text-base md:text-lg mb-6 md:mb-8 text-green-100 max-w-2xl">
                            Connect with verified buyers and sellers across Nigeria. Trade premium agricultural commodities with confidence and security.
                        </p>
                        <div className="flex flex-col sm:flex-row flex-wrap gap-3 md:gap-4">
                            <Link
                                href="/marketplace/products"
                                className="group inline-flex items-center justify-center gap-2 md:gap-3 bg-white text-green-600 px-6 py-3 md:px-8 md:py-4 rounded-xl font-bold text-base md:text-lg shadow-2xl hover:shadow-green-500/50 transition-all hover:scale-105"
                            >
                                Browse Products
                                <ArrowRight className="w-4 h-4 md:w-5 md:h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link
                                href="/marketplace/onboarding"
                                className="group inline-flex items-center justify-center gap-2 md:gap-3 bg-white/10 backdrop-blur-sm border-2 border-white text-white px-6 py-3 md:px-8 md:py-4 rounded-xl font-bold text-base md:text-lg hover:bg-white/20 transition-all"
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
            <div className="max-w-7xl mx-auto px-4 md:px-8 -mt-16 relative z-10">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-12 md:mb-16">
                    <div className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 elevation-2 text-center">
                        <div className="text-2xl md:text-4xl font-bold text-green-600 mb-1 md:mb-2">5,000+</div>
                        <div className="text-xs md:text-base text-slate-600 font-medium">Products Listed</div>
                    </div>
                    <div className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 elevation-2 text-center">
                        <div className="text-2xl md:text-4xl font-bold text-green-600 mb-1 md:mb-2">12,000+</div>
                        <div className="text-xs md:text-base text-slate-600 font-medium">Active Traders</div>
                    </div>
                    <div className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 elevation-2 text-center">
                        <div className="text-2xl md:text-4xl font-bold text-green-600 mb-1 md:mb-2">₦2.5B+</div>
                        <div className="text-xs md:text-base text-slate-600 font-medium">Total Traded</div>
                    </div>
                    <div className="bg-white rounded-xl md:rounded-2xl p-4 md:p-6 elevation-2 text-center">
                        <div className="text-2xl md:text-4xl font-bold text-green-600 mb-1 md:mb-2">4.7/5</div>
                        <div className="text-xs md:text-base text-slate-600 font-medium">Seller Rating</div>
                    </div>
                </div>
            </div>

            {/* Featured Products */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 mb-4">
                    Featured Products
                </h2>
                <p className="text-center text-slate-600 mb-12 max-w-2xl mx-auto">
                    Premium agricultural commodities from verified sellers across Nigeria
                </p>

                {products && products.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                        {products.map((product) => (
                            <Link href={`/marketplace/products/${product.id}`} key={product.id} className="block group">
                                <div className="bg-white rounded-2xl overflow-hidden elevation-2 hover-lift transition-all duration-300">
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
                                    <div className="p-6">
                                        <h3 className="text-xl font-bold text-slate-900 mb-2 line-clamp-1">
                                            {product.title}
                                        </h3>
                                        <p className="text-sm text-slate-600 mb-4 flex items-center gap-1">
                                            📍 {product.location?.state || "Nigeria"}, {product.location?.lga || ""}
                                        </p>
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="flex items-center gap-1 text-yellow-500">
                                                <Star className="w-4 h-4 fill-current" />
                                                <span className="text-sm font-semibold">{product.rating || "N/A"}</span>
                                            </div>
                                            <span className="text-slate-400 text-sm">•</span>
                                            <span className="text-sm text-slate-500">{product.sellerName || "Verified Seller"}</span>
                                        </div>
                                        <div className="pt-4 border-t border-slate-200 flex justify-between items-center">
                                            <div>
                                                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Price</p>
                                                <span className="text-xl font-bold text-green-600">
                                                    ₦{product.pricingTiers?.[0]?.price?.toLocaleString() ?? "N/A"}
                                                </span>
                                                <span className="text-sm text-slate-500 font-medium">/{product.unit}</span>
                                            </div>
                                            <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors duration-300">
                                                <ArrowRight className="w-5 h-5 text-green-600 group-hover:text-white" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
                        <Package className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-slate-900 mb-1">No products yet</h3>
                        <p className="text-slate-500 mb-6">Be the first to list your agricultural products</p>
                        <Link
                            href="/marketplace/onboarding"
                            className="inline-flex items-center gap-2 px-6 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition"
                        >
                            Start Selling
                        </Link>
                    </div>
                )}

                <div className="text-center mt-8">
                    <Link
                        href="/marketplace/products"
                        className="inline-flex items-center gap-2 px-8 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition shadow-lg hover:shadow-green-500/25"
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
                        <h3 className="text-2xl font-bold text-slate-900 mb-8">
                            For Buyers
                        </h3>
                        <div className="space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
                                    <Shield className="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-900 mb-2">Verified Sellers</h4>
                                    <p className="text-slate-600">All sellers are verified with quality guarantees and secure payment protection.</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
                                    <Package className="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-900 mb-2">Quality Products</h4>
                                    <p className="text-slate-600">Access premium agricultural commodities with detailed certifications and specifications.</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center shrink-0">
                                    <TrendingUp className="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-900 mb-2">Bulk Pricing</h4>
                                    <p className="text-slate-600">Competitive prices with special discounts for bulk orders and regular customers.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Seller Benefits */}
                    <div>
                        <h3 className="text-2xl font-bold text-slate-900 mb-8">
                            For Sellers
                        </h3>
                        <div className="space-y-6">
                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" />
                                <div>
                                    <h4 className="font-bold text-slate-900 mb-1">Nationwide Reach</h4>
                                    <p className="text-slate-600">Connect with buyers across all 36 states and FCT</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" />
                                <div>
                                    <h4 className="font-bold text-slate-900 mb-1">Secure Payments</h4>
                                    <p className="text-slate-600">Escrow protection ensures you get paid for every sale</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" />
                                <div>
                                    <h4 className="font-bold text-slate-900 mb-1">Marketing Support</h4>
                                    <p className="text-slate-600">Featured listings and promotional opportunities</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-4">
                                <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-1" />
                                <div>
                                    <h4 className="font-bold text-slate-900 mb-1">Analytics Dashboard</h4>
                                    <p className="text-slate-600">Track sales, views, and customer insights</p>
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
