"use client";

import { ShoppingBag, Users, AlertTriangle, CheckSquare, Zap, Wallet, Shield, Star } from "lucide-react";
import Link from "next/link";

export default function AdminMarketplacePage() {
    const cards = [
        {
            title: "Seller Verification",
            description: "Review and approve new seller accounts",
            icon: Users,
            href: "/admin/marketplace/sellers",
            color: "text-blue-600",
            bg: "bg-blue-100"
        },
        {
            title: "Product Reviews",
            description: "Moderate pending product and seller reviews",
            icon: Star,
            href: "/admin/marketplace/reviews",
            color: "text-purple-600",
            bg: "bg-purple-100"
        },
        {
            title: "Disputes",
            description: "Resolve buyer/seller disputes",
            icon: AlertTriangle,
            href: "/admin/marketplace/disputes",
            color: "text-red-600",
            bg: "bg-red-100"
        },
        {
            title: "Village Market",
            description: "Create and manage flash-sale events",
            icon: Zap,
            href: "/admin/marketplace/village-market",
            color: "text-emerald-600",
            bg: "bg-emerald-100"
        },
        {
            title: "Wallet Withdrawals",
            description: "Approve or reject seller withdrawal requests",
            icon: Wallet,
            href: "/admin/marketplace/withdrawals",
            color: "text-amber-600",
            bg: "bg-amber-100"
        },
        {
            title: "Escrow Management",
            description: "Oversee escrow holds and release requests",
            icon: Shield,
            href: "/admin/marketplace/escrow",
            color: "text-indigo-600",
            bg: "bg-indigo-100"
        },
    ];

    return (
        <div className="p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    Marketplace Administration
                </h1>
                <p className="text-slate-600">
                    Oversee marketplace sellers, products, and dispute resolution
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
