"use client";

import { useState } from "react";
import Image from "next/image";
import { MapPin, DollarSign, Maximize, Heart, Filter } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface Property {
    id: string;
    name: string;
    location: string;
    state: string;
    price: number;
    size: number; // in hectares
    type: "sale" | "lease";
    image: string;
    description: string;
}

export default function FarmNationPage() {
    const [selectedState, setSelectedState] = useState("all");
    const [priceRange, setPriceRange] = useState("all");
    const [sizeRange, setSizeRange] = useState("all");
    const [favorites, setFavorites] = useState<string[]>([]);

    const properties: Property[] = [
        {
            id: "1",
            name: "Prime Farmland in Kaduna",
            location: "Zaria, Kaduna",
            state: "kaduna",
            price: 5000000,
            size: 10,
            type: "sale",
            image: "/images/logo.jpg",
            description: "Fertile land suitable for cassava, yam, and maize cultivation",
        },
        {
            id: "2",
            name: "Riverside Farm Plot",
            location: "Makurdi, Benue",
            state: "benue",
            price: 3500000,
            size: 5,
            type: "sale",
            image: "/images/logo.jpg",
            description: "Access to water, perfect for rice farming",
        },
        {
            id: "3",
            name: "Large Scale farmland",
            location: "Plateau State",
            state: "plateau",
            price: 12000000,
            size: 25,
            type: "sale",
            image: "/images/logo.jpg",
            description: "Ideal for large-scale agricultural projects",
        },
        {
            id: "4",
            name: "Lease: Family Farm",
            location: "Ogun State",
            state: "ogun",
            price: 500000,
            size: 3,
            type: "lease",
            image: "/images/logo.jpg",
            description: "1-year lease, ready for immediate farming",
        },
        {
            id: "5",
            name: "Lease: Commercial Plot",
            location: "Kano State",
            state: "kano",
            price: 800000,
            size: 8,
            type: "lease",
            image: "/images/logo.jpg",
            description: "2-year lease with irrigation system",
        },
        {
            id: "6",
            name: "Premium Farmland",
            location: "Lagos-Ibadan Expressway",
            state: "ogun",
            price: 8000000,
            size: 15,
            type: "sale",
            image: "/images/logo.jpg",
            description: "Strategic location, suitable for mixed farming",
        },
    ];

    const states = [
        { value: "all", label: "All States" },
        { value: "plateau", label: "Plateau" },
        { value: "kaduna", label: "Kaduna" },
        { value: "benue", label: "Benue" },
        { value: "ogun", label: "Ogun" },
        { value: "kano", label: "Kano" },
        { value: "lagos", label: "Lagos" },
    ];

    const priceRanges = [
        { value: "all", label: "Any Price" },
        { value: "0-2m", label: "Under ₦2M" },
        { value: "2m-5m", label: "₦2M - ₦5M" },
        { value: "5m-10m", label: "₦5M - ₦10M" },
        { value: "10m+", label: "₦10M+" },
    ];

    const sizeRanges = [
        { value: "all", label: "Any Size" },
        { value: "0-5", label: "Under 5 hectares" },
        { value: "5-10", label: "5-10 hectares" },
        { value: "10-20", label: "10-20 hectares" },
        { value: "20+", label: "20+ hectares" },
    ];

    // Filter properties
    const filteredProperties = properties.filter((property) => {
        const matchesState =
            selectedState === "all" || property.state === selectedState;

        let matchesPrice = true;
        if (priceRange === "0-2m") matchesPrice = property.price < 2000000;
        else if (priceRange === "2m-5m")
            matchesPrice = property.price >= 2000000 && property.price < 5000000;
        else if (priceRange === "5m-10m")
            matchesPrice = property.price >= 5000000 && property.price < 10000000;
        else if (priceRange === "10m+") matchesPrice = property.price >= 10000000;

        let matchesSize = true;
        if (sizeRange === "0-5") matchesSize = property.size < 5;
        else if (sizeRange === "5-10")
            matchesSize = property.size >= 5 && property.size < 10;
        else if (sizeRange === "10-20")
            matchesSize = property.size >= 10 && property.size < 20;
        else if (sizeRange === "20+") matchesSize = property.size >= 20;

        return matchesState && matchesPrice && matchesSize;
    });

    //  Toggle favorites
    const toggleFavorite = (id: string) => {
        setFavorites((prev) =>
            prev.includes(id) ? prev.filter((fav) => fav !== id) : [...prev, id]
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="p-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Farm Nation
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Invest in agricultural land or find farmland for lease
                    </p>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Filter className="w-5 h-5 text-slate-500" />
                        <h2 className="font-bold text-slate-900 dark:text-white">Filters</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* State Filter */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                State
                            </label>
                            <select
                                value={selectedState}
                                onChange={(e) => setSelectedState(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                {states.map((state) => (
                                    <option key={state.value} value={state.value}>
                                        {state.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Price Filter */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                Price Range
                            </label>
                            <select
                                value={priceRange}
                                onChange={(e) => setPriceRange(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                {priceRanges.map((range) => (
                                    <option key={range.value} value={range.value}>
                                        {range.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Size Filter */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                Land Size
                            </label>
                            <select
                                value={sizeRange}
                                onChange={(e) => setSizeRange(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                {sizeRanges.map((range) => (
                                    <option key={range.value} value={range.value}>
                                        {range.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Properties Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredProperties.length > 0 ? (
                        filteredProperties.map((property, index) => (
                            <div
                                key={property.id}
                                className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-2 hover-lift animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <div className="relative h-56 bg-slate-100 dark:bg-slate-700">
                                    <Image
                                        src={property.image}
                                        alt={property.name}
                                        fill
                                        className="object-cover"
                                    />
                                    <div className="absolute top-3 right-3 flex gap-2">
                                        <span
                                            className={`px-3 py-1 ${property.type === "sale"
                                                    ? "bg-green-500"
                                                    : "bg-blue-500"
                                                } text-white text-xs font-bold rounded-full`}
                                        >
                                            For {property.type === "sale" ? "Sale" : "Lease"}
                                        </span>
                                        <button
                                            onClick={() => toggleFavorite(property.id)}
                                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${favorites.includes(property.id)
                                                    ? "bg-red-500 text-white"
                                                    : "bg-white/90 text-slate-600 hover:bg-white"
                                                }`}
                                        >
                                            <Heart
                                                className={`w-4 h-4 ${favorites.includes(property.id) ? "fill-current" : ""
                                                    }`}
                                            />
                                        </button>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                        {property.name}
                                    </h3>
                                    <div className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400 mb-2">
                                        <MapPin className="w-4 h-4" />
                                        {property.location}
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                        {property.description}
                                    </p>
                                    <div className="flex items-center justify-between mb-4">
                                        <div>
                                            <p className="text-2xl font-bold text-primary">
                                                {formatCurrency(property.price)}
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                {property.type === "lease" ? "per year" : ""}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
                                            <Maximize className="w-4 h-4" />
                                            <span className="font-semibold">{property.size} ha</span>
                                        </div>
                                    </div>
                                    <button className="w-full px-4 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors">
                                        View Details
                                    </button>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="col-span-full text-center py-12">
                            <p className="text-slate-500 dark:text-slate-400">
                                No properties match your filters
                            </p>
                        </div>
                    )}
                </div>

                {/* Favorites Count */}
                {favorites.length > 0 && (
                    <div className="fixed bottom-8 right-8 bg-primary text-white px-6 py-3 rounded-full elevation-3 flex items-center gap-2">
                        <Heart className="w-5 h-5 fill-current" />
                        <span className="font-semibold">
                            {favorites.length} {favorites.length === 1 ? "Favorite" : "Favorites"}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
