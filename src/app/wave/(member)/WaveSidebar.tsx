/**
 * WAVE Sidebar Navigation
 * 
 * Fixed sidebar for member portal navigation
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Home,
    BookOpen,
    Video,
    FileText,
    Award,
    TrendingUp,
    Package,
    User,
    Menu,
    X,
    Sparkles
} from "lucide-react";
import { useState } from "react";

const navItems = [
    { icon: Home, label: "Dashboard", href: "/wave/dashboard" },
    { icon: BookOpen, label: "Training", href: "/wave/training" },
    { icon: Video, label: "Live Training", href: "/wave/live-training" },
    { icon: FileText, label: "Resources", href: "/wave/resources" },
    { icon: Award, label: "Certificates", href: "/wave/certificates" },
    { icon: TrendingUp, label: "Earnings", href: "/wave/earnings" },
    // { icon: Package, label: "Shipments", href: "/wave/shipments" },
    { icon: User, label: "Profile", href: "/wave/profile" },
];

export default function WaveSidebar() {
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

    return (
        <>
            {/* Mobile Menu Button */}
            <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-emerald-900 text-white rounded-lg shadow-lg border border-emerald-700"
            >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Sidebar */}
            <aside
                className={`fixed top-0 left-0 h-full w-64 bg-emerald-900 border-r border-emerald-800 transition-transform z-40 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                    }`}
            >
                {/* Header */}
                <div className="p-6 border-b border-emerald-800">
                    <Link href="/wave" className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/20">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="font-bold text-white">WAVE</h2>
                            <p className="text-xs text-emerald-200">Member Portal</p>
                        </div>
                    </Link>
                </div>

                {/* Navigation */}
                <nav className="p-4 space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active
                                    ? "bg-white text-emerald-900 shadow-lg"
                                    : "text-emerald-100 hover:bg-emerald-800"
                                    }`}
                            >
                                <Icon className="w-5 h-5" />
                                <span className="font-medium">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* User Info (Mock) */}
                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-emerald-800 bg-emerald-950/30">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-900/50 border border-emerald-800">
                        <div className="w-10 h-10 bg-emerald-700 rounded-full flex items-center justify-center text-white font-bold border border-emerald-600">
                            JD
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-white truncate">
                                Jane Doe
                            </p>
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-400/20 text-emerald-200 text-xs font-semibold rounded-full border border-emerald-400/20">
                                    WAVE Member
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Mobile Overlay */}
            {mobileMenuOpen && (
                <div
                    onClick={() => setMobileMenuOpen(false)}
                    className="lg:hidden fixed inset-0 bg-black/50 z-30"
                />
            )}
        </>
    );
}
