"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
    LayoutDashboard,
    Users,
    Waves,
    Building2,
    ShoppingBag,
    Container,
    Tractor,
    Wallet,
    Settings,
    Menu,
    X,
    LogOut,
    GraduationCap
} from "lucide-react";
import { useState } from "react";


const NAV_ITEMS = [
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
    { label: "User Management", href: "/admin/users", icon: Users },
    { label: "WAVE Program", href: "/admin/wave", icon: Waves },
    { label: "Cooperatives", href: "/admin/cooperatives", icon: Building2 },
    { label: "Marketplace", href: "/admin/marketplace", icon: ShoppingBag },
    { label: "Export Windows", href: "/admin/export", icon: Container },
    { label: "Farm Nation", href: "/admin/farm-nation", icon: Tractor },
    { label: "Academy", href: "/admin/academy", icon: GraduationCap },
    { label: "Finance", href: "/admin/finance", icon: Wallet },
    { label: "Settings", href: "/admin/settings", icon: Settings },
];

export default function AdminSidebar() {
    const pathname = usePathname();
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    return (
        <>
            {/* Mobile Toggle */}
            <button
                onClick={() => setIsMobileOpen(!isMobileOpen)}
                className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-slate-900 text-white rounded-lg"
            >
                {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            {/* Sidebar Container */}
            <aside className={`
                fixed top-0 left-0 z-40 h-screen w-64 
                bg-slate-900 text-slate-300 transition-transform duration-300
                ${isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
            `}>
                <div className="flex flex-col h-full">
                    {/* Brand */}
                    <div className="p-6 border-b border-slate-800">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                                <span className="font-bold text-white">E</span>
                            </div>
                            <span className="text-lg font-bold text-white">Admin Portal</span>
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
                        {NAV_ITEMS.map((item) => {
                            const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                            const Icon = item.icon;

                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setIsMobileOpen(false)}
                                    className={`
                                        flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                                        ${isActive
                                            ? "bg-blue-600/10 text-blue-400 font-medium border border-blue-600/20"
                                            : "hover:bg-slate-800 hover:text-white"
                                        }
                                    `}
                                >
                                    <Icon size={20} className={isActive ? "text-blue-400" : "text-slate-500"} />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    {/* Footer / User */}
                    <div className="p-4 border-t border-slate-800">
                        <div className="bg-slate-800/50 rounded-xl p-4 mb-4">
                            <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Signed in as</p>
                            <p className="text-sm font-medium text-white truncate">Administrator</p>
                        </div>
                        <button
                            onClick={async () => {
                                // Client-side cleanup for Firebase Auth
                                try {
                                    const { signOut } = await import("firebase/auth");
                                    const { auth } = await import("@/lib/firebase");
                                    await signOut(auth);
                                } catch (e) {
                                    console.error("Firebase signout failed", e);
                                }
                                // Server-side cleanup via Server Action
                                const { logoutAction } = await import("@/app/actions/auth");
                                await logoutAction();
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-slate-800 hover:text-red-300 rounded-xl transition-colors"
                        >
                            <LogOut size={20} />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </div>
            </aside>

            {/* Overlay */}
            {isMobileOpen && (
                <div
                    onClick={() => setIsMobileOpen(false)}
                    className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
                />
            )}
        </>
    );
}
