"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X, LayoutDashboard, LogIn, LogOut } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useFeatureToggles } from "@/hooks/useFeatureToggle";
export default function HubNavigation() {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isEcosystemOpen, setIsEcosystemOpen] = useState(false);
    const pathname = usePathname();
    const { data: session } = useSession();
    const toggles = useFeatureToggles(["wave_program", "academy_courses", "cooperative_loans", "farm_nation_purchases"]);

    const handleLogout = async () => {
        try {
            const { signOut: firebaseSignOut } = await import("firebase/auth");
            const { auth } = await import("@/lib/firebase");
            await firebaseSignOut(auth);
        } catch (e) {
            console.error("Firebase signout failed", e);
        }
        await signOut({ callbackUrl: "/auth/login" });
    };

    const isMale = session?.user?.gender?.toLowerCase() === "male";

    const navItems = [
        // Home removed per user request
        { label: "About Easy Sales Export", href: "/about" },
        {
            label: "Ecosystem",
            href: "#",
            dropdown: [
                ...(toggles.cooperative_loans !== false ? [{ label: "Cooperatives", href: "/cooperatives" }] : []),
                { label: "Marketplace", href: "/marketplace" },
                { label: "Export Windows", href: "/export" },
                ...(toggles.farm_nation_purchases !== false ? [{ label: "Farm Nation", href: "/farm-nation" }] : []),
                ...(toggles.academy_courses !== false ? [{ label: "Academy", href: "/academy" }] : []),
            ],
        },
        ...(toggles.wave_program !== false && !isMale ? [{ label: "WAVE Program", href: "/wave/landing" }] : []),
        { label: "Export", href: "/export" },
        { label: "Contact", href: "/contact" },
    ];

    const isActive = (href: string) => {
        if (href === "/") return pathname === "/";
        return pathname?.startsWith(href);
    };

    return (
        <nav className="sticky top-0 z-50 bg-white shadow-md">
            <div className="max-w-7xl mx-auto px-4">
                <div className="flex items-center justify-between h-16">
                    {/* Logo/Brand */}
                    <Link href="/" className="flex items-center gap-2">
                        <span className="text-xl font-bold text-primary">
                            Easy Sales Export
                        </span>
                    </Link>

                    {/* Desktop Navigation */}
                    <div className="hidden lg:flex items-center gap-1">
                        {navItems.map((item, index) => (
                            <div key={index} className="relative group">
                                {item.dropdown ? (
                                    <>
                                        <button
                                            onClick={() => setIsEcosystemOpen(!isEcosystemOpen)}
                                            className="flex items-center gap-1 px-4 py-2 text-slate-900 hover:text-primary font-medium transition-colors rounded-lg hover:bg-slate-50"
                                        >
                                            {item.label}
                                            <ChevronDown className="w-4 h-4" />
                                        </button>
                                        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-xl border border-slate-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                                            <div className="py-2">
                                                {item.dropdown.map((subItem, subIndex) => (
                                                    <Link
                                                        key={subIndex}
                                                        href={subItem.href}
                                                        className={`block px-4 py-2.5 text-sm font-medium transition-colors ${isActive(subItem.href)
                                                            ? "text-primary bg-primary/10"
                                                            : "text-slate-900 hover:text-primary hover:bg-slate-50"
                                                            }`}
                                                    >
                                                        {subItem.label}
                                                    </Link>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <Link
                                        href={item.href}
                                        className={`px-4 py-2 font-medium rounded-lg transition-colors ${isActive(item.href)
                                            ? "text-primary bg-primary/10"
                                            : "text-slate-900 hover:text-primary hover:bg-slate-50"
                                            }`}
                                    >
                                        {item.label}
                                    </Link>
                                )}
                            </div>
                        ))}

                        {/* Auth Buttons (Desktop) */}
                        <div className="ml-4 flex items-center gap-3 pl-4 border-l border-slate-200">
                            {session?.user ? (
                                <>
                                    <Link
                                        href="/dashboard"
                                        className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all shadow-md hover:shadow-lg hover:scale-105"
                                    >
                                        <LayoutDashboard className="w-4 h-4" />
                                        Dashboard
                                    </Link>
                                    <button
                                        onClick={handleLogout}
                                        className="flex items-center gap-2 px-5 py-2.5 text-slate-700 hover:text-red-600 font-bold transition-colors"
                                    >
                                        <LogOut className="w-4 h-4" />
                                        Logout
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Link
                                        href="/auth/login"
                                        className="px-5 py-2.5 font-bold text-slate-700 hover:text-primary transition-colors"
                                    >
                                        Log In
                                    </Link>
                                    <Link
                                        href="/auth/register"
                                        className="px-5 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all shadow-md hover:shadow-lg hover:scale-105"
                                    >
                                        Get Started
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="lg:hidden p-2 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                        {isMobileMenuOpen ? (
                            <X className="w-6 h-6 text-slate-900" />
                        ) : (
                            <Menu className="w-6 h-6 text-slate-900" />
                        )}
                    </button>
                </div>

                {/* Mobile Navigation */}
                {isMobileMenuOpen && (
                    <div className="lg:hidden py-4 border-t border-slate-200">
                        {navItems.map((item, index) => (
                            <div key={index}>
                                {item.dropdown ? (
                                    <>
                                        <button
                                            onClick={() => setIsEcosystemOpen(!isEcosystemOpen)}
                                            className="flex items-center justify-between w-full px-4 py-3 text-left font-medium text-slate-900 hover:bg-slate-50 rounded-lg"
                                        >
                                            {item.label}
                                            <ChevronDown
                                                className={`w-4 h-4 transition-transform ${isEcosystemOpen ? "rotate-180" : ""
                                                    }`}
                                            />
                                        </button>
                                        {isEcosystemOpen && (
                                            <div className="ml-4 mt-1 space-y-1">
                                                {item.dropdown.map((subItem, subIndex) => (
                                                    <Link
                                                        key={subIndex}
                                                        href={subItem.href}
                                                        onClick={() => setIsMobileMenuOpen(false)}
                                                        className={`block px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${isActive(subItem.href)
                                                            ? "text-primary bg-primary/10"
                                                            : "text-slate-600 hover:text-primary hover:bg-slate-50"
                                                            }`}
                                                    >
                                                        {subItem.label}
                                                    </Link>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <Link
                                        href={item.href}
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className={`block px-4 py-3 font-medium rounded-lg transition-colors ${isActive(item.href)
                                            ? "text-primary bg-primary/10"
                                            : "text-slate-900 hover:bg-slate-50"
                                            }`}
                                    >
                                        {item.label}
                                    </Link>
                                )}
                            </div>
                        ))}

                        {/* Auth Buttons (Mobile) */}
                        <div className="mt-6 px-4 space-y-3 pt-6 border-t border-slate-200">
                            {session?.user ? (
                                <>
                                    <Link
                                        href="/dashboard"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className="flex items-center justify-center gap-2 w-full px-5 py-3 bg-primary text-white font-bold rounded-xl"
                                    >
                                        <LayoutDashboard className="w-5 h-5" />
                                        Go to Dashboard
                                    </Link>
                                    <button
                                        onClick={() => {
                                            setIsMobileMenuOpen(false);
                                            handleLogout();
                                        }}
                                        className="flex items-center justify-center gap-2 w-full px-5 py-3 text-red-600 border border-red-200 font-bold rounded-xl hover:bg-red-50"
                                    >
                                        <LogOut className="w-5 h-5" />
                                        Logout
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Link
                                        href="/auth/login"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className="block w-full text-center px-5 py-3 font-bold text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50"
                                    >
                                        Log In
                                    </Link>
                                    <Link
                                        href="/auth/register"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className="block w-full text-center px-5 py-3 bg-primary text-white font-bold rounded-xl"
                                    >
                                        Get Started
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </nav>
    );
}
