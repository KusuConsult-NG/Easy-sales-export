import { MapPin, Sprout, Droplets, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function FarmNationPage() {
    // Mock land listings
    const listings = [
        {
            id: "1",
            title: "5 Hectares Prime Farmland - Oyo State",
            location: { state: "Oyo", lga: "Akinyele", address: "Off Ibadan-Oyo Road" },
            size: 5,
            pricePerHectare: 500000,
            totalPrice: 2500000,
            soilType: "Loamy",
            waterSource: "River nearby",
            accessibility: "Good road access",
            features: ["Cleared land", "Fenced", "Title documents ready"],
            image: "/images/farm1.png",
        },
        {
            id: "2",
            title: "10 Hectares Agricultural Land - Kaduna",
            location: { state: "Kaduna", lga: "Igabi", address: "Along Kaduna-Zaria Highway" },
            size: 10,
            pricePerHectare: 400000,
            totalPrice: 4000000,
            soilType: "Clay-loam",
            waterSource: "Borehole available",
            accessibility: "Tarred road",
            features: ["Irrigation ready", "C of O available", "Electricity nearby"],
            image: "/images/farm2.png",
        },
        {
            id: "3",
            title: "3 Hectares Garden Plot - Ogun State",
            location: { state: "Ogun", lga: "Odeda", address: "Abeokuta Rural Area" },
            size: 3,
            pricePerHectare: 600000,
            totalPrice: 1800000,
            soilType: "Sandy-loam",
            waterSource: "Stream access",
            accessibility: "Motorable road",
            features: ["Suitable for vegetables", "Near market", "Survey plan available"],
            image: "/images/farm3.png",
        },
    ];

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                        <Sprout className="w-6 h-6 text-green-600 dark:text-green-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                        Farm Nation
                    </h1>
                </div>
                <p className="text-slate-600 dark:text-slate-400">
                    Buy, sell, and lease agricultural land across Nigeria
                </p>
            </div>

            {/* Hero Banner */}
            <div className="bg-gradient-to-br from-green-600 to-emerald-700 rounded-2xl p-8 text-white elevation-3 mb-8 animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]">
                <h2 className="text-2xl font-bold mb-4">
                    Your Gateway to Agricultural Land Ownership
                </h2>
                <p className="text-green-100 mb-6 max-w-3xl">
                    Browse verified farmland listings across Nigeria. All properties come
                    with proper documentation and are verified by our team.
                </p>
                <div className="flex gap-4">
                    <button className="px-8 py-4 bg-white text-green-600 font-bold rounded-xl hover:scale-105 transition-transform elevation-2">
                        Browse Listings
                    </button>
                    <button className="px-8 py-4 border-2 border-white text-white font-bold rounded-xl hover:bg-white/10 transition-colors">
                        List Your Land
                    </button>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                {[
                    { label: "Active Listings", value: "127", icon: MapPin },
                    { label: "States Covered", value: "24", icon: Sprout },
                    { label: "Total Hectares", value: "1,450", icon: TrendingUp },
                    { label: "Verified Sellers", value: "89", icon: Droplets },
                ].map((stat, index) => (
                    <div
                        key={index}
                        className="bg-white dark:bg-slate-800 rounded-xl p-5 elevation-2 animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]"
                        style={{ animationDelay: `${100 + index * 50}ms` }}
                    >
                        <div className="flex items-center gap-3 mb-2">
                            <stat.icon className="w-5 h-5 text-primary" />
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {stat.label}
                            </p>
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {stat.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Land Listings */}
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                    Featured Listings
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {listings.map((listing, index) => (
                        <div
                            key={listing.id}
                            className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-3 hover-glow animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]"
                            style={{ animationDelay: `${200 + index * 100}ms` }}
                        >
                            {/* Image Placeholder */}
                            <div className="h-48 bg-gradient-to-br from-green-100 to-emerald-200 dark:from-green-900 dark:to-emerald-800 flex items-center justify-center">
                                <Sprout className="w-16 h-16 text-green-600 dark:text-green-400" />
                            </div>

                            {/* Content */}
                            <div className="p-6">
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-3">
                                    {listing.title}
                                </h3>

                                <div className="flex items-start gap-2 mb-4 text-sm text-slate-600 dark:text-slate-400">
                                    <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                                    <span>
                                        {listing.location.address}, {listing.location.lga},{" "}
                                        {listing.location.state}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                            Land Size
                                        </p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {listing.size} Hectares
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                            Price/Hectare
                                        </p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {formatCurrency(listing.pricePerHectare)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                            Soil Type
                                        </p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {listing.soilType}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                                            Water Source
                                        </p>
                                        <p className="font-semibold text-slate-900 dark:text-white">
                                            {listing.waterSource}
                                        </p>
                                    </div>
                                </div>

                                <div className="mb-4">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                                        Features
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {listing.features.map((feature, idx) => (
                                            <span
                                                key={idx}
                                                className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-semibold rounded-full"
                                            >
                                                {feature}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Total Price
                                        </p>
                                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                            {formatCurrency(listing.totalPrice)}
                                        </p>
                                    </div>
                                    <button className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold rounded-xl hover:scale-105 transition-transform elevation-2">
                                        View Details
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Why Farm Nation */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                    Why Buy Through Farm Nation?
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        {
                            title: "Verified Listings",
                            description:
                                "All land listings are verified by our team and come with proper documentation",
                        },
                        {
                            title: "Secure Transactions",
                            description:
                                "Escrow protection ensures your funds are safe until title transfer is complete",
                        },
                        {
                            title: "Expert Support",
                            description:
                                "Our team of agricultural and legal experts guide you through every step",
                        },
                    ].map((benefit, index) => (
                        <div key={index}>
                            <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                                {benefit.title}
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                {benefit.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
