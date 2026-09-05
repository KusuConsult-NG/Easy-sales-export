"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
    Truck,
    Package,
    Activity,
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
    Banknote,
    UserX,
    BadgeCheck,
    ToggleLeft,
    Megaphone,
    ShieldCheck,
    Headphones,
    Stethoscope,
} from "lucide-react";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useFeatureToggles } from "@/hooks/useFeatureToggle";
import { canAccessAdminRoute, hasAdminPermission, isPlatformAdmin, type AdminPermission } from "@/lib/admin-permissions";


const NAV_ITEMS = [
    // ── Core Platform ───────────────────────────────────────────────────────
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard, section: "platform" },
    { label: "Analytics", href: "/admin/analytics", icon: TrendingUp, section: "platform" },
    { label: "User Management", href: "/admin/users", icon: Users, section: "platform", permission: "users:read" as AdminPermission },
    { label: "Content Approval", href: "/admin/content-approval", icon: ClipboardCheck, section: "platform" },
    { label: "Communications", href: "/admin/communications", icon: MessageSquare, section: "platform" },
    { label: "Support Inbox", href: "/admin/messages", icon: Headphones, section: "platform" },
    { label: "Disputes", href: "/admin/disputes", icon: ShieldAlert, section: "platform", permission: "finance:resolve_disputes" as AdminPermission },
    { label: "Audit Logs", href: "/admin/audit-logs", icon: ScrollText, section: "platform", permission: "audit:read" as AdminPermission },
    { label: "Orphaned Users", href: "/admin/orphaned-users", icon: UserX, section: "platform" },

    { label: "Feature Toggles", href: "/admin/feature-toggles", icon: ToggleLeft, section: "platform" },
    /**
     *   #361 /admin/system-health HAD NO REACHABLE LINK ANYWHERE IN THE APP.
     *
     *        The page exists, runs runSystemHealthDiagnostic, and gates itself
     *        on isAdmin. The only thing that named it was
     *        lib/sidebar-config.ts — which is read by components/layout/
     *        Sidebar.tsx, which nothing imports. So the platform diagnostic was
     *        reachable only by typing the URL.
     *
     *        This is the nav table /admin/layout.tsx actually renders.
     */
    { label: "System Health", href: "/admin/system-health", icon: Activity, section: "platform" },
    /**
     *   #266 THE WAY IN FOR THE FORENSIC SCAN.
     *
     *        747 lines of cross-module integrity checking that nothing called.
     *        Four findings in this audit repaired checks inside it that could
     *        never fail (#331, #372, #373, and the phone drift) — repairs no
     *        operator could read, because there was no screen.
     *
     *        `platformOnly` rather than a permission: runForensicScanAction
     *        gates on isPlatformAdmin, and no entry in the permission matrix
     *        means that. The filter below asks THE SAME FUNCTION, so the nav
     *        cannot offer a link the action refuses — #382's rule, applied to
     *        the one audience the matrix does not spell.
     */
    { label: "Forensic Scan", href: "/admin/forensics", icon: Stethoscope, section: "platform", platformOnly: true },
    // Announcements and banners render site-wide via AnnouncementBanner.tsx.
    // The actions existed and the page did not, so the only way to publish was
    // to write to the database by hand.
    { label: "Announcements", href: "/admin/cms", icon: Megaphone, section: "platform", permission: "announcements:manage" as AdminPermission },
    // ── Modules ─────────────────────────────────────────────────────────────
    { label: "WAVE Program", href: "/admin/wave", icon: Waves, section: "modules", featureToggle: "wave_program" },
    { label: "WAVE Shipments", href: "/admin/wave/shipments", icon: Truck, section: "modules", permission: "wave:manage_training" as AdminPermission, featureToggle: "wave_program" },
    { label: "Cooperatives", href: "/admin/cooperatives", icon: Building2, section: "modules", featureToggle: "cooperative_loans" },
    /**
     *   #362 THREE MORE BUILT ADMIN SCREENS THAT NO RENDERED NAV REACHED.
     *
     *        /admin/cooperatives/loan-products  409 lines — and #302 repaired
     *                                           its delete path.
     *        /admin/wave/shipments              803 lines.
     *        /admin/export/catalog              490 lines, and it has its own
     *                                           session gate on top of the
     *                                           admin layout's.
     *
     *        All three were guarded and working; the only thing missing was a
     *        way in. See the recorded list in
     *        src/__tests__/unit/every-screen-has-a-way-in.test.ts.
     */
    { label: "Loan Products", href: "/admin/cooperatives/loan-products", icon: ScrollText, section: "modules", permission: "cooperatives:approve_loans" as AdminPermission, featureToggle: "cooperative_loans" },
    /**
     *   #384 THE BUSINESS LOAN QUEUE. #362 left this one as an owner decision;
     *        the measurement below settles it, so it is wired rather than asked.
     *
     *        LOAN_APPLICATIONS holds two products (#70). /admin/cooperatives/loans
     *        is the COOPERATIVE queue: membership, guarantor, a cap that is a
     *        multiple of savings. /loans/approve is the BUSINESS queue:
     *        collateral and business details, none of that underwriting — and
     *        getPendingLoanApplications filters on `filterByLoanProduct(…,
     *        'business')` precisely so the two do not show each other's rows.
     *
     *        So it is not a duplicate of anything. It is the ONLY screen that
     *        approves a business loan, it is gated on the same permission as the
     *        cooperative queue, and #213 and #286 both repaired logic behind it.
     *        Nothing linked to it, so none of that was reachable.
     *
     *        It keeps its /loans/approve path rather than moving under /admin:
     *        the path is in route-manifest's protected set already, and moving a
     *        route to fix a missing link is a change with more ways to go wrong
     *        than the one being fixed.
     */
    { label: "Business Loans", href: "/loans/approve", icon: Banknote, section: "modules", permission: "cooperatives:approve_loans" as AdminPermission },
    { label: "Marketplace", href: "/admin/marketplace", icon: ShoppingBag, section: "modules" },
    { label: "Escrow Management", href: "/admin/marketplace/escrow", icon: ShieldCheck, section: "modules", featureToggle: "escrow_messaging" },
    { label: "Export Windows", href: "/admin/export", icon: Container, section: "modules", permission: "export:approve_applications" as AdminPermission },
    { label: "Export Applications", href: "/admin/export/applications", icon: FileText, section: "modules", permission: "export:approve_applications" as AdminPermission },
    /**
     * #380 — the way in for the bookings screen. A booking holds volume against
     * a window and nothing could confirm or cancel it, so the capacity was
     * consumed permanently. The screen exists now; #362's ratchet is what makes
     * it have to be linked here rather than becoming the eleventh orphan.
     */
    { label: "Export Bookings", href: "/admin/export/bookings", icon: Container, section: "modules", permission: "export:approve_applications" as AdminPermission },
    { label: "Export Catalog", href: "/admin/export/catalog", icon: Package, section: "modules", permission: "export:approve_applications" as AdminPermission },
    { label: "Farm Nation", href: "/admin/farm-nation", icon: Tractor, section: "modules", featureToggle: "farm_nation_purchases" },
    { label: "Academy", href: "/admin/academy", icon: GraduationCap, section: "modules", permission: "academy:manage_courses" as AdminPermission, featureToggle: "academy_courses" },
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
    /**
     *   #382 THIS BLOCK CALLED ITSELF A PERMISSIONS CHECK AND CHECKED NOTHING.
     *
     *        It read:
     *
     *            // Permissions check for specific sections
     *            const canSeeFinance   = isFullAdmin || isMktAdmin || ...
     *            const canSeeAnalytics = isFullAdmin || isModuleAdmin;
     *            const canSeeUsers     = isFullAdmin || isCoopAdmin || ...
     *
     *        All three, and the `isModuleAdmin` they were built from, were
     *        COMPUTED AND READ BY NOTHING — each name appeared exactly once in
     *        the file, at its own declaration. The whole role model existed to
     *        produce the DISPLAY LABEL below, and the real gate was, and is,
     *        the per-item filter in the nav.
     *
     *        Security-shaped config that gates nothing is #72's defect
     *        (GATED_SEGMENTS: 22 entries and a matcher nothing imported), and
     *        it is worse than no config: `canSeeFinance` reads as a decision
     *        that marketplace, WAVE and cooperative admins may see Finance,
     *        and the live rule refuses all three.
     *
     *        What is left is what the label needs, named for that.
     */
    const isSuperAdmin = roles.includes("super_admin");
    const isFullAdmin = isSuperAdmin || roles.includes("admin");

    const isWaveAdmin = roles.includes("wave_admin");
    const isCoopAdmin = roles.includes("cooperative_admin");
    const isMktAdmin = roles.includes("marketplace_admin");
    const isExportAdmin = roles.includes("export_admin");
    const isFarmAdmin = roles.includes("farm_nation_admin");
    const isAcadAdmin = roles.includes("academy_admin");

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

                                            /**
                                             *   #382 A LINK IS SHOWN WHEN THE
                                             *        CALLER CAN ACTUALLY USE IT.
                                             *
                                             *        This asked canAccessAdminRoute alone — a
                                             *        route-PREFIX and role-NAME rule that had
                                             *        drifted from the permission matrix the
                                             *        actions behind these screens enforce:
                                             *
                                             *          /admin/export was SHOWN to export_admin
                                             *            and its list action refused them;
                                             *          /admin/audit-logs and /admin/users were
                                             *            HIDDEN from roles their actions serve,
                                             *            making the navigation the only gate.
                                             *
                                             *        Where an item names the permission its own
                                             *        actions require, that permission decides —
                                             *        so the sidebar cannot offer what the next
                                             *        screen refuses, or hide what it would serve.
                                             *        It is also the better silo rule: the export
                                             *        queue's permission is exactly the three
                                             *        roles that may work it, which a "/admin/export"
                                             *        prefix cannot express.
                                             *
                                             *        Items with no named permission keep the
                                             *        route rule, unchanged.
                                             */
                                            const mayUse = item.platformOnly
                                                // #266 — the same predicate the action behind it
                                                // asks, for the one audience the permission
                                                // matrix has no entry for.
                                                ? isPlatformAdmin(roles)
                                                : item.permission
                                                    ? hasAdminPermission(roles, item.permission)
                                                    : canAccessAdminRoute(roles, item.href);
                                            if (!mayUse) {
                                                return null;
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
