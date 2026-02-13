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

    return (
        <aside className={cn(
            "w-64 border-r flex flex-col shrink-0 transition-colors duration-300",
            pathname?.startsWith("/wave")
                ? "bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/50"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
        )}>
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
                            <h1 className={cn(
                                "font-bold text-sm leading-tight uppercase tracking-wider",
                                pathname?.startsWith("/wave") ? "text-emerald-700 dark:text-emerald-400" : "text-primary"
                            )}>
                                {pathname?.startsWith("/wave") ? "WAVE Program" : `${COMPANY_INFO.name.split(" ")[0]} ${COMPANY_INFO.name.split(" ")[1]}`}
                            </h1>
                            <p className={cn(
                                "text-[10px] font-semibold tracking-widest uppercase",
                                pathname?.startsWith("/wave") ? "text-emerald-600/70 dark:text-emerald-500/70" : "text-slate-500"
                            )}>
                                {pathname?.startsWith("/wave") ? "Women's Agribusiness" : "Export & Agri"}
                            </p>
                        </div>
                    </Link>
                    <NotificationCenter />
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 space-y-1 py-4 overflow-y-auto">
                {visibleItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    const isWave = pathname?.startsWith("/wave");

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all",
                                isActive
                                    ? isWave
                                        ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20"
                                        : "text-primary bg-primary/5 dark:bg-primary/10"
                                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                            )}
                        >
                            <Icon className={cn("w-5 h-5", isActive && isWave && "text-emerald-600")} />
                            <span>{item.name}</span>
                        </Link>
                    );
                })}

                {/* Admin-Only Links */}
                {(userRoles.includes("admin") || userRoles.includes("super_admin")) && (
                    <>
                        {/* Academy Management */}
                        <Link
                            href="/admin/academy"
                            className={`flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all duration-200 group ${isPathActive("/admin/academy")
                                ? "bg-primary text-white shadow-lg shadow-primary/30"
                                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-primary dark:hover:text-white"
                                }`}
                        >
                            <BookOpen className={`w-5 h-5 transition-transform group-hover:scale-110 ${isPathActive("/admin/academy") ? "text-white" : "text-slate-400 group-hover:text-primary"}`} />
                            <span className="font-medium">Academy</span>
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
