/**
 * Marketplace Sidebar Navigation
 * 
 * Custom sidebar for Marketplace module with Violet/Purple theme
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Package,
    ShoppingCart,
    BarChart,
    Settings,
    Store,
    Menu,
    X,
    LogOut
} from "lucide-react";
import { useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import Image from "next/image";
import { COMPANY_INFO } from "@/lib/constants";

const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/marketplace/seller/dashboard" },
    { icon: Package, label: "My Products", href: "/marketplace/seller/products" },
    { icon: ShoppingCart, label: "Orders", href: "/marketplace/seller/orders" },
    { icon: BarChart, label: "Analytics", href: "/marketplace/seller/analytics" },
    // { icon: Settings, label: "Store Settings", href: "/marketplace/seller/settings" },
];

export default function MarketplaceSidebar() {
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

    return (
        <>
            {/* Mobile Menu Button */}
            <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-violet-900 text-white rounded-lg shadow-lg border border-violet-700"
            >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Sidebar */}
            <aside
                className={`fixed top-0 left-0 h-full w-64 bg-violet-900 border-r border-violet-800 transition-transform z-40 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
                    }`}
            >
                {/* Header */}
                <div className="p-6 border-b border-violet-800">
                    {/* Company Brand */}
                    <div className="flex items-center gap-2 mb-6 opacity-80">
                        <Image
                            src="/images/logo.jpg"
                            alt={COMPANY_INFO.name}
                            width={24}
                            height={24}
                            className="rounded-full"
                        />
                        <span className="text-xs font-bold text-violet-100 tracking-widest uppercase">
                            {COMPANY_INFO.name}
                        </span>
                    </div>

                    <Link href="/marketplace" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/20 group-hover:bg-white/20 transition-colors">
                            <Store className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="font-bold text-white text-lg">Marketplace</h2>
                            <p className="text-xs text-violet-200">Seller Portal</p>
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
                                    ? "bg-white text-violet-900 shadow-lg"
                                    : "text-violet-100 hover:bg-violet-800"
                                    }`}
                            >
                                <Icon className="w-5 h-5" />
                                <span className="font-medium">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* Footer */}
                <div className="p-4 border-t border-violet-800 bg-violet-950/30">
                    <form action={logoutAction}>
                        <button
                            type="submit"
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-violet-200 hover:bg-violet-800 hover:text-white transition-colors"
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
