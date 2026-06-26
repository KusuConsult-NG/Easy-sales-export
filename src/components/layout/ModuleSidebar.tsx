"use client";

/**
 * ModuleSidebar — Unified, module-aware sidebar navigation.
 *
 * KEY DESIGN DECISION:
 *   This component derives which nav items to show PURELY from the URL path.
 *   It does NOT re-check enrollment or serviceRegistrations.
 *   Reason: every module route is already wrapped by a server-side layout.tsx
 *   that runs checkModuleAccess(). If a user reached /academy/dashboard they
 *   are approved — the sidebar must show the full Academy nav immediately,
 *   with zero flicker.
 *
 * The only role check performed here is "buyer vs seller" inside marketplace,
 * which comes from the JWT session (available synchronously on first render).
 */

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback } from "react";
import {
    LayoutDashboard, BookOpen, Video, Award, TrendingUp,
    GraduationCap, Truck, FileText, Wallet, Users, ScrollText,
    ClipboardList, Map, Tractor, Home, Leaf, Search, Package,
    Lock, Briefcase, Container, MessageSquare, User, Store,
    Waves, Building2, ClipboardCheck, ToggleLeft, BadgeCheck,
    UserX, MessageCircle, ShieldAlert, ChevronLeft, ChevronRight,
    LogOut, X, Settings, Sprout, Zap, IdCard, ShoppingCart
} from "lucide-react";


import { cn } from "@/lib/utils";
import { COMPANY_INFO } from "@/lib/constants";
import { getModuleConfig } from "@/lib/module-config";
import NotificationCenter from "./NotificationCenter";
import { hasAppAccess } from "@/lib/role-app-mapping";
import { signOut as nextAuthSignOut } from "next-auth/react";
import type { UserRole } from "@/lib/types/roles";
import { COLLECTIONS } from "@/lib/types/firestore";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { useFirebaseAuthed } from "@/hooks/useFirebaseAuthed";


const COLLAPSED_KEY = "sidebar_collapsed_v2";

// ---------------------------------------------------------------------------
// NAV ITEM TYPES
// ---------------------------------------------------------------------------
interface NavItem {
    name: string;
    href: string;
    icon: React.ElementType;
    exact?: boolean;
    sellerOnly?: boolean;
    moduleAccess?: string; // AppIdentifier string
    sectionLabel?: string; // renders a section header before this item
}


// ---------------------------------------------------------------------------
// NAV DEFINITIONS — one per module
// ---------------------------------------------------------------------------
const ACADEMY_NAV: NavItem[] = [
    { name: "Learning Home",  href: "/academy/dashboard",   icon: GraduationCap },
    { name: "Browse Courses", href: "/academy/courses",     icon: Search },
    { name: "My Courses",     href: "/academy/my-courses",  icon: BookOpen },
    { name: "Live Classes",   href: "/academy/live",        icon: Video },
    { name: "Certificates",   href: "/academy/certificate", icon: Award },
    { name: "My Progress",    href: "/academy/progress",    icon: TrendingUp },
];

const WAVE_NAV: NavItem[] = [
    { name: "Dashboard",      href: "/wave/dashboard",      icon: LayoutDashboard },
    { name: "Training",       href: "/wave/training",       icon: BookOpen },
    { name: "Live Training",  href: "/wave/live-training",  icon: Video },
    { name: "Resources",      href: "/wave/resources",      icon: FileText },
    { name: "Earnings",       href: "/wave/earnings",       icon: TrendingUp },
    { name: "Shipments",      href: "/wave/shipments",      icon: Truck },
    { name: "Certificates",   href: "/wave/certificates",   icon: Award },
];

const COOPERATIVES_NAV: NavItem[] = [
    { name: "Dashboard",      href: "/cooperatives/dashboard",  icon: LayoutDashboard },
    { name: "ID Card",        href: "/cooperatives/id-card",    icon: IdCard },
    { name: "My Savings",     href: "/cooperatives/my-savings", icon: Wallet },
    { name: "Loans",          href: "/cooperatives/loans",      icon: ScrollText },
    { name: "Contribute",     href: "/cooperatives/contribute", icon: TrendingUp },
    { name: "Directory",      href: "/cooperatives/directory",  icon: Users },
    { name: "History",        href: "/cooperatives/history",    icon: ClipboardList },
];

const FARM_NATION_NAV: NavItem[] = [
    { name: "Properties",     href: "/farm-nation/properties",    icon: Map },
    { name: "My Properties",  href: "/farm-nation/my-properties", icon: Tractor },
    { name: "My Inquiries",   href: "/farm-nation/inquiries",     icon: MessageSquare },
    { name: "Map View",       href: "/farm-nation/map",           icon: Map },
    { name: "List Land",      href: "/farm-nation/list-land",     icon: Leaf },
];

const MARKETPLACE_NAV: NavItem[] = [
    { name: "Browse Products",   href: "/marketplace/buyer/products", icon: Search },
    { name: "Shopping Cart",     href: "/marketplace/checkout",       icon: ShoppingCart },
    { name: "My Orders",         href: "/marketplace/buyer/orders",   icon: Package },
    { name: "Village Market",    href: "/marketplace/village-market", icon: Zap },
    { name: "Escrow",            href: "/escrow",                     icon: Lock },
    { name: "Seller Dashboard",  href: "/marketplace/seller",         icon: Store,    sellerOnly: true },

    { name: "My Products",       href: "/marketplace/products",       icon: Package,  sellerOnly: true },
];

const EXPORT_NAV: NavItem[] = [
    { name: "Dashboard",       href: "/export/dashboard",      icon: LayoutDashboard },
    { name: "Opportunities",   href: "/export/opportunities",  icon: Briefcase },
    { name: "Portfolio",       href: "/export/portfolio",      icon: TrendingUp },
    { name: "Transactions",    href: "/export/transactions",   icon: FileText },
    { name: "Browse Windows",  href: "/export/windows",        icon: Container },
];

const ESCROW_NAV: NavItem[] = [
    { name: "Escrow Home",    href: "/escrow",          icon: Lock, exact: true },
    { name: "Marketplace",    href: "/marketplace/buyer/dashboard", icon: Store, moduleAccess: "marketplace" },
    { name: "Farm Nation",    href: "/farm-nation/properties", icon: Sprout, moduleAccess: "farm-nation" },
    { name: "Support",        href: "/messages",        icon: MessageSquare },
];



const ADMIN_NAV: NavItem[] = [
    { name: "Dashboard",          href: "/admin",                    icon: LayoutDashboard, exact: true },
    { name: "Analytics",          href: "/admin/analytics",          icon: TrendingUp },
    { name: "User Management",    href: "/admin/users",              icon: Users },
    { name: "Content Approval",   href: "/admin/content-approval",   icon: ClipboardCheck },
    { name: "Communications",     href: "/admin/communications",     icon: MessageSquare },
    { name: "Disputes",           href: "/admin/disputes",           icon: ShieldAlert },
    { name: "Audit Logs",         href: "/admin/audit-logs",         icon: ScrollText },
    { name: "Orphaned Users",     href: "/admin/orphaned-users",     icon: UserX },

    { name: "Feature Toggles",    href: "/admin/feature-toggles",    icon: ToggleLeft },
    { name: "WAVE Program",       href: "/admin/wave",               icon: Waves,          sectionLabel: "Modules" },
    { name: "Cooperatives",       href: "/admin/cooperatives",       icon: Building2 },
    { name: "Marketplace",        href: "/admin/marketplace",        icon: Store },
    { name: "Village Market",     href: "/admin/marketplace/village-market", icon: Zap },
    { name: "Export Windows",     href: "/admin/export",             icon: Container },

    { name: "Farm Nation",        href: "/admin/farm-nation",        icon: Tractor },
    { name: "Academy",            href: "/admin/academy",            icon: GraduationCap },
    { name: "Finance",            href: "/admin/finance",            icon: Wallet,          sectionLabel: "System" },
    { name: "Settings",           href: "/admin/settings",           icon: Settings },
    { name: "AI Chatbot",         href: "/admin/chatbot",            icon: MessageCircle },
];

const GLOBAL_NAV: NavItem[] = [
    { name: "Messages", href: "/messages", icon: MessageSquare },
    { name: "Profile",  href: "/profile",  icon: User },
];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function detectModuleKey(pathname: string): string {
    if (typeof window !== "undefined") {
        const hostname = window.location.hostname.replace(/^www\./, "").toLowerCase();
        if (hostname === "easysalescooperative.com" || hostname.endsWith(".easysalescooperative.com")) {
            return "cooperatives";
        }
    }

    if (pathname.startsWith("/academy"))      return "academy";
    if (pathname.startsWith("/wave"))         return "wave";
    if (pathname.startsWith("/cooperatives")) return "cooperatives";
    if (pathname.startsWith("/farm-nation"))  return "farm-nation";
    if (pathname.startsWith("/marketplace"))  return "marketplace";
    if (pathname.startsWith("/export"))       return "export";
    if (pathname.startsWith("/escrow"))       return "escrow";
    if (pathname.startsWith("/admin"))        return "admin";
    return "dashboard";
}

function getModuleNav(moduleKey: string): NavItem[] {
    switch (moduleKey) {
        case "academy":      return ACADEMY_NAV;
        case "wave":         return WAVE_NAV;
        case "cooperatives": return COOPERATIVES_NAV;
        case "farm-nation":  return FARM_NATION_NAV;
        case "marketplace":  return MARKETPLACE_NAV;
        case "export":       return EXPORT_NAV;
        case "escrow":       return ESCROW_NAV;
        case "admin":        return ADMIN_NAV;
        default:             return [];

    }
}

// Theme classes derived from module color
interface Theme {
    sidebar: string;
    headerBorder: string;
    active: string;
    activeText: string;
    activeDot: string;
    heading: string;
    subheading: string;
    sectionLabel: string;
}

function buildTheme(color: string): Theme {
    const map: Record<string, Theme> = {
        emerald: {
            sidebar:      "bg-white border-emerald-100",
            headerBorder: "border-emerald-100",
            active:       "bg-emerald-50 ring-1 ring-emerald-200 shadow-sm",
            activeText:   "text-emerald-700",
            activeDot:    "bg-emerald-600",
            heading:      "text-emerald-800",
            subheading:   "text-emerald-600/70",
            sectionLabel: "text-emerald-500/80",
        },
        amber: {
            sidebar:      "bg-white border-amber-100",
            headerBorder: "border-amber-100",
            active:       "bg-amber-50 ring-1 ring-amber-200 shadow-sm",
            activeText:   "text-amber-700",
            activeDot:    "bg-amber-600",
            heading:      "text-amber-800",
            subheading:   "text-amber-600/70",
            sectionLabel: "text-amber-500/80",
        },
        blue: {
            sidebar:      "bg-white border-blue-100",
            headerBorder: "border-blue-100",
            active:       "bg-blue-50 ring-1 ring-blue-200 shadow-sm",
            activeText:   "text-blue-700",
            activeDot:    "bg-blue-700",
            heading:      "text-blue-800",
            subheading:   "text-blue-600/70",
            sectionLabel: "text-blue-500/80",
        },
        teal: {
            sidebar:      "bg-white border-teal-100",
            headerBorder: "border-teal-100",
            active:       "bg-teal-50 ring-1 ring-teal-200 shadow-sm",
            activeText:   "text-teal-700",
            activeDot:    "bg-teal-600",
            heading:      "text-teal-800",
            subheading:   "text-teal-600/70",
            sectionLabel: "text-teal-500/80",
        },
        indigo: {
            sidebar:      "bg-white border-indigo-100",
            headerBorder: "border-indigo-100",
            active:       "bg-indigo-50 ring-1 ring-indigo-200 shadow-sm",
            activeText:   "text-indigo-700",
            activeDot:    "bg-indigo-600",
            heading:      "text-indigo-800",
            subheading:   "text-indigo-600/70",
            sectionLabel: "text-indigo-500/80",
        },
        sky: {
            sidebar:      "bg-white border-sky-100",
            headerBorder: "border-sky-100",
            active:       "bg-sky-50 ring-1 ring-sky-200 shadow-sm",
            activeText:   "text-sky-700",
            activeDot:    "bg-sky-600",
            heading:      "text-sky-800",
            subheading:   "text-sky-600/70",
            sectionLabel: "text-sky-500/80",
        },
        rose: {
            sidebar:      "bg-white border-rose-100",
            headerBorder: "border-rose-100",
            active:       "bg-rose-50 ring-1 ring-rose-200 shadow-sm",
            activeText:   "text-rose-700",
            activeDot:    "bg-rose-600",
            heading:      "text-rose-800",
            subheading:   "text-rose-600/70",
            sectionLabel: "text-rose-500/80",
        },
    };
    return map[color] ?? {
        sidebar:      "bg-white border-slate-200",
        headerBorder: "border-slate-200",
        active:       "bg-slate-100 ring-1 ring-slate-200 shadow-sm",
        activeText:   "text-slate-800",
        activeDot:    "bg-slate-700",
        heading:      "text-slate-900",
        subheading:   "text-slate-500",
        sectionLabel: "text-slate-400",
    };
}

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------
interface ModuleSidebarProps {
    isMobileOpen?: boolean;
    onMobileClose?: () => void;
}

export function ModuleSidebar({ isMobileOpen = false, onMobileClose }: ModuleSidebarProps) {
    const pathname   = usePathname();
    const { data: session } = useSession();
    const [isCollapsed, setIsCollapsed]     = useState(false);
    const [mounted, setMounted]             = useState(false);
    const [unreadMessages, setUnreadMessages] = useState(0);

    const userId   = session?.user?.id;
    const isAuthed = useFirebaseAuthed(userId);
    const roles    = (session?.user?.roles as UserRole[]) || [];
    const userName = session?.user?.name || "User";
    const isSeller = roles.includes("seller");

    // ── Module detection ──────────────────────────────────────────────────
    const moduleKey    = detectModuleKey(pathname || "");
    const moduleConfig = getModuleConfig(pathname);
    const theme        = buildTheme(moduleConfig.theme);
    const ModuleIcon   = moduleConfig.icon;

    const isDedicatedCoop = typeof window !== "undefined" && (() => {
        const hostname = window.location.hostname.replace(/^www\./, "").toLowerCase();
        return hostname === "easysalescooperative.com" || hostname.endsWith(".easysalescooperative.com");
    })();

    const getRelativeUrl = useCallback((href: string) => {
        if (isDedicatedCoop && href.startsWith("/cooperatives")) {
            const relative = href.substring("/cooperatives".length);
            return relative.startsWith("/") ? relative : "/" + relative;
        }
        return href;
    }, [isDedicatedCoop]);

    // ── Nav items ────────────────────────────────────────────────────────
    const rawNav  = getModuleNav(moduleKey);
    const navItems = rawNav.filter(item => {
        // Role check for marketplace seller items
        if (item.sellerOnly && !isSeller) return false;

        // Access check for cross-module items (like in Escrow)
        if (item.moduleAccess && !hasAppAccess(roles, item.moduleAccess as any)) return false;

        // Hide "Browse Courses" for paid academy plans
        if (item.href === "/academy/courses") {
            const academyPlan = (session?.user as any)?.serviceRegistrations?.academy?.plan || "free";
            const isPaidAcademy = ["elite", "standard", "foundation", "advanced"].includes(academyPlan.toLowerCase());
            if (isPaidAcademy) return false;
        }

        return true;
    });


    // ── Persistence & mount ───────────────────────────────────────────────
    useEffect(() => {
        setMounted(true);
        try {
            const stored = localStorage.getItem(COLLAPSED_KEY);
            if (stored === "true") setIsCollapsed(true);
        } catch { /* localStorage unavailable */ }
    }, []);

    const toggleCollapsed = useCallback(() => {
        setIsCollapsed(prev => {
            const next = !prev;
            try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
            return next;
        });
    }, []);

    // Close mobile drawer on navigation
    useEffect(() => {
        if (isMobileOpen && onMobileClose) onMobileClose();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    // ── Real-time unread messages (lightweight) ───────────────────────────
    useEffect(() => {
        if (!userId || !isAuthed) return;
        const q = query(
            collection(db, COLLECTIONS.CONVERSATIONS),
            where("participants", "array-contains", userId)
        );
        const unsub = onSnapshot(q, snap => {
            let count = 0;
            snap.docs.forEach(d => {
                const data = d.data();
                const lastRead = data.participantDetails?.[userId]?.lastRead;
                const lastMsg  = data.lastMessage?.timestamp;
                if (lastMsg && (!lastRead || lastMsg.toMillis?.() > lastRead.toMillis?.())) count++;
            });
            setUnreadMessages(count);
        }, (error) => {
            console.error("ModuleSidebar messages listener failed:", error);
        });
        return () => unsub();
    }, [userId, isAuthed]);

    // ── Active path helper ────────────────────────────────────────────────
    const isActive = (href: string, exact?: boolean) => {
        const targetHref = getRelativeUrl(href);
        if (exact) return pathname === targetHref;
        return pathname === targetHref || pathname?.startsWith(targetHref + "/");
    };

    // ── Theme-aware nav item classes ──────────────────────────────────────
    const itemBase = (active: boolean, collapsed: boolean) =>
        cn(
            "flex items-center rounded-xl font-medium text-sm transition-all duration-150 group relative",
            collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-3 px-4 py-2.5",
            active
                ? cn(theme.active, theme.activeText)
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        );

    if (!mounted) return null;

    // ── Sidebar inner HTML (shared between desktop + mobile) ─────────────
    const SidebarInner = ({ mobile = false }: { mobile?: boolean }) => {
        const collapsed = !mobile && isCollapsed;
        return (
            <aside className={cn(
                "flex flex-col h-full border-r transition-all duration-300",
                collapsed ? "w-16" : "w-72",
                theme.sidebar
            )}>
                {/* ── Header ── */}
                <div className={cn("relative border-b border-dashed", collapsed ? "p-3" : "p-5", theme.headerBorder)}>
                    {!collapsed && (
                        <div className="flex items-center justify-between mb-1">
                            <Link
                                href={getRelativeUrl(moduleConfig.pathPrefix || "/dashboard")}
                                className="flex items-center gap-3 hover:opacity-80 transition-opacity group"
                            >
                                <div className={cn(
                                    "w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm bg-white transition-all group-hover:scale-105",
                                    `border-${moduleConfig.theme}-200`
                                )}>
                                    {moduleConfig.pathPrefix && moduleConfig.pathPrefix !== "/dashboard" ? (
                                        <ModuleIcon className={cn("w-5 h-5", theme.activeText)} />
                                    ) : (
                                        <Image src="/images/logo.jpg" alt={COMPANY_INFO.name} width={40} height={40} className="rounded-xl object-cover" />
                                    )}
                                </div>
                                <div>
                                    <p className={cn("font-bold text-sm leading-tight", theme.heading)}>
                                        {moduleConfig.name || COMPANY_INFO.name}
                                    </p>
                                    <p className={cn("text-[10px] font-semibold tracking-widest uppercase mt-0.5", theme.subheading)}>
                                        {moduleConfig.description || "Hub"}
                                    </p>
                                </div>
                            </Link>
                            <div className="flex items-center gap-1">
                                <NotificationCenter />
                            </div>
                        </div>
                    )}

                    {collapsed && (
                        <div className="flex flex-col items-center gap-3">
                            <Link href={getRelativeUrl(moduleConfig.pathPrefix || "/dashboard")} className="w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm bg-white hover:scale-105 transition-all">
                                <ModuleIcon className={cn("w-5 h-5", theme.activeText)} />
                            </Link>
                        </div>
                    )}

                    {/* Mobile close button */}
                    {mobile && onMobileClose && (
                        <button onClick={onMobileClose} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" aria-label="Close sidebar">
                            <X className="w-4 h-4" />
                        </button>
                    )}

                    {/* Desktop collapse toggle */}
                    {!mobile && (
                        <button
                            onClick={toggleCollapsed}
                            className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 shadow-sm transition-all z-10"
                            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        >
                            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
                        </button>
                    )}
                </div>

                {/* ── Navigation ── */}
                <nav className={cn("flex-1 overflow-y-auto no-scrollbar space-y-5", collapsed ? "px-2 py-4" : "px-3 py-5")}>

                    {/* Module-specific nav */}
                    {navItems.length > 0 && (
                        <div className="space-y-0.5">
                            {!collapsed && (
                                <p className={cn("px-4 text-[10px] font-bold uppercase tracking-widest mb-2", theme.sectionLabel)}>
                                    {moduleKey === "admin" ? "Core Platform" : `${moduleConfig.name || "Module"} Menu`}
                                </p>
                            )}
                            {navItems.map(item => {
                                const active = isActive(item.href, item.exact);
                                const Icon   = item.icon;
                                return (
                                    <div key={item.href}>
                                        {/* Section label (admin only) */}
                                        {item.sectionLabel && !collapsed && (
                                            <p className={cn("px-4 text-[10px] font-bold uppercase tracking-widest mb-2 mt-4", theme.sectionLabel)}>
                                                {item.sectionLabel}
                                            </p>
                                        )}
                                        <div className="relative group/tip">
                                            <Link href={getRelativeUrl(item.href)} className={itemBase(active, collapsed)}>
                                                <Icon className={cn("w-4 h-4 shrink-0", active ? theme.activeText : "text-slate-400 group-hover:text-slate-600")} />
                                                {!collapsed && (
                                                    <>
                                                        <span className="flex-1">{item.name}</span>
                                                        {active && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", theme.activeDot)} />}
                                                    </>
                                                )}
                                            </Link>
                                            {/* Collapsed tooltip */}
                                            {collapsed && (
                                                <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
                                                    <div className="bg-slate-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
                                                        {item.name}
                                                        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Global nav (Messages, Profile) */}
                    <div className="space-y-0.5">
                        {!collapsed && (
                            <p className={cn("px-4 text-[10px] font-bold uppercase tracking-widest mb-2", theme.sectionLabel)}>
                                Account
                            </p>
                        )}
                        {GLOBAL_NAV.map(item => {
                            const active = isActive(item.href);
                            const Icon   = item.icon;
                            const badge  = item.name === "Messages" ? unreadMessages : 0;
                            return (
                                <div key={item.href} className="relative group/tip">
                                    <Link href={item.href} className={itemBase(active, collapsed)}>
                                        <Icon className={cn("w-4 h-4 shrink-0", active ? theme.activeText : "text-slate-400 group-hover:text-slate-600")} />
                                        {!collapsed && <span className="flex-1">{item.name}</span>}
                                        {badge > 0 && (
                                            <span className="min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                                                {badge > 99 ? "99+" : badge}
                                            </span>
                                        )}
                                    </Link>
                                    {collapsed && (
                                        <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
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

                    {/* Back to Hub */}
                    {moduleKey !== "dashboard" && moduleKey !== "admin" && (
                        <div className="pt-3 border-t border-dashed border-slate-200">
                            <div className="relative group/tip">
                                <Link
                                    href={isDedicatedCoop ? "https://www.easysalesexport.com/dashboard" : "/dashboard"}
                                    className={cn(
                                        "flex items-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all group",
                                        collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-3 px-4 py-2.5"
                                    )}
                                >
                                    <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center group-hover:bg-white shadow-sm shrink-0">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                                        </svg>
                                    </div>
                                    {!collapsed && (
                                        <div className="flex-1">
                                            <span className="text-xs font-semibold block text-slate-600">Switch App</span>
                                            <span className="text-[10px] text-slate-400">Back to Hub</span>
                                        </div>
                                    )}
                                </Link>
                                {collapsed && (
                                    <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity">
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

                {/* ── Footer ── */}
                <div className={cn("border-t border-dashed border-slate-200 bg-slate-50/60", collapsed ? "p-2" : "p-4")}>
                    {!collapsed && (
                        <div className="flex items-center gap-3 px-1 mb-3">
                            <div className="w-8 h-8 rounded-full bg-linear-to-br from-slate-600 to-slate-800 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                {userName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-800 truncate">{userName}</p>
                                <p className="text-[10px] text-slate-400 truncate">{session?.user?.email}</p>
                            </div>
                        </div>
                    )}

                    <div className="relative group/tip">
                        <button
                            onClick={async () => {
                                try {
                                    const { signOut } = await import("firebase/auth");
                                    const { auth }    = await import("@/lib/firebase");
                                    await signOut(auth);
                                } catch (e) { console.error("Firebase signout failed", e); }
                                await nextAuthSignOut({ callbackUrl: "/auth/login" });
                            }}
                            className={cn(
                                "w-full flex items-center text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 rounded-xl transition-all text-sm font-medium",
                                collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-3 px-4 py-2.5"
                            )}
                        >
                            <LogOut className="w-4 h-4 shrink-0" />
                            {!collapsed && <span>Sign Out</span>}
                        </button>
                        {collapsed && (
                            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity">
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
    };

    return (
        <>
            {/* ── Desktop sidebar ── */}
            <div className="hidden lg:flex shrink-0 h-screen sticky top-0">
                <SidebarInner />
            </div>

            {/* ── Mobile overlay ── */}
            {isMobileOpen && (
                <div
                    className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                    onClick={onMobileClose}
                    aria-hidden="true"
                />
            )}

            {/* ── Mobile drawer ── */}
            <div className={cn(
                "lg:hidden fixed inset-y-0 left-0 z-50 flex transition-transform duration-300 ease-in-out",
                isMobileOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <SidebarInner mobile />
            </div>
        </>
    );
}
