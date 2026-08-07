"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import {
    LayoutDashboard,
    LogOut,
    MessageSquare,
    User,
    ChevronRight,
    ChevronLeft,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { COMPANY_INFO } from "@/lib/constants";
import { getModuleConfig } from "@/lib/module-config";
import NotificationCenter from "./NotificationCenter";

import { signOut as nextAuthSignOut } from "next-auth/react";
import { hasAppAccess, type AppIdentifier } from "@/lib/role-app-mapping";
import type { UserRole } from "@/lib/types/roles";
import { GLOBAL_NAV_ITEMS, MODULE_NAVIGATION, type NavigationItem } from "@/lib/sidebar-config";
import { useFeatureToggles } from "@/hooks/useFeatureToggle";
import { getMyServiceRegistrations } from "@/app/actions/my-data";
import { COLLECTIONS } from "@/lib/types/firestore";

const ALL_SIDEBAR_TOGGLES = Array.from(new Set([
    ...Object.values(MODULE_NAVIGATION).flat().map(i => i.featureToggle),
    ...GLOBAL_NAV_ITEMS.map(i => i.featureToggle)
].filter(Boolean) as string[]));

const COLLAPSED_STORAGE_KEY = "sidebar_collapsed_v1";

interface SidebarProps {
    isMobileOpen?: boolean;
    onMobileClose?: () => void;
}

export function Sidebar({ isMobileOpen = false, onMobileClose }: SidebarProps) {
    const pathname = usePathname();
    const { data: session } = useSession();
    const userId = session?.user?.id;

    const featureToggles = useFeatureToggles(ALL_SIDEBAR_TOGGLES);

    // ── Collapse state (desktop only) — persisted ─────────────────────────
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [serviceRegs, setServiceRegs] = useState<any>({});

    // Polls a session-scoped server action rather than querying Supabase from
    // the browser. Same 8s cadence as the listener it replaces.
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;

        const load = async () => {
            try {
                const regs = await getMyServiceRegistrations();
                if (!cancelled) setServiceRegs(regs);
            } catch (error) {
                console.error("Sidebar service registrations failed:", error);
            }
        };

        load();
        const interval = setInterval(load, 8000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [userId]);

    useEffect(() => {
        setMounted(true);
        try {
            const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
            if (stored === "true") setIsCollapsed(true);
        } catch {
            // localStorage not available
        }
    }, []);

    const toggleCollapsed = useCallback(() => {
        setIsCollapsed(prev => {
            const next = !prev;
            try {
                localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
            } catch {
                // ignore
            }
            return next;
        });
    }, []);

    // Close mobile sidebar on route change
    useEffect(() => {
        if (isMobileOpen && onMobileClose) {
            onMobileClose();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    // Get active module configuration
    const activeModule = getModuleConfig(pathname);
    const ModuleIcon = activeModule.icon || LayoutDashboard;

    // Helper to check if a path is active
    const isPathActive = (path: string, exact = false) => {
        if (exact) return pathname === path;
        return pathname === path || pathname?.startsWith(path + "/");
    };

    // Determine current module key for navigation
    const getModuleKey = (path: string): string => {
        if (path.startsWith("/export")) return "export";
        if (path.startsWith("/marketplace")) return "marketplace";
        if (path.startsWith("/cooperatives")) return "cooperatives";
        if (path.startsWith("/farm-nation")) return "farm-nation";
        if (path.startsWith("/wave")) return "wave";
        if (path.startsWith("/academy")) return "academy";
        if (path.startsWith("/admin")) return "admin";
        return "dashboard";
    };

    const currentModuleKey = getModuleKey(pathname || "");

    // User roles — must be declared before the module guard below
    const userRoles = (session?.user?.roles as UserRole[]) || [];

    // ── Module enrollment guard ───────────────────────────────────────────────
    // We only show module-specific nav when the user is enrolled in that module.
    // Ensure both ROLE and SERVICE REGISTRATION status (approved or pending) are met.
    const moduleAppMap: Record<string, AppIdentifier | null> = {
        export: "export",
        marketplace: "marketplace",
        cooperatives: "cooperatives",
        "farm-nation": "farm-nation",
        wave: "wave",
        academy: "academy",
        admin: null, // Admin access handled separately
        dashboard: null, // Dashboard is universal
    };

    const moduleApp = moduleAppMap[currentModuleKey];
    const isAdmin = userRoles.includes("admin") || userRoles.includes("super_admin");

    // Check service registration status
    const isModuleApprovedOrPending = () => {
        if (!moduleApp) return true; // Universal (dashboard, admin)
        if (isAdmin) return true; // Admins see everything
        const status = serviceRegs?.[moduleApp]?.status;
        return status === 'approved' || status === 'pending';
    };

    const userHasModuleAccess =
        (moduleApp === null || hasAppAccess(userRoles, moduleApp as AppIdentifier)) &&
        isModuleApprovedOrPending();

    const resolvedModuleKey = userHasModuleAccess ? currentModuleKey : "dashboard";
    const moduleNavItems = MODULE_NAVIGATION[resolvedModuleKey] || MODULE_NAVIGATION["dashboard"];

    // Filter navigation based on user's role
    const filterNavItems = (items: NavigationItem[]) => {
        const isAdmin = userRoles.includes("admin") || userRoles.includes("super_admin");

        return items.filter(item => {
            // Check service registrations if an item specifies an app module and is not a universal app
            if (item.app && !["dashboard", "messages", "profile"].includes(item.app)) {
                // If it's the cooperative payment route, we don't need strict 'approved' guard since onboarding handles approval state
                const isApprovedOrPending = serviceRegs?.[item.app]?.status === 'approved' || serviceRegs?.[item.app]?.status === 'pending';
                if (!isAdmin && !isApprovedOrPending) {
                    return false;
                }
            }

            if (item.app && !hasAppAccess(userRoles, item.app as AppIdentifier)) return false;
            if (item.requiredRole && !userRoles.includes(item.requiredRole) && !isAdmin) {
                return false;
            }
            if (item.featureToggle && featureToggles[item.featureToggle] === false) {
                return false;
            }
            return true;
        });
    };

    const visibleModuleItems = filterNavItems(moduleNavItems);
    const visibleGlobalItems = filterNavItems(GLOBAL_NAV_ITEMS);

    // ── Theme helpers ──────────────────────────────────────────────────────
    const getThemeClasses = (isActive: boolean) => {
        const base = isCollapsed
            ? "flex items-center justify-center w-10 h-10 rounded-xl font-medium transition-all group relative mx-auto"
            : "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group relative";

        if (!isActive) {
            return cn(base, "text-slate-600 hover:bg-slate-50 hover:text-slate-900");
        }

        switch (activeModule.theme) {
            case "emerald": return cn(base, "text-emerald-700 bg-emerald-50 shadow-sm ring-1 ring-emerald-100");
            case "blue":    return cn(base, "text-blue-700 bg-blue-50 shadow-sm ring-1 ring-blue-100");
            case "teal":    return cn(base, "text-teal-700 bg-teal-50 shadow-sm ring-1 ring-teal-100");
            case "amber":   return cn(base, "text-amber-700 bg-amber-50 shadow-sm ring-1 ring-amber-100");
            case "indigo":  return cn(base, "text-indigo-700 bg-indigo-50 shadow-sm ring-1 ring-indigo-100");
            case "sky":     return cn(base, "text-sky-700 bg-sky-50 shadow-sm ring-1 ring-sky-100");
            case "rose":    return cn(base, "text-rose-700 bg-rose-50 shadow-sm ring-1 ring-rose-100");
            default:        return cn(base, "text-primary bg-primary/5 shadow-sm ring-1 ring-primary/10");
        }
    };

    const getSidebarBorderClass = () => {
        switch (activeModule.theme) {
            case "emerald": return "bg-emerald-50/10 border-emerald-100";
            case "blue":    return "bg-blue-50/10 border-blue-100";
            case "teal":    return "bg-teal-50/10 border-teal-100";
            case "amber":   return "bg-amber-50/10 border-amber-100";
            case "indigo":  return "bg-indigo-50/10 border-indigo-100";
            case "rose":    return "bg-rose-50/10 border-rose-100";
            default:        return "bg-white border-slate-200";
        }
    };

    const getHeaderTextClass = () => {
        switch (activeModule.theme) {
            case "emerald": return "text-emerald-700";
            case "blue":    return "text-blue-700";
            case "teal":    return "text-teal-700";
            case "amber":   return "text-amber-700";
            case "indigo":  return "text-indigo-700";
            case "rose":    return "text-rose-700";
            default:        return "text-slate-900";
        }
    };

    const getSubTextClass = () => {
        switch (activeModule.theme) {
            case "emerald": return "text-emerald-600/70";
            case "blue":    return "text-blue-600/70";
            case "teal":    return "text-teal-600/70";
            case "amber":   return "text-amber-600/70";
            case "indigo":  return "text-indigo-600/70";
            case "rose":    return "text-rose-600/70";
            default:        return "text-slate-500";
        }
    };

    // Don't render until client-mounted (to avoid hydration mismatch on collapsed state)
    if (!mounted) return null;

    // ── Sidebar inner content ──────────────────────────────────────────────
    const sidebarContent = (
        <aside className={cn(
            "border-r flex flex-col shrink-0 transition-all duration-300 h-screen",
            isCollapsed ? "w-16" : "w-72",
            getSidebarBorderClass()
        )}>
            {/* Logo + Notification + Collapse Toggle */}
            <div className={cn(
                "border-b border-dashed border-slate-200 relative",
                isCollapsed ? "p-3" : "p-6"
            )}>
                {!isCollapsed && (
                    <div className="flex items-center justify-between mb-6">
                        <Link
                            href={activeModule.pathPrefix || "/dashboard"}
                            className="flex items-center gap-3.5 hover:opacity-80 transition-opacity cursor-pointer group"
                        >
                            <div className={cn(
                                "w-11 h-11 rounded-xl flex items-center justify-center border shadow-sm transition-all group-hover:scale-105 group-hover:shadow-md bg-white",
                                getHeaderTextClass().replace("text-", "border-").replace("700", "200")
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
                                <h1 className={cn("font-bold text-sm leading-tight tracking-wide transition-colors", getHeaderTextClass())}>
                                    {activeModule.name || "Easy Sales Export"}
                                </h1>
                                <p className={cn("text-[10px] font-semibold tracking-widest uppercase transition-colors mt-0.5", getSubTextClass())}>
                                    {activeModule.description || "Hub"}
                                </p>
                            </div>
                        </Link>
                        <NotificationCenter />
                    </div>
                )}

                {isCollapsed && (
                    <div className="flex flex-col items-center gap-3">
                        <Link
                            href={activeModule.pathPrefix || "/dashboard"}
                            className="w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm hover:scale-105 transition-all bg-white"
                        >
                            {activeModule.pathPrefix && activeModule.pathPrefix !== "/dashboard" ? (
                                <ModuleIcon className={cn("w-5 h-5", getHeaderTextClass())} />
                            ) : (
                                <Image
                                    src="/images/logo.jpg"
                                    alt={COMPANY_INFO.name}
                                    width={40}
                                    height={40}
                                    className="w-full h-full rounded-xl object-cover"
                                />
                            )}
                        </Link>
                    </div>
                )}

                {/* Mobile close button */}
                {!isCollapsed && onMobileClose && (
                    <button
                        onClick={onMobileClose}
                        className="lg:hidden absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        aria-label="Close sidebar"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}

                {/* Desktop collapse toggle */}
                <button
                    onClick={toggleCollapsed}
                    className={cn(
                        "hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300 shadow-sm transition-all z-10",
                    )}
                    aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                    title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                </button>
            </div>

            {/* Navigation */}
            <nav className={cn(
                "flex-1 space-y-6 overflow-y-auto no-scrollbar",
                isCollapsed ? "px-2 py-4" : "px-4 py-6"
            )}>
                {/* Module Specific Links */}
                <div className={cn("space-y-1", isCollapsed && "space-y-2")}>
                    {!isCollapsed && (
                        <h3 className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                            {currentModuleKey === "dashboard" ? "Main Menu" : `${activeModule.name} Menu`}
                        </h3>
                    )}
                    {visibleModuleItems.map((item) => {
                        const active = isPathActive(item.href, item.exact);
                        const Icon = item.icon;

                        return (
                            <div key={item.href} className="relative group/tooltip">
                                <Link
                                    href={item.href}
                                    className={getThemeClasses(active)}
                                >
                                    <Icon className={cn(
                                        isCollapsed ? "w-5 h-5" : "w-5 h-5",
                                        active ? getHeaderTextClass() : "text-slate-400 group-hover:text-slate-600"
                                    )} />
                                    {!isCollapsed && (
                                        <>
                                            <span>{item.name}</span>
                                            {active && (
                                                <div className={cn("absolute right-3 w-1.5 h-1.5 rounded-full", getHeaderTextClass().replace("text-", "bg-"))} />
                                            )}
                                        </>
                                    )}
                                </Link>
                                {/* Tooltip for collapsed mode */}
                                {isCollapsed && (
                                    <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-150">
                                        <div className="bg-slate-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                                            {item.name}
                                            <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Global Links */}
                <div className={cn("space-y-1", isCollapsed && "space-y-2")}>
                    {!isCollapsed && (
                        <h3 className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                            Account
                        </h3>
                    )}
                    {visibleGlobalItems.map((item) => {
                        const active = isPathActive(item.href, item.exact);
                        const Icon = item.icon;

                        return (
                            <div key={item.href} className="relative group/tooltip">
                                <Link href={item.href} className={getThemeClasses(active)}>
                                    <Icon className={cn(
                                        "w-5 h-5",
                                        active ? getHeaderTextClass() : "text-slate-400 group-hover:text-slate-600"
                                    )} />
                                    {!isCollapsed && <span>{item.name}</span>}
                                </Link>
                                {isCollapsed && (
                                    <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-150">
                                        <div className="bg-slate-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                                            {item.name}
                                            <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Switch Module / Back to Hub */}
                {currentModuleKey !== "dashboard" && (
                    <div className="pt-4 mt-4 border-t border-dashed border-slate-200">
                        <div className="relative group/tooltip">
                            <Link
                                href="/dashboard"
                                className={cn(
                                    "flex items-center rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-all group",
                                    isCollapsed
                                        ? "justify-center w-10 h-10 mx-auto"
                                        : "gap-3 px-4 py-3"
                                )}
                            >
                                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-white shadow-sm border border-slate-200 text-slate-400 group-hover:text-primary transition-colors shrink-0">
                                    <LayoutDashboard className="w-4 h-4" />
                                </div>
                                {!isCollapsed && (
                                    <div className="flex-1">
                                        <span className="text-xs font-medium block">Switch App</span>
                                        <span className="text-[10px] text-slate-400 block group-hover:text-slate-500">Back to Hub</span>
                                    </div>
                                )}
                                {!isCollapsed && <ChevronRight className="w-4 h-4 text-slate-300 group-hover:translate-x-0.5 transition-transform" />}
                            </Link>
                            {isCollapsed && (
                                <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-150">
                                    <div className="bg-slate-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                                        Back to Hub
                                        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </nav>

            {/* Footer Actions */}
            <div className={cn(
                "border-t border-dashed border-slate-200 bg-slate-50/50 backdrop-blur-sm",
                isCollapsed ? "p-2 space-y-2" : "p-4 space-y-2"
            )}>

                {/* Logout Button */}
                <div className="relative group/tooltip">
                    <button
                        onClick={async () => {
                            try {
                                const { signOut } = await import("firebase/auth");
                                const { auth } = await import("@/lib/firebase");
                                await signOut(auth);
                            } catch (e) {
                                console.error("Firebase signout failed", e);
                            }
                            await nextAuthSignOut({ callbackUrl: "/auth/login" });
                        }}
                        className={cn(
                            "w-full flex items-center text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all font-medium text-sm text-left rounded-xl",
                            isCollapsed
                                ? "justify-center w-10 h-10 mx-auto px-0 py-0"
                                : "gap-3 px-4 py-3"
                        )}
                    >
                        <LogOut className="w-5 h-5 shrink-0" />
                        {!isCollapsed && <span>Sign Out</span>}
                    </button>
                    {isCollapsed && (
                        <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 opacity-0 group-hover/tooltip:opacity-100 transition-opacity duration-150">
                            <div className="bg-slate-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                                Sign Out
                                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );

    return (
        <>
            {/* ── Desktop Sidebar ─────────────────────────────────────────── */}
            <div className="hidden lg:flex h-screen sticky top-0">
                {sidebarContent}
            </div>

            {/* ── Mobile Drawer Overlay ──────────────────────────────────── */}
            {isMobileOpen && (
                <div
                    className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                    onClick={onMobileClose}
                    aria-hidden="true"
                />
            )}

            {/* ── Mobile Drawer ──────────────────────────────────────────── */}
            <div className={cn(
                "lg:hidden fixed inset-y-0 left-0 z-50 flex transition-transform duration-300 ease-in-out",
                isMobileOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                {/* Force full width (w-72) on mobile — never collapsed */}
                <aside className={cn(
                    "w-72 border-r flex flex-col h-screen shadow-2xl",
                    getSidebarBorderClass()
                )}>
                    {/* Mobile header */}
                    <div className="p-6 border-b border-dashed border-slate-200 relative">
                        <div className="flex items-center justify-between mb-6">
                            <Link
                                href={activeModule.pathPrefix || "/dashboard"}
                                className="flex items-center gap-3.5 hover:opacity-80 transition-opacity cursor-pointer group"
                                onClick={onMobileClose}
                            >
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center border shadow-sm bg-white">
                                    {activeModule.pathPrefix && activeModule.pathPrefix !== "/dashboard" ? (
                                        <ModuleIcon className={cn("w-6 h-6", getHeaderTextClass())} />
                                    ) : (
                                        <Image src="/images/logo.jpg" alt={COMPANY_INFO.name} width={44} height={44} className="w-full h-full rounded-xl object-cover" />
                                    )}
                                </div>
                                <div className="flex flex-col">
                                    <h1 className={cn("font-bold text-sm leading-tight tracking-wide", getHeaderTextClass())}>
                                        {activeModule.name || "Easy Sales Export"}
                                    </h1>
                                    <p className={cn("text-[10px] font-semibold tracking-widest uppercase mt-0.5", getSubTextClass())}>
                                        {activeModule.description || "Hub"}
                                    </p>
                                </div>
                            </Link>

                            <button
                                onClick={onMobileClose}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                aria-label="Close menu"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Mobile nav */}
                    <nav className="flex-1 px-4 space-y-6 py-6 overflow-y-auto no-scrollbar">
                        <div className="space-y-1">
                            <h3 className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                                {currentModuleKey === "dashboard" ? "Main Menu" : `${activeModule.name} Menu`}
                            </h3>
                            {visibleModuleItems.map((item) => {
                                const active = isPathActive(item.href, item.exact);
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={onMobileClose}
                                        className={cn(
                                            "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group relative",
                                            active
                                                ? cn(getThemeClasses(true))
                                                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                        )}
                                    >
                                        <Icon className={cn("w-5 h-5", active ? getHeaderTextClass() : "text-slate-400 group-hover:text-slate-600")} />
                                        <span>{item.name}</span>
                                    </Link>
                                );
                            })}
                        </div>

                        <div className="space-y-1">
                            <h3 className="px-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Account</h3>
                            {visibleGlobalItems.map((item) => {
                                const active = isPathActive(item.href, item.exact);
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={onMobileClose}
                                        className={cn(
                                            "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all",
                                            active
                                                ? cn(getThemeClasses(true))
                                                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                        )}
                                    >
                                        <Icon className={cn("w-5 h-5", active ? getHeaderTextClass() : "text-slate-400")} />
                                        <span>{item.name}</span>
                                    </Link>
                                );
                            })}
                        </div>

                        {currentModuleKey !== "dashboard" && (
                            <div className="pt-4 border-t border-dashed border-slate-200">
                                <Link
                                    href="/dashboard"
                                    onClick={onMobileClose}
                                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-all group"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-white shadow-sm border border-slate-200 text-slate-400 group-hover:text-primary transition-colors">
                                        <LayoutDashboard className="w-4 h-4" />
                                    </div>
                                    <div className="flex-1">
                                        <span className="text-xs font-medium block">Switch App</span>
                                        <span className="text-[10px] text-slate-400 block">Back to Hub</span>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-slate-300" />
                                </Link>
                            </div>
                        )}
                    </nav>

                    {/* Mobile footer */}
                    <div className="p-4 border-t border-dashed border-slate-200 space-y-2 bg-slate-50/50">
                        <button
                            onClick={async () => {
                                onMobileClose?.();
                                try {
                                    const { signOut } = await import("firebase/auth");
                                    const { auth } = await import("@/lib/firebase");
                                    await signOut(auth);
                                } catch (e) {
                                    console.error("Firebase signout failed", e);
                                }
                                await nextAuthSignOut({ callbackUrl: "/auth/login" });
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all font-medium text-sm text-left"
                        >
                            <LogOut className="w-5 h-5" />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </aside>
            </div>
        </>
    );
}
