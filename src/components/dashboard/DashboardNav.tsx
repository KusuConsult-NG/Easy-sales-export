"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import {
    LayoutDashboard,
    Wallet,
    Package,
    MessageCircle,
    Bell,
    Star,
    Award,
    IdCard,
    AlertTriangle,
    ChevronRight,
    LogOut,
    User,
    ExternalLink,
    Sparkles,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, doc } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { UserRole } from "@/lib/types/roles";
import { getPrimaryApp } from "@/lib/role-app-mapping";
import { useFeatureToggles } from "@/hooks/useFeatureToggle";

interface NavItem {
    label: string;
    href: string;
    icon: React.ElementType;
    badge?: number | null;
}

/**
 * Returns the label + href for the user's primary module dashboard link
 * based on their roles — so approved users can jump straight to their module.
 */
function getModuleLinks(roles: UserRole[], serviceRegs: any): { label: string; href: string; icon: React.ElementType }[] {
    const links: { label: string; href: string; icon: React.ElementType }[] = [];

    const isApprovedOrPending = (mod: string) => {
        return serviceRegs?.[mod]?.status === 'approved' || serviceRegs?.[mod]?.status === 'pending';
    };

    if (roles.includes("wave_participant") && isApprovedOrPending('wave')) {
        links.push({ label: "WAVE Dashboard", href: "/wave/dashboard", icon: Sparkles });
    }
    if (roles.includes("academy_participant") && isApprovedOrPending('academy')) {
        links.push({ label: "Academy", href: "/academy/dashboard", icon: Award });
    }
    if ((roles.includes("buyer") || roles.includes("seller")) && isApprovedOrPending('marketplace')) {
        links.push({ label: "Marketplace", href: "/marketplace", icon: Package });
    }
    if (roles.includes("cooperative_member") && isApprovedOrPending('cooperatives')) {
        links.push({ label: "Cooperative", href: "/cooperatives/dashboard", icon: User });
    }
    if (roles.includes("export_participant") && isApprovedOrPending('export')) {
        links.push({ label: "Export Hub", href: "/export/dashboard", icon: ExternalLink });
    }
    if ((roles.includes("farmer") || roles.includes("land_owner") || roles.includes("investor")) && isApprovedOrPending('farm-nation')) {
        links.push({ label: "Farm Nation", href: "/farm-nation/dashboard", icon: ExternalLink });
    }

    return links;
}

export default function DashboardNav() {
    const { data: session } = useSession();
    const pathname = usePathname();
    const [unreadCount, setUnreadCount] = useState(0);
    const [unreadMessages, setUnreadMessages] = useState(0);
    const [mobileOpen, setMobileOpen] = useState(false);

    const userId = session?.user?.id;
    const roles = (session?.user?.roles as UserRole[]) || [];
    const userName = session?.user?.name || "User";
    const userEmail = session?.user?.email || "";

    const [serviceRegs, setServiceRegs] = useState<any>({});

    // Real-time Service Registrations
    useEffect(() => {
        if (!userId) return;
        const unsub = onSnapshot(doc(db, COLLECTIONS.USERS, userId), (docSnap) => {
            if (docSnap.exists()) {
                setServiceRegs(docSnap.data()?.serviceRegistrations || {});
            }
        });
        return () => unsub();
    }, [userId]);

    // Real-time unread notifications count
    useEffect(() => {
        if (!userId) return;
        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where("userId", "==", userId),
            where("read", "==", false)
        );
        const unsub = onSnapshot(q, (snap) => {
            setUnreadCount(snap.size);
        });
        return () => unsub();
    }, [userId]);

    // Real-time unread messages count
    useEffect(() => {
        if (!userId) return;
        const q = query(
            collection(db, COLLECTIONS.CONVERSATIONS),
            where("participants", "array-contains", userId)
        );
        const unsub = onSnapshot(q, (snap) => {
            let count = 0;
            snap.docs.forEach((doc) => {
                const data = doc.data();
                const lastRead = data.participantDetails?.[userId]?.lastRead;
                const lastMsg = data.lastMessage?.timestamp;
                if (lastMsg && (!lastRead || lastMsg.toMillis?.() > lastRead.toMillis?.() )) {
                    count++;
                }
            });
            setUnreadMessages(count);
        });
        return () => unsub();
    }, [userId]);

    const moduleLinks = getModuleLinks(roles, serviceRegs);
    const toggles = useFeatureToggles(["digital_id_system", "escrow_messaging"]);

    // ── Role-gated nav items ──────────────────────────────────────────────────
    // ONLY show module-specific links to users who have actually enrolled AND are approved.
    const isAdmin = roles.includes("admin") || roles.includes("super_admin");

    const isMarketplaceApproved = (roles.includes("buyer") || roles.includes("seller")) && serviceRegs?.marketplace?.status === 'approved';
    const isFarmNationApproved  = (roles.includes("farmer") || roles.includes("land_owner") || roles.includes("investor")) && serviceRegs?.['farm-nation']?.status === 'approved';
    const isWaveOrAcademyApproved = (roles.includes("wave_participant") && serviceRegs?.wave?.status === 'approved') || 
                                    (roles.includes("academy_participant") && serviceRegs?.academy?.status === 'approved');

    const isMarketplaceUser = isMarketplaceApproved;
    const isFarmNationUser = isFarmNationApproved;
    const isWaveOrAcademy = isWaveOrAcademyApproved;

    const coreNavItems: NavItem[] = [
        { label: "Overview",       href: "/dashboard",                  icon: LayoutDashboard },
        { label: "Wallet",         href: "/dashboard/wallet",           icon: Wallet },
        // Messages + Notifications — universal
        { label: "Messages",       href: "/messages",                   icon: MessageCircle, badge: unreadMessages || null },
        { label: "Notifications",  href: "/dashboard/notifications",    icon: Bell,          badge: unreadCount || null },
        // Marketplace-only items
        ...(isMarketplaceUser ? [
            { label: "My Orders",  href: "/marketplace/buyer/orders",   icon: Package },
            ...(toggles.escrow_messaging !== false ? [
                { label: "Disputes",   href: "/dashboard/disputes",         icon: AlertTriangle },
            ] : []),
        ] : []),
        // Reviews — marketplace or farm nation users
        ...((isMarketplaceUser || isFarmNationUser) ? [
            { label: "My Reviews", href: "/dashboard/reviews",          icon: Star },
        ] : []),
        // Certificates — WAVE or Academy participants
        ...(isWaveOrAcademy ? [
            { label: "Certificates", href: "/dashboard/certificates",   icon: Award },
        ] : []),
    ];

    function isActive(href: string) {
        if (href === "/dashboard") return pathname === "/dashboard";
        return pathname.startsWith(href);
    }

    const NavContent = () => (
        <div className="flex flex-col h-full">
            <div className="px-5 py-5 border-b border-slate-700/50">
                <Link href="/dashboard" className="flex items-center gap-3">
                    <div className="relative w-10 h-10 bg-white rounded-lg flex items-center justify-center p-1 shrink-0">
                        <Image 
                            src="/images/logo.jpg" 
                            alt="Easy Sales" 
                            width={32} 
                            height={32} 
                            className="object-contain"
                        />
                    </div>
                </Link>
            </div>

            {/* User info */}
            <div className="px-4 py-4 border-b border-slate-700/50">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-linear-to-br from-emerald-500 to-green-700 flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {userName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <p className="text-white font-semibold text-sm truncate">{userName}</p>
                        <p className="text-slate-400 text-xs truncate">{userEmail}</p>
                    </div>
                </div>
            </div>

            {/* Scrollable nav area */}
            <div className="flex-1 overflow-y-auto py-3 space-y-1 px-3">

                {/* My Modules — only shown when user has approved roles */}
                {moduleLinks.length > 0 && (
                    <div className="mb-4">
                        <p className="px-2 mb-1.5 text-xs font-bold text-slate-500 uppercase tracking-widest">
                            My Modules
                        </p>
                        {moduleLinks.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group hover:bg-emerald-500/10 text-slate-300 hover:text-emerald-300 mb-0.5"
                                onClick={() => setMobileOpen(false)}
                            >
                                <item.icon className="w-4 h-4 shrink-0" />
                                <span className="flex-1 truncate">{item.label}</span>
                                <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Link>
                        ))}
                    </div>
                )}

                {/* Core dashboard nav */}
                <p className="px-2 mb-1.5 text-xs font-bold text-slate-500 uppercase tracking-widest">
                    Dashboard
                </p>
                {coreNavItems.map((item) => {
                    const active = isActive(item.href);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group mb-0.5 ${
                                active
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                    : "text-slate-400 hover:bg-slate-700/50 hover:text-white"
                            }`}
                            onClick={() => setMobileOpen(false)}
                        >
                            <item.icon className={`w-4 h-4 shrink-0 ${active ? "text-emerald-400" : ""}`} />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.badge && item.badge > 0 ? (
                                <span className="min-w-5 h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                                    {item.badge > 99 ? "99+" : item.badge}
                                </span>
                            ) : null}
                        </Link>
                    );
                })}
            </div>

            {/* Sign out */}
            <div className="p-3 border-t border-slate-700/50">
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
                        await logoutAction();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all"
                >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                </button>
            </div>
        </div>
    );

    return (
        <>
            {/* ── Desktop Sidebar ──────────────────────────────── */}
            <aside className="hidden lg:flex flex-col w-60 bg-slate-900 border-r border-slate-700/50 fixed inset-y-0 left-0 z-40">
                <NavContent />
            </aside>

            <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-slate-900 border-b border-slate-700/50 px-4 py-3 flex items-center justify-between">
                <Link href="/dashboard" className="flex items-center gap-2">
                    <div className="relative w-8 h-8 bg-white rounded-md flex items-center justify-center p-0.5 shrink-0">
                        <Image 
                            src="/images/logo.jpg" 
                            alt="Easy Sales" 
                            width={28} 
                            height={28} 
                            className="object-contain"
                        />
                    </div>
                </Link>
                <div className="flex items-center gap-3">
                    {(unreadCount > 0 || unreadMessages > 0) && (
                        <div className="relative">
                            <Bell className="w-5 h-5 text-slate-400" />
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                                {Math.min(unreadCount + unreadMessages, 9)}
                            </span>
                        </div>
                    )}
                    <button
                        onClick={() => setMobileOpen(!mobileOpen)}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors"
                        aria-label="Toggle menu"
                    >
                        <div className="space-y-1.5">
                            <span className={`block w-5 h-0.5 bg-current transition-transform ${mobileOpen ? "rotate-45 translate-y-2" : ""}`} />
                            <span className={`block w-5 h-0.5 bg-current transition-opacity ${mobileOpen ? "opacity-0" : ""}`} />
                            <span className={`block w-5 h-0.5 bg-current transition-transform ${mobileOpen ? "-rotate-45 -translate-y-2" : ""}`} />
                        </div>
                    </button>
                </div>
            </header>

            {/* ── Mobile Drawer ────────────────────────────────── */}
            {mobileOpen && (
                <>
                    <div
                        className="lg:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
                        onClick={() => setMobileOpen(false)}
                    />
                    <aside className="lg:hidden fixed top-0 left-0 bottom-0 w-72 bg-slate-900 z-50 flex flex-col border-r border-slate-700/50 shadow-2xl">
                        <NavContent />
                    </aside>
                </>
            )}
        </>
    );
}
