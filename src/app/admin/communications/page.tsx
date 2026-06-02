/**
 * Admin Communications Hub
 * /admin/communications
 *
 * Entry point for all admin communication tools.
 */

import Link from "next/link";
import { Mail, History, Megaphone, BarChart3, MessageSquare, Bell } from "lucide-react";

export default function AdminCommunicationsPage() {
    const cards = [
        {
            title: "Email Broadcast",
            description: "Compose and send an email to selected user groups with audience filters",
            icon: Megaphone,
            href: "/admin/communications/broadcast",
            color: "text-green-600",
            bg: "bg-green-100",
            badge: "Email",
            badgeColor: "bg-green-600",
        },
        {
            title: "SMS Broadcast",
            description: "Send a text message to selected users by audience — powered by Africa's Talking",
            icon: MessageSquare,
            href: "/admin/communications/sms",
            color: "text-blue-600",
            bg: "bg-blue-100",
            badge: "SMS",
            badgeColor: "bg-blue-600",
        },
        {
            title: "In-App Notification",
            description: "Push a notification directly into users' notification bell, even if they're offline",
            icon: Bell,
            href: "/admin/communications/in-app",
            color: "text-purple-600",
            bg: "bg-purple-100",
            badge: "In-App",
            badgeColor: "bg-purple-600",
        },
        {
            title: "Broadcast History",
            description: "View all past email broadcasts, recipient counts, and delivery stats",
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
        { label: "WAVE Briefing Registrants", desc: "Users registered for briefing sessions" },
        { label: "Marketplace Onboarded", desc: "All buyers and sellers combined" },
        { label: "Academy Users", desc: "Users who have applied to Academy" },
        { label: "Export Users", desc: "Users applied for export onboarding" },
        { label: "Farm Nation Users", desc: "Farm Nation inquiry applicants" },
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
                            <p className="text-slate-500 mt-0.5">Send email, SMS, and in-app notifications to your platform users</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-8 py-10 space-y-10">
                {/* Action Cards */}
                <div>
                    <h2 className="text-lg font-bold text-slate-800 mb-4">Broadcast Channels</h2>
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
                    <p className="text-slate-500 text-sm mb-4">All three broadcast channels support filtering by the same audience segments below.</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                        <p className="font-semibold mb-1">How each channel works</p>
                        <ul className="space-y-1 text-blue-700">
                            <li>📧 <strong>Email:</strong> Sent in batches via Resend. Each send is logged in Broadcast History.</li>
                            <li>📱 <strong>SMS:</strong> Sent via Africa's Talking in batches of 10. Consumes Africa's Talking credits per recipient.</li>
                            <li>🔔 <strong>In-App:</strong> Written directly to Firestore. Users see it instantly if online, or on next login if offline.</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
