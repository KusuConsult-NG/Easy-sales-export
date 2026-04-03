"use client";

import { ArrowRight, MapPin, Home, CheckCircle, Search, Award, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import BackToHub from "@/components/common/BackToHub";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { getPropertiesAction, checkFarmNationStatusAction } from "@/app/actions/farm-nation";

const categories = [
    { name: "Arable Land", icon: "🌾" },
    { name: "Leasing Options", icon: "📋" },
    { name: "Poultry Farms", icon: "🐔" },
    { name: "Fish Farms", icon: "🐟" },
    { name: "Greenhouses", icon: "🏡" },
    { name: "Mixed-Use", icon: "🌻" },
];

export default function FarmNationLandingPage() {
    const { status: sessionStatus } = useSession();
    const router = useRouter();
    const [featuredProperties, setFeaturedProperties] = useState<any[]>([]);
    const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);



    useEffect(() => {
        async function loadData() {
            try {
                // Load featured (verified) properties — filter in-memory after load
                const result = await getPropertiesAction({ limit: 50 });
                if (result.success && result.properties) {
                    // Only show verified properties on landing page
                    const verified = result.properties.filter((p: any) => p.verified === true);
                    setFeaturedProperties(verified.slice(0, 3));
                    setTotalCount(result.properties.length);

                    // Count properties by type/category
                    const counts: Record<string, number> = {};
                    result.properties.forEach((p: any) => {
                        const type = p.propertyType || p.type || "other";
                        counts[type] = (counts[type] || 0) + 1;
                    });
                    setCategoryCounts(counts);
                }
            } catch (e) {
                // Graceful fallback — don't break the landing page
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, []);

    const formatCount = (count: number | null) => {
        if (count === null) return "...";
        if (count === 0) return "0";
        return count >= 100 ? `${Math.floor(count / 10) * 10}+` : `${count}`;
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Hero Section */}
            <div className="relative overflow-hidden bg-linear-to-br from-teal-600 via-cyan-600 to-blue-600 text-white">
                <BackToHub variant="dark" className="top-4 left-4 border-white/20" />
                <div className="absolute inset-0 bg-black/10 pointer-events-none"></div>
                <div className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 py-12 md:py-24">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-semibold mb-4 md:mb-6">
                            <Home className="w-3 h-3 md:w-4 md:h-4" />
                            Agricultural Real Estate
                        </div>
                        <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 md:mb-6 leading-tight">
                            Farm Nation
                        </h1>
                        <p className="text-lg md:text-xl lg:text-2xl mb-3 md:mb-4 text-teal-50">
                            Buy, Lease & Invest in Agricultural Land
                        </p>
                        <p className="text-base md:text-lg mb-6 md:mb-8 text-teal-100 max-w-2xl">
                            Discover prime agricultural properties across Nigeria. From farmland to fish ponds, find the perfect space to grow your agribusiness.
                        </p>
                        <div className="flex flex-col sm:flex-row flex-wrap gap-3 md:gap-4">
                            <Link
                                href="/farm-nation/properties"
                                className="group inline-flex items-center justify-center gap-2 md:gap-3 bg-white text-teal-600 px-6 py-3 md:px-8 md:py-4 rounded-xl font-bold text-base md:text-lg shadow-2xl hover:shadow-teal-500/50 transition-all hover:scale-105"
                            >
                                Browse Properties
                                <ArrowRight className="w-4 h-4 md:w-5 md:h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link
                                href="/farm-nation/onboarding"
                                className="inline-flex items-center justify-center gap-2 md:gap-3 bg-white/10 border border-white/30 text-white px-6 py-3 md:px-8 md:py-4 rounded-xl font-bold text-base md:text-lg hover:bg-white/20 transition-all"
                            >
                                List Your Property
                            </Link>
                        </div>
                    </div>
                </div>
                {/* Wave SVG */}
                <div className="absolute bottom-0 left-0 right-0">
                    <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
                        <path d="M0 0L60 10C120 20 240 40 360 46.7C480 53 600 47 720 43.3C840 40 960 40 1080 46.7C1200 53 1320 67 1380 73.3L1440 80V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0V0Z" fill="rgb(248 250 252)" />
                    </svg>
                </div>
            </div>

            {/* Stats Section */}
            <div className="max-w-7xl mx-auto px-8 -mt-16 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-16">
                    <div className="bg-white rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-teal-600 mb-2">
                            {totalCount !== null ? `${totalCount}+` : <Loader2 className="w-8 h-8 animate-spin text-teal-400 mx-auto" />}
                        </div>
                        <div className="text-slate-600 font-medium">Properties Listed</div>
                    </div>
                    <div className="bg-white rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-teal-600 mb-2">36 States</div>
                        <div className="text-slate-600 font-medium">Nationwide Coverage</div>
                    </div>
                    <div className="bg-white rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-teal-600 mb-2">₦8.5B+</div>
                        <div className="text-slate-600 font-medium">Properties Value</div>
                    </div>
                    <div className="bg-white rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-teal-600 mb-2">850+</div>
                        <div className="text-slate-600 font-medium">Successful Deals</div>
                    </div>
                </div>
            </div>

            {/* Categories */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 mb-12">
                    Farm Categories
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-12">
                    {categories.map((category) => {
                        const key = category.name.toLowerCase().replace(/\s+/g, "_");
                        const count = categoryCounts[key] ?? categoryCounts[category.name] ?? null;
                        return (
                            <Link
                                key={category.name}
                                href={`/farm-nation/properties?category=${encodeURIComponent(category.name)}`}
                                className="bg-white rounded-xl p-6 elevation-2 hover-lift text-center cursor-pointer block"
                            >
                                <div className="text-4xl mb-3">{category.icon}</div>
                                <h4 className="font-bold text-slate-900 text-sm mb-1">{category.name}</h4>
                                <p className="text-xs text-teal-600 font-semibold">
                                    {loading ? "..." : count !== null ? `${count}+` : "Browse"}
                                </p>
                            </Link>
                        );
                    })}
                </div>
            </div>

            {/* Featured Properties */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 mb-4">
                    Featured Farms
                </h2>
                <p className="text-center text-slate-600 mb-12 max-w-2xl mx-auto">
                    Premium agricultural properties verified and ready for investment
                </p>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-10 h-10 animate-spin text-teal-500" />
                    </div>
                ) : featuredProperties.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-2xl shadow-sm">
                        <p className="text-slate-500 text-lg mb-2">No verified properties yet</p>
                        <p className="text-slate-400 text-sm">Be the first to list your farm!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                        {featuredProperties.map((property) => (
                            <Link
                                key={property.id}
                                href={`/farm-nation/property/${property.id}`}
                                className="bg-white rounded-2xl overflow-hidden elevation-2 hover-lift block"
                            >
                                <div className="relative h-56 bg-slate-200">
                                    {property.images?.[0] ? (
                                        <Image
                                            src={property.images[0]}
                                            alt={property.title}
                                            fill
                                            className="object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-6xl">🌾</div>
                                    )}
                                    <div className="absolute top-4 right-4">
                                        <span className="px-3 py-1 bg-teal-600 text-white text-xs font-bold rounded-full">
                                            {property.propertyType || property.type || "Land"}
                                        </span>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">{property.title}</h3>
                                    <div className="flex items-center gap-2 text-slate-600 mb-4">
                                        <MapPin className="w-4 h-4" />
                                        <span className="text-sm">{property.location || property.state}</span>
                                    </div>
                                    <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                                        <div>
                                            <p className="text-xs text-slate-500 mb-1">Size</p>
                                            <p className="font-semibold text-slate-900">{property.size || "N/A"}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-slate-500 mb-1">Price</p>
                                            <p className="text-xl font-bold text-teal-600">
                                                ₦{Number(property.price || 0).toLocaleString()}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

                <div className="text-center">
                    <Link
                        href="/farm-nation/properties"
                        className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 transition shadow-lg shadow-teal-200 group"
                    >
                        View All Properties
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </Link>
                </div>
            </div>

            {/* Benefits Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 mb-12">
                    Why Choose Farm Nation?
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-teal-100 rounded-xl flex items-center justify-center mb-6">
                            <CheckCircle className="w-7 h-7 text-teal-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-3">Verified Properties</h3>
                        <p className="text-slate-600">Every property is inspected and verified with clear documentation and legal compliance.</p>
                    </div>
                    <div className="bg-white rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-teal-100 rounded-xl flex items-center justify-center mb-6">
                            <Search className="w-7 h-7 text-teal-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-3">Smart Search</h3>
                        <p className="text-slate-600">Filter by location, size, price, and property type to find your ideal agricultural land.</p>
                    </div>
                    <div className="bg-white rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-teal-100 rounded-xl flex items-center justify-center mb-6">
                            <Award className="w-7 h-7 text-teal-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-3">Expert Support</h3>
                        <p className="text-slate-600">Get professional guidance on property selection, legal processes, and investment strategy.</p>
                    </div>
                </div>
            </div>

            {/* CTA Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="bg-linear-to-r from-teal-600 to-cyan-600 rounded-3xl p-12 text-center text-white relative overflow-hidden">
                    <div className="absolute inset-0 bg-black/10 pointer-events-none"></div>
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Find Your Perfect Agricultural Property
                        </h2>
                        <p className="text-xl mb-8 text-teal-100 max-w-2xl mx-auto">
                            Browse verified agricultural properties across Nigeria. Start building your agribusiness empire today.
                        </p>
                        <Link
                            href="/farm-nation/onboarding"
                            className="group inline-flex items-center gap-3 bg-white text-teal-600 px-10 py-5 rounded-xl font-bold text-lg shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                        >
                            Register Your Farm Here
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
