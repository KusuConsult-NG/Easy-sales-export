"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Truck,
    Store,
    Users,
    Waves,
    Sprout,
    GraduationCap,
    Moon,
    Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPANY_INFO } from "@/lib/constants";
import { useState } from "react";

const navigationItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Export Windows", href: "/export", icon: Truck },
    { name: "Marketplace", href: "/marketplace", icon: Store },
    { name: "Cooperatives", href: "/cooperatives", icon: Users },
    { name: "WAVE Program", href: "/wave", icon: Waves },
    { name: "Farm Nation", href: "/farm-nation", icon: Sprout },
    { name: "Academy", href: "/academy", icon: GraduationCap },
];

export function Sidebar() {
    const pathname = usePathname();
    const [darkMode, setDarkMode] = useState(false);

    const toggleDarkMode = () => {
        setDarkMode(!darkMode);
        document.documentElement.classList.toggle("dark");
    };

    return (
        <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0">
            {/* Logo Section */}
            <Link
                href="/"
                className="p-6 flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer"
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
                        {COMPANY_INFO.tagline}
                    </p>
                </div>
            </Link>

            {/* Navigation */}
            <nav className="flex-1 px-4 space-y-1 mt-4 overflow-y-auto">
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
            <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                <button
                    onClick={toggleDarkMode}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                    {darkMode ? (
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
