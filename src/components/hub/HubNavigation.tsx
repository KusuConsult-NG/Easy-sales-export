"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X } from "lucide-react";

export default function HubNavigation() {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isEcosystemOpen, setIsEcosystemOpen] = useState(false);
    const pathname = usePathname();

    const navItems = [
        { label: "Home", href: "/" },
        { label: "About Easy Sales Export", href: "/about" },
        {
            label: "Ecosystem",
            href: "#",
            dropdown: [
                { label: "Marketplace", href: "/marketplace" },
                { label: "Farm Nation", href: "/farm-nation" },
                { label: "Academy", href: "/academy" },
                { label: "Cooperative", href: "/cooperatives" },
                { label: "Export Window", href: "/export" },
            ],
        },
        { label: "WAVE Program", href: "/wave/landing" },
        { label: "Export", href: "/export" },
        { label: "Contact", href: "/contact" },
    ];

    const isActive = (href: string) => {
        if (href === "/") return pathname === "/";
        return pathname?.startsWith(href);
    };

    return (
        <nav className="sticky top-0 z-50 bg-white dark:bg-slate-900 shadow-md">
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
                                            className="flex items-center gap-1 px-4 py-2 text-slate-900 dark:text-white hover:text-primary dark:hover:text-primary font-medium transition-colors rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                                        >
                                            {item.label}
                                            <ChevronDown className="w-4 h-4" />
                                        </button>
                                        {/* Dropdown Menu */}
                                        <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                                            <div className="py-2">
                                                {item.dropdown.map((subItem, subIndex) => (
                                                    <Link
                                                        key={subIndex}
                                                        href={subItem.href}
                                                        className={`block px-4 py-2.5 text-sm font-medium transition-colors ${isActive(subItem.href)
                                                                ? "text-primary bg-primary/10"
                                                                : "text-slate-900 dark:text-white hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-700"
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
                                                : "text-slate-900 dark:text-white hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800"
                                            }`}
                                    >
                                        {item.label}
                                    </Link>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        {isMobileMenuOpen ? (
                            <X className="w-6 h-6 text-slate-900 dark:text-white" />
                        ) : (
                            <Menu className="w-6 h-6 text-slate-900 dark:text-white" />
                        )}
                    </button>
                </div>

                {/* Mobile Navigation */}
                {isMobileMenuOpen && (
                    <div className="lg:hidden py-4 border-t border-slate-200 dark:border-slate-700">
                        {navItems.map((item, index) => (
                            <div key={index}>
                                {item.dropdown ? (
                                    <>
                                        <button
                                            onClick={() => setIsEcosystemOpen(!isEcosystemOpen)}
                                            className="flex items-center justify-between w-full px-4 py-3 text-left font-medium text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
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
                                                                : "text-slate-600 dark:text-slate-400 hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800"
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
                                                : "text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800"
                                            }`}
                                    >
                                        {item.label}
                                    </Link>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </nav>
    );
}
