/**
 * Academy Sidebar Navigation
 * 
 * Custom sidebar for Academy module with Indigo/Blue theme
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    BookOpen,
    Video,
    Award,
    User,
    Menu,
    X,
    LogOut,
    GraduationCap
} from "lucide-react";
import { useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import Image from "next/image";
import { COMPANY_INFO } from "@/lib/constants";

const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/academy/dashboard" },
    { icon: BookOpen, label: "My Courses", href: "/academy/courses" },
    { icon: Video, label: "Live Classes", href: "/academy/live" },
    { icon: Award, label: "Certificates", href: "/academy/certificate" },
    // { icon: User, label: "Profile", href: "/academy/profile" },
];

export default function AcademySidebar() {
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

    return (
        <>
            {/* Mobile Menu Button */}
            <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-indigo-900 text-white rounded-lg shadow-lg border border-indigo-700"
            >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Sidebar */}
            <aside
                className={`fixed top-0 left-0 h-full w-64 bg-indigo-900 border-r border-indigo-800 transition-transform z-40 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                    }`}
            >
                {/* Header */}
                <div className="p-6 border-b border-indigo-800">
                    {/* Company Brand */}
                    <div className="flex items-center gap-2 mb-6 opacity-80">
                        <Image
                            src="/images/logo.jpg"
                            alt={COMPANY_INFO.name}
                            width={24}
                            height={24}
                            className="rounded-full"
                        />
                        <span className="text-xs font-bold text-white tracking-widest uppercase">
                            {COMPANY_INFO.name}
                        </span>
                    </div>

                    <Link href="/academy" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/20 group-hover:bg-white/20 transition-colors">
                            <GraduationCap className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="font-bold text-white text-lg">Academy</h2>
                            <p className="text-xs text-indigo-200">Student Portal</p>
                        </div>
                    </Link>
                </div>

                {/* Navigation */}
                <nav className="p-4 space-y-1 flex-1 overflow-y-auto">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active
                                    ? "bg-white text-indigo-900 shadow-lg"
                                    : "text-indigo-100 hover:bg-indigo-800"
                                    }`}
                            >
                                <Icon className="w-5 h-5" />
                                <span className="font-medium">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* Footer */}
                <div className="p-4 border-t border-indigo-800 bg-indigo-950/30">
                    <form action={logoutAction}>
                        <button
                            type="submit"
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-indigo-200 hover:bg-indigo-800 hover:text-white transition-colors"
                        >
                            <LogOut className="w-5 h-5" />
                            <span className="font-medium">Sign Out</span>
                        </button>
                    </form>
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
