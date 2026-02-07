"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Truck,
    Store,
    Users,
    MapPin,
    GraduationCap,
    Settings,
    LogOut,
    BookText,
    Moon,
    Sun,
    Waves,
    Sprout,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPANY_INFO } from "@/lib/constants";
import NotificationCenter from "./NotificationCenter";
import { useTheme } from "@/contexts/ThemeContext";
import { logoutAction } from "@/app/actions/auth";

const navigationItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Export Windows", href: "/export", icon: Truck },
    { name: "Marketplace", href: "/marketplace", icon: Store },
    { name: "Cooperatives", href: "/cooperatives", icon: Users },
    { name: "WAVE Program", href: "/wave", icon: Waves },
    { name: "Farm Nation", href: "/farm-nation", icon: Sprout },
    { name: "Academy", href: "/academy", icon: GraduationCap },
];

export function Sidebar() {
    const pathname = usePathname();
    const { theme, toggleTheme } = useTheme();

    return (
        <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0">
            {/* Logo Section with Notification */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                    <Link
                        href="/dashboard"
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer"
                    >
                        <Image
                            src="/images/logo.jpg"
                            alt={COMPANY_INFO.name}
                            width={40}
                            height={40}
                            className="w-10 h-10 rounded-full border border-slate-200 shadow-sm"
                        />
                        <div>
                            <h1 className="text-primary font-bold text-sm leading-tight uppercase tracking-wider">
                                {COMPANY_INFO.name.split(" ")[0]} {COMPANY_INFO.name.split(" ")[1]}
                            </h1>
                            <p className="text-[10px] text-slate-500 font-semibold tracking-widest uppercase">
                                Export & Agri
                            </p>
                        </div>
                    </Link>
                    <NotificationCenter />
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 space-y-1 py-4 overflow-y-auto">
                {navigationItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all",
                                isActive
                                    ? "text-primary bg-primary/5 dark:bg-primary/10"
                                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                            )}
                        >
                            <Icon className="w-5 h-5" />
                            <span>{item.name}</span>
                        </Link>
                    );
                })}
            </nav>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                {/* Logout Button */}
                <form action={logoutAction}>
                    <button
                        type="submit"
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                        <LogOut className="w-5 h-5" />
                        <span className="font-medium">Logout</span>
                    </button>
                </form>

                {/* Theme Toggle */}
                <button
                    onClick={toggleTheme}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    aria-label="Toggle dark mode"
                >
                    {theme === "dark" ? (
                        <>
                            <Sun className="w-5 h-5" />
                            <span>Light Mode</span>
                        </>
                    ) : (
                        <>
                            <Moon className="w-5 h-5" />
                            <span>Dark Mode</span>
                        </>
                    )}
                </button>
            </div>
        </aside>
    );
}
