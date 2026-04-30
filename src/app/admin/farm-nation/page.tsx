"use client";

import { Tractor, MapPin, Search, Shield } from "lucide-react";
import Link from "next/link";

export default function AdminFarmNationPage() {
    const cards = [
        {
            title: "Land Verification",
            description: "Review pending land listing verifications",
            icon: MapPin,
            href: "/admin/farm-nation/land-verification", // Nested path
            color: "text-green-600",
            bg: "bg-green-100"
        },
        {
            title: "Listing Management",
            description: "Oversee all farm land listings",
            icon: Tractor,
            href: "/admin/farm-nation/listings",
            color: "text-amber-600",
            bg: "bg-amber-100"
        },
        {
            title: "Registration Applications",
            description: "Review and approve Farm Nation applications",
            icon: Search,
            href: "/admin/farm-nation/applications",
            color: "text-blue-600",
            bg: "bg-blue-100"
        },
        {
            title: "Escrow Management",
            description: "Manage real estate payments and title transfers",
            icon: Shield,
            href: "/admin/farm-nation/escrow",
            color: "text-indigo-600",
            bg: "bg-indigo-100"
        }
    ];

    return (
        <div className="p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    Farm Nation Administration
                </h1>
                <p className="text-slate-600">
                    Manage land listings, verifications, and property sellers
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {cards.map((card) => (
                    <Link
                        key={card.title}
                        href={card.href}
                        className="bg-white p-6 rounded-2xl shadow-sm hover:shadow-md transition group"
                    >
                        <div className={`w-12 h-12 rounded-xl ${card.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                            <card.icon className={`w-6 h-6 ${card.color}`} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-1">
                            {card.title}
                        </h3>
                        <p className="text-sm text-slate-500">
                            {card.description}
                        </p>
                    </Link>
                ))}
            </div>
        </div>
    );
}
