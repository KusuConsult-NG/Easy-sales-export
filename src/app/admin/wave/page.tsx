"use client";

import { Waves, FileText, CheckCircle, Users } from "lucide-react";
import Link from "next/link";

export default function AdminWavePage() {
    const cards = [
        {
            title: "Pending Applications",
            description: "Review new WAVE program applications",
            icon: FileText,
            href: "/admin/wave/applications", // Nested path
            color: "text-blue-600",
            bg: "bg-blue-100"
        },
        {
            title: "WAVE Members",
            description: "Manage active WAVE participants",
            icon: Users,
            href: "/admin/wave/members", // Need to verify if this exists or is also top-level
            color: "text-purple-600",
            bg: "bg-purple-100"
        },
        {
            title: "Compliance",
            description: "Monitor program compliance and reports",
            icon: CheckCircle,
            href: "/admin/wave/compliance",
            color: "text-green-600",
            bg: "bg-green-100"
        }
    ];

    return (
        <div className="p-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    WAVE Program Administration
                </h1>
                <p className="text-slate-600">
                    Manage Women in Agriculture (WAVE) program applications and members
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
