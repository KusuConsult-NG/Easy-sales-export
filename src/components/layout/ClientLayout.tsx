"use client";

import { ReactNode, useState } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider, useSession } from "next-auth/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { Toaster } from "sonner";

import SessionActivityTracker from "@/components/auth/SessionActivityTracker";
import { ModuleSidebar } from "@/components/layout/ModuleSidebar";
import { FirebaseAuthProvider } from "@/components/providers/FirebaseAuthProvider";
import { useFCMRegistration } from "@/hooks/useFCMRegistration";
import { PushNotificationBanner } from "@/components/notifications/PushNotificationBanner";
import { AiChatWidget } from "@/components/ai/AiChatWidget";
import { Menu } from "lucide-react";
import { getModuleConfig } from "@/lib/module-config";

interface ClientLayoutProps {
    children: ReactNode;
}

/**
 * Determines whether the global ModuleSidebar should be shown.
 *
 * Rules:
 *   "none"   → public pages, auth pages, onboarding flows, the Hub (/dashboard)
 *   "module" → any authenticated module route that passed its server layout guard
 *
 * NOTE: /dashboard has its OWN DashboardNav rendered from within the page —
 * the ClientLayout must NOT add a second sidebar on top of it.
 */
type SidebarMode = "none" | "module";

function getSidebarMode(pathname: string): SidebarMode {
    // Auth, API, public pages
    if (
        pathname.startsWith("/auth") ||
        pathname.startsWith("/api") ||
        pathname.startsWith("/contact") ||
        pathname === "/"
    ) return "none";

    // Hub dashboard and Admin panel render their own custom navigation layouts internally
    if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin") || pathname.startsWith("/messages")) return "none";

    // Module root landing pages (exact match only — not /academy/dashboard)
    const MODULE_ROOTS = [
        "/wave", "/academy", "/cooperatives",
        "/marketplace", "/farm-nation", "/export", "/escrow",
    ];
    if (MODULE_ROOTS.includes(pathname)) return "none";

    // Non-member subpaths: onboarding, payment flows, landing variants
    const NON_MEMBER_PREFIXES = [
        "/wave/landing", "/wave/application", "/wave/briefing", "/wave/access-denied",
        "/academy/landing", "/academy/application", "/academy/payment", "/academy/setup", "/academy/verify",
        "/cooperatives/landing", "/cooperatives/application", "/cooperatives/verify-payment",
        "/marketplace/landing",
        "/farm-nation/landing", "/farm-nation/application",
        "/export/landing", "/export/application",
        // Universal pages without a module context -- content is full-width
        "/profile",
    ];
    if (NON_MEMBER_PREFIXES.some(p => pathname.startsWith(p))) return "none";

    // Generic onboarding/auth flow segments that may appear in any module URL
    if (
        pathname.includes("/login") ||
        pathname.includes("/register") ||
        pathname.includes("/onboarding") ||
        pathname.includes("/pending") ||
        pathname.includes("/join") ||
        pathname.includes("/review-pending") ||
        pathname.includes("/access-denied")
    ) return "none";

    return "module";
}

function LayoutContent({ children }: ClientLayoutProps) {
    const pathname = usePathname();
    const { data: session, status } = useSession();
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    // Register for push notifications once authenticated (non-blocking)
    useFCMRegistration();

    const isAuthenticated = status === "authenticated";
    const mode = getSidebarMode(pathname || "");
    const showSidebar = mode === "module" && isAuthenticated && !!session;

    // Active module info for mobile top bar label
    const activeModule = getModuleConfig(pathname);

    return (
        <ToastProvider>
            {status === "authenticated" && <SessionActivityTracker />}

            <>
                {showSidebar ? (
                    <div className="flex h-screen overflow-hidden">
                        {/* ModuleSidebar — renders desktop aside + mobile drawer internally */}
                        <ModuleSidebar
                            isMobileOpen={isMobileOpen}
                            onMobileClose={() => setIsMobileOpen(false)}
                        />

                        {/* Main content column */}
                        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                            {/* ── Mobile top bar (hamburger) ── lg:hidden */}
                            <header className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-slate-200 bg-white/95 backdrop-blur-sm sticky top-0 z-30 shrink-0">
                                <button
                                    onClick={() => setIsMobileOpen(true)}
                                    className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                    aria-label="Open navigation menu"
                                >
                                    <Menu className="w-5 h-5" />
                                </button>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm text-slate-800">
                                        {activeModule.name || "Easy Sales Export"}
                                    </span>
                                    <span className="text-slate-300">·</span>
                                    <span className="text-xs text-slate-500">{activeModule.description || "Hub"}</span>
                                </div>
                            </header>

                            {/* Page content */}
                            <main className="flex-1 overflow-y-auto bg-slate-50">
                                {children}
                            </main>
                        </div>
                    </div>
                ) : (
                    <>{children}</>
                )}

                <Toaster position="top-right" richColors />
            </>

            {/* Push notification permission banner */}
            {isAuthenticated && <PushNotificationBanner />}

            {/* Module-aware AI chatbot */}
            <AiChatWidget />
        </ToastProvider>
    );
}

export function ClientLayout({ children }: ClientLayoutProps) {
    return (
        <SessionProvider>
            <FirebaseAuthProvider>
                <LayoutContent>{children}</LayoutContent>
            </FirebaseAuthProvider>
        </SessionProvider>
    );
}
