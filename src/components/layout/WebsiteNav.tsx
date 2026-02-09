"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";

export default function WebsiteNav() {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const router = useRouter();

    const navLinks = [
        { name: "Export Windows", href: "/export" },
        { name: "Marketplace", href: "/marketplace" },
        { name: "Cooperatives", href: "/cooperatives" },
        { name: "WAVE Program", href: "/wave" },
        { name: "Academy", href: "/academy" },
        { name: "Farm Nation", href: "/farm-nation" },
    ];

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-20">
                    {/* Logo */}
                    <Link href="/dashboard" className="flex items-center gap-3 group">
                        <div className="relative w-12 h-12 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all">
                            <span className="text-white font-bold text-xl">ES</span>
                        </div>
                        <div className="hidden sm:block">
                            <div className="text-xl font-bold text-slate-900">Easy Sales Export</div>
                            <div className="text-xs text-slate-600">Agricultural Export Platform</div>
                        </div>
                    </Link>

                    {/* Desktop Navigation */}
                    <div className="hidden lg:flex items-center gap-8">
                        {navLinks.map((link) => (
                            <Link
                                key={link.name}
                                href={link.href}
                                className="text-slate-700 hover:text-orange-600 font-medium transition-colors relative group"
                            >
                                {link.name}
                                <span className="absolute bottom-0 left-0 w-0 h-0.5 bg-orange-600 group-hover:w-full transition-all duration-300"></span>
                            </Link>
                        ))}
                    </div>

                    {/* Auth Buttons */}
                    <div className="hidden lg:flex items-center gap-4">
                        <button
                            onClick={() => router.push("/auth/login")}
                            className="px-6 py-2.5 text-slate-700 font-medium hover:text-orange-600 transition-colors"
                        >
                            Sign In
                        </button>
                        <button
                            onClick={() => router.push("/auth/register")}
                            className="px-6 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 text-white font-semibold rounded-xl hover:from-orange-700 hover:to-amber-700 shadow-lg hover:shadow-xl transition-all"
                        >
                            Get Started
                        </button>
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="lg:hidden p-2 text-slate-700 hover:text-orange-600 transition-colors"
                    >
                        {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>
                </div>
            </div>

            {/* Mobile Menu */}
            {isMobileMenuOpen && (
                <div className="lg:hidden bg-white border-t border-slate-200 shadow-lg">
                    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
                        {navLinks.map((link) => (
                            <Link
                                key={link.name}
                                href={link.href}
                                className="block text-slate-700 hover:text-orange-600 font-medium py-2 transition-colors"
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                {link.name}
                            </Link>
                        ))}
                        <div className="pt-4 border-t border-slate-200 space-y-3">
                            <button
                                onClick={() => {
                                    router.push("/auth/login");
                                    setIsMobileMenuOpen(false);
                                }}
                                className="w-full px-6 py-2.5 text-slate-700 font-medium border border-slate-300 rounded-xl hover:border-orange-600 hover:text-orange-600 transition-colors"
                            >
                                Sign In
                            </button>
                            <button
                                onClick={() => {
                                    router.push("/auth/register");
                                    setIsMobileMenuOpen(false);
                                }}
                                className="w-full px-6 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 text-white font-semibold rounded-xl hover:from-orange-700 hover:to-amber-700 shadow-lg transition-all"
                            >
                                Get Started
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
}
