"use client";

import { ArrowRight, MapPin, TrendingUp, Home, CheckCircle, Search, Award } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import BackToHub from "@/components/common/BackToHub";

export default function FarmNationLandingPage() {
    const featuredProperties = [
        {
            title: "Prime Irrigated Farmland",
            location: "Kaduna State",
            size: "50 hectares",
            price: "₦45,000,000",
            type: "Arable Land",
            image: "/images/logo.jpg"
        },
        {
            title: "Commercial Poultry Farm",
            location: "Ogun State",
            size: "5 hectares",
            price: "₦22,000,000",
            type: "Poultry",
            image: "/images/logo.jpg"
        },
        {
            title: "Fish Farm with Ponds",
            location: "Delta State",
            size: "3 hectares",
            price: "₦18,500,000",
            type: "Fishery",
            image: "/images/logo.jpg"
        }
    ];

    const categories = [
        { name: "Arable Land", icon: "🌾", count: "450+" },
        { name: "Leasing Options", icon: "📋", count: "280+" },
        { name: "Poultry Farms", icon: "🐔", count: "120+" },
        { name: "Fish Farms", icon: "🐟", count: "95+" },
        { name: "Greenhouses", icon: "🏡", count: "65+" },
        { name: "Mixed-Use", icon: "🌻", count: "180+" }
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">


            {/* Hero Section */}
            <div className="relative overflow-hidden bg-linear-to-br from-teal-600 via-cyan-600 to-blue-600 text-white">
                <BackToHub variant="dark" className="top-4 left-4 border-white/20" />
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-4 md:px-8 py-12 md:py-24">
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
                                Get Started
                                <ArrowRight className="w-4 h-4 md:w-5 md:h-5 group-hover:translate-x-1 transition-transform" />
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
                        <div className="text-4xl font-bold text-teal-600 mb-2">1,200+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Properties Listed</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-teal-600 mb-2">36 States</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Nationwide Coverage</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-teal-600 mb-2">₦8.5B+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Properties Value</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-teal-600 mb-2">850+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Successful Deals</div>
                    </div>
                </div>
            </div>

            {/* Categories */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-12">
                    Farm Categories
                </h2>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-12">
                    {categories.map((category, index) => (
                        <div key={index} className="bg-white dark:bg-slate-800 rounded-xl p-6 elevation-2 hover-lift text-center">
                            <div className="text-4xl mb-3">{category.icon}</div>
                            <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1">{category.name}</h4>
                            <p className="text-xs text-teal-600 font-semibold">{category.count}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Featured Properties */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-4">
                    Featured Farms
                </h2>
                <p className="text-center text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto">
                    Premium agricultural properties verified and ready for investment
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                    {featuredProperties.map((property, index) => (
                        <div key={index} className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-2 hover-lift">
                            <div className="relative h-56 bg-slate-200 dark:bg-slate-700">
                                <Image
                                    src={property.image}
                                    alt={property.title}
                                    fill
                                    className="object-cover"
                                />
                                <div className="absolute top-4 right-4">
                                    <span className="px-3 py-1 bg-teal-600 text-white text-xs font-bold rounded-full">
                                        {property.type}
                                    </span>
                                </div>
                            </div>
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    {property.title}
                                </h3>
                                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-4">
                                    <MapPin className="w-4 h-4" />
                                    <span className="text-sm">{property.location}</span>
                                </div>
                                <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Size</p>
                                        <p className="font-semibold text-slate-900 dark:text-white">{property.size}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Price</p>
                                        <p className="text-xl font-bold text-teal-600">{property.price}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="text-center">
                    <Link
                        href="/auth/register?callbackUrl=/farm-nation/onboarding"
                        className="inline-flex items-center justify-center w-full sm:w-auto px-8 py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition shadow-lg shadow-emerald-200 group"
                    >                  View All Farms
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </div>

            {/* Benefits Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-12">
                    Why Choose Farm Nation?
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-teal-100 dark:bg-teal-900/30 rounded-xl flex items-center justify-center mb-6">
                            <CheckCircle className="w-7 h-7 text-teal-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Verified Properties
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Every property is inspected and verified with clear documentation and legal compliance.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-teal-100 dark:bg-teal-900/30 rounded-xl flex items-center justify-center mb-6">
                            <Search className="w-7 h-7 text-teal-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Smart Search
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Filter by location, size, price, and property type to find your ideal agricultural land.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-teal-100 dark:bg-teal-900/30 rounded-xl flex items-center justify-center mb-6">
                            <Award className="w-7 h-7 text-teal-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Expert Support
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Get professional guidance on property selection, legal processes, and investment strategy.
                        </p>
                    </div>
                </div>
            </div>

            {/* CTA Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="bg-linear-to-r from-teal-600 to-cyan-600 rounded-3xl p-12 text-center text-white relative overflow-hidden">
                    <div className="absolute inset-0 bg-black/10"></div>
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Find Your Perfect Agricultural Property
                        </h2>
                        <p className="text-xl mb-8 text-teal-100 max-w-2xl mx-auto">
                            Browse over 1,200 verified agricultural properties across Nigeria. Start building your agribusiness empire today.
                        </p>
                        <Link
                            href="/farm-nation/properties"
                            className="group inline-flex items-center gap-3 bg-white text-teal-600 px-10 py-5 rounded-xl font-bold text-lg shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                        >
                            Explore Farms
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
