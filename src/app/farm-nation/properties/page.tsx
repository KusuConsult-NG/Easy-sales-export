"use client";

import { MapPin, ArrowRight, Filter, Search, Home, TrendingUp, Layers } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function FarmNationPropertiesPage() {
    const properties = [
        {
            id: 1,
            title: "Prime Irrigated Farmland",
            location: "Kaduna State",
            size: "50 hectares",
            price: "₦45,000,000",
            type: "Arable Land",
            status: "Available",
            features: ["Irrigation System", "Road Access", "Fenced"],
            image: "/images/logo.jpg"
        },
        {
            id: 2,
            title: "Commercial Poultry Farm",
            location: "Ogun State",
            size: "5 hectares",
            price: "₦22,000,000",
            type: "Poultry",
            status: "Available",
            features: ["Modern Facilities", "Power Supply", "Water Source"],
            image: "/images/logo.jpg"
        },
        {
            id: 3,
            title: "Fish Farm with Ponds",
            location: "Delta State",
            size: "3 hectares",
            price: "₦18,500,000",
            type: "Fishery",
            status: "Available",
            features: ["8 Concrete Ponds", "Water System", "Storage"],
            image: "/images/logo.jpg"
        },
        {
            id: 4,
            title: "Rice Farm & Processing Unit",
            location: "Niger State",
            size: "100 hectares",
            price: "₦95,000,000",
            type: "Arable Land",
            status: "Available",
            features: ["Processing Facility", "Warehouse", "Irrigation"],
            image: "/images/logo.jpg"
        },
        {
            id: 5,
            title: "Poultry Farm (Leasing)",
            location: "Lagos State",
            size: "2 hectares",
            price: "₦500,000/month",
            type: "Leasing",
            status: "Available",
            features: ["Fully Equipped", "Utilities Included", "Security"],
            image: "/images/logo.jpg"
        },
        {
            id: 6,
            title: "Greenhouse Farm Complex",
            location: "Plateau State",
            size: "7 hectares",
            price: "₦38,000,000",
            type: "Greenhouse",
            status: "Available",
            features: ["Climate Control", "Drip Irrigation", "Premium Location"],
            image: "/images/logo.jpg"
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white py-16">
                <div className="max-w-7xl mx-auto px-8">
                    <div className="flex items-center gap-3 mb-4">
                        <Home className="w-8 h-8" />
                        <h1 className="text-4xl font-bold">Browse Agricultural Properties</h1>
                    </div>
                    <p className="text-teal-100 text-lg max-w-2xl">
                        Find verified agricultural land and facilities across Nigeria
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
                                    placeholder="Search properties by location or type..."
                                    className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
                                />
                            </div>
                        </div>

                        {/* Property Type Filter */}
                        <select className="px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition">
                            <option>All Types</option>
                            <option>Arable Land</option>
                            <option>Poultry Farms</option>
                            <option>Fish Farms</option>
                            <option>Greenhouses</option>
                            <option>Leasing Options</option>
                        </select>

                        {/* Location Filter */}
                        <select className="px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition">
                            <option>All Locations</option>
                            <option>North Central</option>
                            <option>North East</option>
                            <option>North West</option>
                            <option>South East</option>
                            <option>South South</option>
                            <option>South West</option>
                        </select>

                        {/* Price Range Filter */}
                        <select className="px-4 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 transition">
                            <option>Any Price</option>
                            <option>Under ₦20M</option>
                            <option>₦20M - ₦50M</option>
                            <option>₦50M - ₦100M</option>
                            <option>Above ₦100M</option>
                        </select>
                    </div>
                </div>

                {/* Results Header */}
                <div className="flex items-center justify-between mb-6">
                    <p className="text-slate-600 dark:text-slate-400">
                        Showing <span className="font-bold text-slate-900 dark:text-white">{properties.length}</span> properties
                    </p>
                    <select className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-sm">
                        <option>Sort by: Newest</option>
                        <option>Price: Low to High</option>
                        <option>Price: High to Low</option>
                        <option>Size: Largest</option>
                    </select>
                </div>

                {/* Properties Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {properties.map((property) => (
                        <div
                            key={property.id}
                            className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all hover:-translate-y-1"
                        >
                            {/* Property Image */}
                            <div className="relative h-48 bg-slate-200 dark:bg-slate-700">
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
                                <div className="absolute top-4 left-4">
                                    <span className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full">
                                        {property.status}
                                    </span>
                                </div>
                            </div>

                            {/* Property Details */}
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    {property.title}
                                </h3>
                                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-4">
                                    <MapPin className="w-4 h-4" />
                                    <span className="text-sm">{property.location}</span>
                                </div>

                                {/* Features */}
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {property.features.map((feature, idx) => (
                                        <span
                                            key={idx}
                                            className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-xs text-slate-600 dark:text-slate-300 rounded"
                                        >
                                            {feature}
                                        </span>
                                    ))}
                                </div>

                                {/* Price & Size */}
                                <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700 mb-4">
                                    <div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Size</p>
                                        <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1">
                                            <Layers className="w-4 h-4" />
                                            {property.size}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Price</p>
                                        <p className="text-xl font-bold text-teal-600">{property.price}</p>
                                    </div>
                                </div>

                                {/* CTA */}
                                <Link
                                    href={`/farm-nation/properties/${property.id}`}
                                    className="block w-full text-center px-6 py-3 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition"
                                >
                                    View Details
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Pagination */}
                <div className="mt-12 flex justify-center gap-2">
                    <button className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                        Previous
                    </button>
                    <button className="px-4 py-2 bg-teal-600 text-white rounded-xl font-semibold">1</button>
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
                <div className="mt-16 bg-gradient-to-r from-teal-600 to-cyan-600 rounded-3xl p-12 text-center text-white">
                    <h2 className="text-3xl font-bold mb-4">Can't Find What You're Looking For?</h2>
                    <p className="text-xl mb-8 text-teal-100 max-w-2xl mx-auto">
                        Let us know your requirements and we'll help you find the perfect agricultural property
                    </p>
                    <Link
                        href="/contact"
                        className="inline-flex items-center gap-2 px-10 py-4 bg-white text-teal-600 font-bold text-lg rounded-xl shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                    >
                        <TrendingUp className="w-5 h-5" />
                        Contact Our Team
                    </Link>
                </div>
            </div>
        </div>
    );
}
