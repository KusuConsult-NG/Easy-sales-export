/**
 * Admin Communications Hub
 * /admin/communications
 *
 * Entry point for all admin communication tools.
 */

import Link from "next/link";
import { Mail, History, Megaphone, Users, BarChart3 } from "lucide-react";

export default function AdminCommunicationsPage() {
    const cards = [
        {
            title: "Send Broadcast",
            description: "Compose and send an email to selected user groups with audience filters",
            icon: Megaphone,
            href: "/admin/communications/broadcast",
            color: "text-green-600",
            bg: "bg-green-100",
            badge: "Email",
            badgeColor: "bg-green-600",
        },
        {
            title: "Broadcast History",
            description: "View all past broadcasts, recipient counts, and delivery stats",
            icon: History,
            href: "/admin/communications/history",
            color: "text-slate-600",
            bg: "bg-slate-100",
            badge: "Logs",
            badgeColor: "bg-slate-600",
        },
    ];

    const audienceCards = [
        { label: "All Users", desc: "Every registered user on the platform" },
        { label: "Buyers", desc: "Users onboarded as marketplace buyers" },
        { label: "Sellers", desc: "Approved marketplace sellers" },
        { label: "Wholesale / Retail", desc: "Filter sellers by category" },
        { label: "Cooperative Members", desc: "Active cooperative members" },
        { label: "WAVE Applicants", desc: "WAVE program registrants" },
    ];

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-6xl mx-auto px-8 py-8">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center">
                            <Mail className="w-7 h-7 text-green-700" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900">Communications</h1>
                            <p className="text-slate-500 mt-0.5">Send email broadcasts to your platform users</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-8 py-10 space-y-10">
                {/* Action Cards */}
                <div>
                    <h2 className="text-lg font-bold text-slate-800 mb-4">Actions</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {cards.map((card) => {
                            const Icon = card.icon;
                            return (
                                <Link
                                    key={card.href}
                                    href={card.href}
                                    className="group bg-white rounded-2xl border border-slate-200 shadow-sm p-6 hover:shadow-md hover:border-slate-300 transition-all flex items-start gap-5"
                                >
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${card.bg}`}>
                                        <Icon className={`w-6 h-6 ${card.color}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="font-bold text-slate-900 group-hover:text-green-700 transition">{card.title}</h3>
                                            <span className={`px-2 py-0.5 text-xs font-bold text-white rounded-full ${card.badgeColor}`}>
                                                {card.badge}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-500">{card.description}</p>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>

                {/* Audience overview */}
                <div>
                    <h2 className="text-lg font-bold text-slate-800 mb-4">Available Audience Segments</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {audienceCards.map((a) => (
                            <div key={a.label} className="bg-white border border-slate-200 rounded-xl p-4">
                                <p className="font-semibold text-slate-900 text-sm">{a.label}</p>
                                <p className="text-xs text-slate-500 mt-0.5">{a.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Info note */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex gap-3">
                    <BarChart3 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                        <p className="font-semibold mb-1">How broadcasts work</p>
                        <p>Emails are sent in batches of 50 via Resend. Each send is logged in the broadcast history with delivery counts. Large broadcasts may take a few minutes to complete.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
