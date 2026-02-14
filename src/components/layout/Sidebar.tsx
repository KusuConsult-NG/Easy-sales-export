"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
    LayoutDashboard,
    Truck,
    Store,
    Users,
    MapPin,
    FileText,
    GraduationCap,
    Settings,
    LogOut,
    BookText,
    Moon,
    Sun,
    Waves,
    Sprout,
    Lock,
    User,
    MessageSquare,
    CheckCircle,
    BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPANY_INFO } from "@/lib/constants";
import { getModuleConfig } from "@/lib/module-config";
import NotificationCenter from "./NotificationCenter";
import { useTheme } from "@/contexts/ThemeContext";
import { logoutAction } from "@/app/actions/auth";
import { hasAppAccess, type AppIdentifier } from "@/lib/role-app-mapping";
import type { UserRole } from "@/lib/types/roles";

const navigationItems: Array<{ name: string; href: string; icon: any; app: AppIdentifier; requiredRole?: UserRole }> = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, app: "dashboard" },
    // Admin Only
    { name: "Manage Exports", href: "/admin/export", icon: FileText, app: "export", requiredRole: "admin" },
    { name: "Marketplace", href: "/marketplace", icon: Store, app: "marketplace" },
    { name: "Cooperatives", href: "/cooperatives", icon: Users, app: "cooperatives" },
    { name: "Farm Nation", href: "/farm-nation", icon: Sprout, app: "farm-nation" },
    { name: "Academy", href: "/academy", icon: GraduationCap, app: "academy" },
    { name: "Escrow", href: "/escrow", icon: Lock, app: "escrow" },
    { name: "Messages", href: "/messages", icon: MessageSquare, app: "messages" },
    { name: "Profile", href: "/profile", icon: User, app: "profile" },
];

export function Sidebar() {
    const pathname = usePathname();
    const { theme, toggleTheme } = useTheme();
    const { data: session } = useSession();

    // Get active module configuration
    const activeModule = getModuleConfig(pathname);
    const ModuleIcon = activeModule.icon || LayoutDashboard;

    // Helper to check if a path is active
    const isPathActive = (path: string) => pathname === path || pathname?.startsWith(path + "/");

    // Filter navigation based on user's role
    const userRoles = (session?.user?.roles as UserRole[]) || [];
    const visibleItems = navigationItems.filter(item => {
        if (!hasAppAccess(userRoles, item.app)) return false;
        // Strict role check if defined
        if (item.requiredRole && !userRoles.includes(item.requiredRole) && !userRoles.includes("super_admin")) {
            return false;
        }
        return true;
    });

    // Dynamic Theme Classes
    const getThemeClasses = (isActive: boolean) => {
        // Base classes
        const base = "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all";

        if (!isActive) {
            return cn(base, "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800");
        }

        // Active state based on module theme
        switch (activeModule.theme) {
            case "emerald": // WAVE
                return cn(base, "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20");
            case "blue": // Cooperatives
                return cn(base, "text-blue-700 bg-blue-50 dark:bg-blue-900/20");
            case "teal": // Farm Nation
                return cn(base, "text-teal-700 bg-teal-50 dark:bg-teal-900/20");
            case "amber": // Academy
                return cn(base, "text-amber-700 bg-amber-50 dark:bg-amber-900/20");
            case "indigo": // Marketplace
                return cn(base, "text-indigo-700 bg-indigo-50 dark:bg-indigo-900/20");
            case "sky": // Export
                return cn(base, "text-sky-700 bg-sky-50 dark:bg-sky-900/20");
            case "rose": // Escrow
                return cn(base, "text-rose-700 bg-rose-50 dark:bg-rose-900/20");
            default: // Default Primary
                return cn(base, "text-primary bg-primary/5 dark:bg-primary/10");
        }
    };

    const getSidebarBorderClass = () => {
        switch (activeModule.theme) {
            case "emerald": return "bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/30";
            case "blue": return "bg-blue-50/30 dark:bg-blue-950/10 border-blue-100 dark:border-blue-900/30";
            case "teal": return "bg-teal-50/30 dark:bg-teal-950/10 border-teal-100 dark:border-teal-900/30";
            case "amber": return "bg-amber-50/30 dark:bg-amber-950/10 border-amber-100 dark:border-amber-900/30";
            case "indigo": return "bg-indigo-50/30 dark:bg-indigo-950/10 border-indigo-100 dark:border-indigo-900/30";
            case "rose": return "bg-rose-50/30 dark:bg-rose-950/10 border-rose-100 dark:border-rose-900/30";
            default: return "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800";
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
            default: return "text-primary";
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
            default: return "text-slate-500";
        }
    };

    return (
        <aside className={cn(
            "w-64 border-r flex flex-col shrink-0 transition-colors duration-300",
            getSidebarBorderClass()
        )}>
            {/* Logo Section with Notification */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                    <Link
                        href={activeModule.pathPrefix || "/dashboard"}
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer group"
                    >
                        {/* Dynamic Logo/Icon Container */}
                        <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center border shadow-sm transition-colors",
                            activeModule.pathPrefix ? "bg-white/50 dark:bg-white/5" : "bg-white",
                            getHeaderTextClass().replace("text-", "border-").replace("dark:", "dark:border-").replace("700", "200").replace("400", "800") // Subtle border matching theme
                        )}>
                            {activeModule.pathPrefix && activeModule.pathPrefix !== "/dashboard" ? (
                                <ModuleIcon className={cn("w-6 h-6", getHeaderTextClass())} />
                            ) : (
                                <Image
                                    src="/images/logo.jpg"
                                    alt={COMPANY_INFO.name}
                                    width={40}
                                    height={40}
                                    className="w-full h-full rounded-full object-cover"
                                />
                            )}
                        </div>

                        <div>
                            <h1 className={cn(
                                "font-bold text-sm leading-tight uppercase tracking-wider transition-colors",
                                getHeaderTextClass()
                            )}>
                                {activeModule.name}
                            </h1>
                            <p className={cn(
                                "text-[10px] font-semibold tracking-widest uppercase transition-colors",
                                getSubTextClass()
                            )}>
                                {activeModule.description}
                            </p>
                        </div>
                    </Link>
                    <NotificationCenter />
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 space-y-1 py-4 overflow-y-auto">
                {visibleItems.map((item) => {
                    const isActive = pathname === item.href; // Strict match for now, or use isPathActive for sub-routes
                    const Icon = item.icon;

                    // Handle active state more consistently for sub-routes
                    const isItemActive = isPathActive(item.href) && (item.href !== "/dashboard" || pathname === "/dashboard");

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={getThemeClasses(isItemActive)}
                        >
                            <Icon className={cn("w-5 h-5", isItemActive && getHeaderTextClass())} />
                            <span>{item.name}</span>
                        </Link>
                    );
                })}

                {/* Admin-Only Links */}
                {(userRoles.includes("admin") || userRoles.includes("super_admin")) && (
                    <>
                        <div className="my-4 border-t border-slate-200 dark:border-slate-800" />
                        <h3 className="px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                            Administration
                        </h3>

                        {/* Academy Management */}
                        <Link
                            href="/admin/academy"
                            className={`flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all duration-200 group ${isPathActive("/admin/academy")
                                ? "bg-primary text-white shadow-lg shadow-primary/30"
                                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-primary dark:hover:text-white"
                                }`}
                        >
                            <BookOpen className={`w-5 h-5 transition-transform group-hover:scale-110 ${isPathActive("/admin/academy") ? "text-white" : "text-slate-400 group-hover:text-primary"}`} />
                            <span className="font-medium">Academy Admin</span>
                        </Link>

                        {/* Content Approval */}
                        <Link
                            href="/admin/content-approval"
                            className={`flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all duration-200 group ${isPathActive("/admin/content-approval")
                                ? "bg-primary text-white shadow-lg shadow-primary/30"
                                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-primary dark:hover:text-white"
                                }`}
                        >
                            <CheckCircle className={`w-5 h-5 transition-transform group-hover:scale-110 ${isPathActive("/admin/content-approval") ? "text-white" : "text-slate-400 group-hover:text-primary"}`} />
                            <span className="font-medium">Approvals</span>
                        </Link>
                    </>
                )}
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
