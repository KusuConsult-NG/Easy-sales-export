"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    LayoutDashboard,
    LogOut,
    Moon,
    Sun,
    MessageSquare,
    User,
    ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPANY_INFO } from "@/lib/constants";
import { getModuleConfig } from "@/lib/module-config";
import NotificationCenter from "./NotificationCenter";
import { useTheme } from "@/contexts/ThemeContext";
import { logoutAction } from "@/app/actions/auth";
import { hasAppAccess, type AppIdentifier } from "@/lib/role-app-mapping";
import type { UserRole } from "@/lib/types/roles";
import { GLOBAL_NAV_ITEMS, MODULE_NAVIGATION, type NavigationItem } from "@/lib/sidebar-config";

export function Sidebar() {
    const pathname = usePathname();
    const { theme, toggleTheme } = useTheme();
    const { data: session } = useSession();

    // Get active module configuration
    const activeModule = getModuleConfig(pathname);
    const ModuleIcon = activeModule.icon || LayoutDashboard;

    // Helper to check if a path is active
    const isPathActive = (path: string, exact = false) => {
        if (exact) return pathname === path;
        return pathname === path || pathname?.startsWith(path + "/");
    };

    // Determine current module key for navigation
    // This mapping connects URL paths to sidebar-config keys
    const getModuleKey = (path: string): string => {
        if (path.startsWith("/export")) return "export";
        if (path.startsWith("/marketplace")) return "marketplace";
        if (path.startsWith("/cooperatives")) return "cooperatives";
        if (path.startsWith("/farm-nation")) return "farm-nation";
        if (path.startsWith("/wave")) return "wave";
        if (path.startsWith("/academy")) return "academy";
        if (path.startsWith("/admin")) return "admin";
        return "dashboard"; // Default/Hub
    };

    const currentModuleKey = getModuleKey(pathname || "");
    const moduleNavItems = MODULE_NAVIGATION[currentModuleKey] || MODULE_NAVIGATION["dashboard"];

    // Filter navigation based on user's role
    const userRoles = (session?.user?.roles as UserRole[]) || [];

    const filterNavItems = (items: NavigationItem[]) => {
        return items.filter(item => {
            // Check App Access if item specifies an app
            if (item.app && !hasAppAccess(userRoles, item.app)) return false;

            // Strict role check if defined
            if (item.requiredRole && !userRoles.includes(item.requiredRole) && !userRoles.includes("super_admin")) {
                return false;
            }
            return true;
        });
    };

    const visibleModuleItems = filterNavItems(moduleNavItems);
    const visibleGlobalItems = filterNavItems(GLOBAL_NAV_ITEMS);

    // Dynamic Theme Classes
    const getThemeClasses = (isActive: boolean) => {
        // Base classes
        const base = "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group relative";

        if (!isActive) {
            return cn(base, "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200");
        }

        // Active state based on module theme
        switch (activeModule.theme) {
            case "emerald": // WAVE
                return cn(base, "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 shadow-sm ring-1 ring-emerald-100 dark:ring-emerald-900/30");
            case "blue": // Cooperatives
                return cn(base, "text-blue-700 bg-blue-50 dark:bg-blue-900/20 shadow-sm ring-1 ring-blue-100 dark:ring-blue-900/30");
            case "teal": // Farm Nation
                return cn(base, "text-teal-700 bg-teal-50 dark:bg-teal-900/20 shadow-sm ring-1 ring-teal-100 dark:ring-teal-900/30");
            case "amber": // Academy
                return cn(base, "text-amber-700 bg-amber-50 dark:bg-amber-900/20 shadow-sm ring-1 ring-amber-100 dark:ring-amber-900/30");
            case "indigo": // Marketplace
                return cn(base, "text-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 shadow-sm ring-1 ring-indigo-100 dark:ring-indigo-900/30");
            case "sky": // Export
                return cn(base, "text-sky-700 bg-sky-50 dark:bg-sky-900/20 shadow-sm ring-1 ring-sky-100 dark:ring-sky-900/30");
            case "rose": // Escrow
                return cn(base, "text-rose-700 bg-rose-50 dark:bg-rose-900/20 shadow-sm ring-1 ring-rose-100 dark:ring-rose-900/30");
            default: // Default Primary
                return cn(base, "text-primary bg-primary/5 dark:bg-primary/10 shadow-sm ring-1 ring-primary/10");
        }
    };

    const getSidebarBorderClass = () => {
        switch (activeModule.theme) {
            case "emerald": return "bg-emerald-50/10 dark:bg-emerald-950/5 border-emerald-100 dark:border-emerald-900/20";
            case "blue": return "bg-blue-50/10 dark:bg-blue-950/5 border-blue-100 dark:border-blue-900/20";
            case "teal": return "bg-teal-50/10 dark:bg-teal-950/5 border-teal-100 dark:border-teal-900/20";
            case "amber": return "bg-amber-50/10 dark:bg-amber-950/5 border-amber-100 dark:border-amber-900/20";
            case "indigo": return "bg-indigo-50/10 dark:bg-indigo-950/5 border-indigo-100 dark:border-indigo-900/20";
            case "rose": return "bg-rose-50/10 dark:bg-rose-950/5 border-rose-100 dark:border-rose-900/20";
            default: return "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800";
        }
    };

    const getHeaderTextClass = () => {
        switch (activeModule.theme) {
            case "emerald": return "text-emerald-700 dark:text-emerald-400";
            case "blue": return "text-blue-700 dark:text-blue-400";
            case "teal": return "text-teal-700 dark:text-teal-400";
            case "amber": return "text-amber-700 dark:text-amber-400";
            case "indigo": return "text-indigo-700 dark:text-indigo-400";
            case "rose": return "text-rose-700 dark:text-rose-400";
            default: return "text-slate-900 dark:text-white";
        }
    };

    const getSubTextClass = () => {
        switch (activeModule.theme) {
            case "emerald": return "text-emerald-600/70 dark:text-emerald-500/70";
            case "blue": return "text-blue-600/70 dark:text-blue-500/70";
            case "teal": return "text-teal-600/70 dark:text-teal-500/70";
            case "amber": return "text-amber-600/70 dark:text-amber-500/70";
            case "indigo": return "text-indigo-600/70 dark:text-indigo-500/70";
            case "rose": return "text-rose-600/70 dark:text-rose-500/70";
            default: return "text-slate-500 dark:text-slate-400";
        }
    };

    return (
        <aside className={cn(
            "w-72 border-r flex flex-col shrink-0 transition-all duration-300 h-screen sticky top-0",
            getSidebarBorderClass()
        )}>
            {/* Logo Section with Notification */}
            <div className="p-6 border-b border-dashed border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-6">
                    <Link
                        href={activeModule.pathPrefix || "/dashboard"}
                        className="flex items-center gap-3.5 hover:opacity-80 transition-opacity cursor-pointer group"
                    >
                        {/* Dynamic Logo/Icon Container */}
                        <div className={cn(
                            "w-11 h-11 rounded-xl flex items-center justify-center border shadow-sm transition-all group-hover:scale-105 group-hover:shadow-md",
                            activeModule.pathPrefix ? "bg-white dark:bg-slate-900" : "bg-white dark:bg-slate-900",
                            getHeaderTextClass().replace("text-", "border-").replace("dark:", "dark:border-").replace("700", "200").replace("400", "800")
                        )}>
                            {activeModule.pathPrefix && activeModule.pathPrefix !== "/dashboard" ? (
                                <ModuleIcon className={cn("w-6 h-6", getHeaderTextClass())} />
                            ) : (
                                <Image
                                    src="/images/logo.jpg"
                                    alt={COMPANY_INFO.name}
                                    width={44}
                                    height={44}
                                    className="w-full h-full rounded-xl object-cover"
                                />
                            )}
                        </div>

                        <div className="flex flex-col">
                            <h1 className={cn(
                                "font-bold text-sm leading-tight tracking-wide transition-colors",
                                getHeaderTextClass()
                            )}>
                                {activeModule.name || "Easy Sales Export"}
                            </h1>
                            <p className={cn(
                                "text-[10px] font-semibold tracking-widest uppercase transition-colors mt-0.5",
                                getSubTextClass()
                            )}>
                                {activeModule.description || "Hub"}
                            </p>
                        </div>
                    </Link>
                    <NotificationCenter />
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 space-y-8 py-6 overflow-y-auto no-scrollbar">

                {/* Module Specific Links */}
                <div className="space-y-1.5">
                    <h3 className="px-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
                        {currentModuleKey === "dashboard" ? "Main Menu" : `${activeModule.name} Menu`}
                    </h3>
                    {visibleModuleItems.map((item) => {
                        const active = isPathActive(item.href, item.exact);
                        const Icon = item.icon;

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={getThemeClasses(active)}
                            >
                                <Icon className={cn("w-5 h-5", active ? getHeaderTextClass() : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300")} />
                                <span>{item.name}</span>
                                {active && (
                                    <div className={cn("absolute right-3 w-1.5 h-1.5 rounded-full", getHeaderTextClass().replace("text-", "bg-"))} />
                                )}
                            </Link>
                        );
                    })}
                </div>

                {/* Global Links (Messages, Profile) */}
                <div className="space-y-1.5">
                    <h3 className="px-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
                        Account
                    </h3>
                    {visibleGlobalItems.map((item) => {
                        const active = isPathActive(item.href, item.exact);
                        const Icon = item.icon;

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={getThemeClasses(active)}
                            >
                                <Icon className={cn("w-5 h-5", active ? getHeaderTextClass() : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300")} />
                                <span>{item.name}</span>
                            </Link>
                        );
                    })}
                </div>

                {/* Switch Module Access (Back to Hub) */}
                {currentModuleKey !== "dashboard" && (
                    <div className="pt-4 mt-4 border-t border-dashed border-slate-200 dark:border-slate-800">
                        <Link
                            href="/dashboard"
                            className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-all group"
                        >
                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-white dark:group-hover:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-700 text-slate-400 group-hover:text-primary transition-colors">
                                <LayoutDashboard className="w-4 h-4" />
                            </div>
                            <div className="flex-1">
                                <span className="text-xs font-medium block">Switch App</span>
                                <span className="text-[10px] text-slate-400 block group-hover:text-slate-500">Back to Hub</span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                    </div>
                )}
            </nav>

            {/* Footer Actions */}
            <div className="p-4 border-t border-dashed border-slate-200 dark:border-slate-800 space-y-2 bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-sm">
                {/* Theme Toggle */}
                <button
                    onClick={toggleTheme}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 shadow-sm hover:shadow transition-all group"
                    aria-label="Toggle dark mode"
                >
                    <div className="flex items-center gap-3">
                        {theme === "dark" ? <Moon className="w-5 h-5 text-indigo-400" /> : <Sun className="w-5 h-5 text-amber-500" />}
                        <span className="font-medium text-sm">{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
                    </div>
                    <div className={cn(
                        "w-8 h-4 rounded-full relative transition-colors",
                        theme === "dark" ? "bg-slate-700" : "bg-slate-200"
                    )}>
                        <div className={cn(
                            "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm",
                            theme === "dark" ? "left-4.5" : "left-0.5"
                        )} />
                    </div>
                </button>

                {/* Logout Button */}
                <button
                    onClick={async () => {
                        // Client-side cleanup for Firebase Auth
                        try {
                            const { signOut } = await import("firebase/auth");
                            // Direct import of the initialized auth instance
                            const { auth } = await import("@/lib/firebase");
                            await signOut(auth);
                        } catch (e) {
                            console.error("Firebase signout failed", e);
                        }
                        // Server-side cleanup via Server Action
                        await logoutAction();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 border border-transparent hover:border-red-100 dark:hover:border-red-900/30 transition-all font-medium text-sm text-left"
                >
                    <LogOut className="w-5 h-5" />
                    <span>Sign Out</span>
                </button>
            </div>
        </aside>
    );
}
