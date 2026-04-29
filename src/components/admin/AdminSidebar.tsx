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
    GraduationCap,
    FileText,
    TrendingUp,
    ClipboardCheck,
    MessageSquare,
    ShieldAlert,
    ScrollText,
    UserX,
    BadgeCheck,
    ToggleLeft,
    ShieldCheck,
    Headphones,
} from "lucide-react";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useFeatureToggles } from "@/hooks/useFeatureToggle";


const NAV_ITEMS = [
    // ── Core Platform ───────────────────────────────────────────────────────
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard, section: "platform" },
    { label: "Analytics", href: "/admin/analytics", icon: TrendingUp, section: "platform" },
    { label: "User Management", href: "/admin/users", icon: Users, section: "platform" },
    { label: "Content Approval", href: "/admin/content-approval", icon: ClipboardCheck, section: "platform" },
    { label: "Communications", href: "/admin/communications", icon: MessageSquare, section: "platform" },
    { label: "Support Inbox", href: "/admin/messages", icon: Headphones, section: "platform" },
    { label: "Disputes", href: "/admin/disputes", icon: ShieldAlert, section: "platform" },
    { label: "Audit Logs", href: "/admin/audit-logs", icon: ScrollText, section: "platform" },
    { label: "Orphaned Users", href: "/admin/orphaned-users", icon: UserX, section: "platform" },

    { label: "Feature Toggles", href: "/admin/feature-toggles", icon: ToggleLeft, section: "platform" },
    // ── Modules ─────────────────────────────────────────────────────────────
    { label: "WAVE Program", href: "/admin/wave", icon: Waves, section: "modules", featureToggle: "wave_program" },
    { label: "Cooperatives", href: "/admin/cooperatives", icon: Building2, section: "modules", featureToggle: "cooperative_loans" },
    { label: "Marketplace", href: "/admin/marketplace", icon: ShoppingBag, section: "modules" },
    { label: "Escrow Management", href: "/admin/marketplace/escrow", icon: ShieldCheck, section: "modules", featureToggle: "escrow_messaging" },
    { label: "Export Windows", href: "/admin/export", icon: Container, section: "modules" },
    { label: "Export Applications", href: "/admin/export/applications", icon: FileText, section: "modules" },
    { label: "Farm Nation", href: "/admin/farm-nation", icon: Tractor, section: "modules", featureToggle: "farm_nation_purchases" },
    { label: "Academy", href: "/admin/academy", icon: GraduationCap, section: "modules", featureToggle: "academy_courses" },
    // ── Finance & Settings ───────────────────────────────────────────────────
    { label: "Finance", href: "/admin/finance", icon: Wallet, section: "finance" },
    { label: "Settings", href: "/admin/settings", icon: Settings, section: "finance" },
];

export default function AdminSidebar() {
    const pathname = usePathname();
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const toggles = useFeatureToggles(["wave_program", "cooperative_loans", "escrow_messaging", "farm_nation_purchases", "academy_courses", "digital_id_system"]);
    const { data: session } = useSession();
    
    // Role-based UI filtering
    const roles: string[] = (session?.user as any)?.roles || [];
    const isSuperAdmin = roles.includes("super_admin");
    const isFullAdmin = isSuperAdmin || roles.includes("admin");
    
    const isWaveAdmin = roles.includes("wave_admin");
    const isCoopAdmin = roles.includes("cooperative_admin");
    const isMktAdmin = roles.includes("marketplace_admin");
    const isExportAdmin = roles.includes("export_admin");
    const isFarmAdmin = roles.includes("farmnation_admin");
    const isAcadAdmin = roles.includes("academy_admin");

    const isModuleAdmin = isWaveAdmin || isCoopAdmin || isMktAdmin || isExportAdmin || isFarmAdmin || isAcadAdmin;

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
                    <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
                        {(() => {
                            const sections = [
                                { key: "platform", label: "Platform" },
                                { key: "modules", label: "Modules" },
                                { key: "finance", label: "Finance & Settings" },
                            ];
                            return sections.map(({ key, label }) => {
                                const items = NAV_ITEMS.filter(i => i.section === key);
                                return (
                                    <div key={key} className="mb-4">
                                        <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                            {label}
                                        </p>
                                        {items.map((item) => {
                                            if (item.featureToggle && toggles[item.featureToggle] === false) {
                                                return null;
                                            }

                                            // Module-admin UI restriction
                                            if (!isFullAdmin && isModuleAdmin) {
                                                if (item.href !== "/admin") {
                                                    if (isWaveAdmin && !item.href.startsWith("/admin/wave")) return null;
                                                    if (isCoopAdmin && !item.href.startsWith("/admin/cooperatives")) return null;
                                                    if (isMktAdmin && !item.href.startsWith("/admin/marketplace")) return null;
                                                    if (isExportAdmin && !item.href.startsWith("/admin/export")) return null;
                                                    if (isFarmAdmin && !item.href.startsWith("/admin/farm-nation")) return null;
                                                    if (isAcadAdmin && !item.href.startsWith("/admin/academy")) return null;
                                                }
                                            }

                                            const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                                            const Icon = item.icon;
                                            return (
                                                <Link
                                                    key={item.href}
                                                    href={item.href}
                                                    onClick={() => setIsMobileOpen(false)}
                                                    className={`
                                                        flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 text-sm
                                                        ${isActive
                                                            ? "bg-blue-600/15 text-blue-400 font-medium border border-blue-600/20"
                                                            : "hover:bg-slate-800 hover:text-white text-slate-400"
                                                        }
                                                    `}
                                                >
                                                    <Icon size={16} className={isActive ? "text-blue-400" : "text-slate-500"} />
                                                    <span>{item.label}</span>
                                                </Link>
                                            );
                                        })}
                                    </div>
                                );
                            });
                        })()}
                    </nav>

                    {/* Footer / User */}
                    <div className="p-4 border-t border-slate-800">
                        <div className="bg-slate-800/50 rounded-xl p-4 mb-4">
                            <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Signed in as</p>
                            <p className="text-sm font-medium text-white truncate">
                                {isSuperAdmin ? "Super Admin" : isFullAdmin ? "Administrator" : isWaveAdmin ? "WAVE Admin" : isCoopAdmin ? "Coop Admin" : isMktAdmin ? "Marketplace Admin" : isExportAdmin ? "Export Admin" : isFarmAdmin ? "Farm Admin" : isAcadAdmin ? "Academy Admin" : "Moderator"}
                            </p>
                        </div>
                        <button
                            onClick={async () => {
                                // 1. Client-side Firebase Auth cleanup
                                try {
                                    const { signOut: firebaseSignOut } = await import("firebase/auth");
                                    const { auth: firebaseAuth } = await import("@/lib/firebase");
                                    await firebaseSignOut(firebaseAuth);
                                } catch (e) {
                                    console.error("Firebase signout failed", e);
                                }
                                // 2. Clear NextAuth session and redirect to login
                                await signOut({ callbackUrl: "/auth/login" });
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
