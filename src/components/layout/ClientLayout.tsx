"use client";

import { ReactNode, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider, useSession } from "next-auth/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { Toaster } from "sonner";

import SessionActivityTracker from "@/components/auth/SessionActivityTracker";
import SessionGuard from "@/components/auth/SessionGuard";
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
        "/marketplace", "/farm-nation", "/export",
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

    /**
     * WAIT FOR THE SESSION BEFORE MOUNTING A MODULE PAGE.
     *
     * `children` appears in TWO different places below — inside the sidebar's
     * nested flex column when showSidebar is true, and bare in a fragment when
     * it is false. React reconciles by position, so the moment showSidebar
     * flips, the entire page subtree is UNMOUNTED and a fresh one mounted.
     *
     * useSession starts at "loading" and resolves a beat later, so on every
     * module page that flip happens shortly after first paint — and every
     * component below loses its state.
     *
     * What that did to users: anything typed before the session settled was
     * silently wiped. Measured on /farm-nation/list-land, filling the form as
     * fast as a script can: the title, description and state fields were empty
     * by the time Submit was pressed, while later fields survived — the
     * signature of one remount partway through. The land listing form then
     * refused to submit with no message at all, because an empty `required`
     * title fails HTML5 validation and the browser blocks submit before
     * handleSubmit ever runs. The same remount re-initialises react-hook-form
     * from its defaults, which is what put 10000 back in the loan wizard's
     * amount field mid-test.
     *
     * On a slow connection the window is wider, so a real seller is MORE
     * likely to hit it than the test was.
     *
     * Gated on module pages only. Public and auth pages keep rendering
     * immediately — they do not depend on the session for their layout, so
     * there is no flip to wait for and no reason to delay first paint.
     */
    const awaitingSessionForModulePage = mode === "module" && status === "loading";

    return (
        <ToastProvider>
            {status === "authenticated" && <SessionActivityTracker />}
            <SessionGuard />

            <>
                {awaitingSessionForModulePage ? (
                    <div className="flex h-screen items-center justify-center bg-slate-50">
                        <div
                            className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"
                            role="status"
                            aria-label="Loading"
                        />
                    </div>
                ) : showSidebar ? (
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
    // Listen for deployment skew / Server Action hash mismatch errors globally
    useEffect(() => {
        // Throttle: only allow one auto-reload per 10 seconds to prevent infinite loops.
        // If the reload itself triggers the same error, we will not loop.
        const RELOAD_COOLDOWN_MS = 10_000;
        const safeReload = () => {
            const lastReload = parseInt(sessionStorage.getItem("_last_skew_reload") || "0", 10);
            const now = Date.now();
            if (now - lastReload > RELOAD_COOLDOWN_MS) {
                sessionStorage.setItem("_last_skew_reload", String(now));
                window.location.reload();
            } else {
                console.warn("[ClientLayout] Reload throttled — skipping to prevent infinite loop.");
            }
        };

        const handleActionMismatch = (message: string) => {
            const isActionMismatch = 
                (message.includes("Failed to execute Server Action") || message.includes("Action ID")) && 
                message.includes("could not be found");
            if (isActionMismatch) {
                safeReload();
            }
        };

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const message = reason?.message || (typeof reason === "string" ? reason : "");
            handleActionMismatch(message);
        };

        const handleError = (event: ErrorEvent) => {
            const message = event.message || "";
            handleActionMismatch(message);
        };

        window.addEventListener("unhandledrejection", handleUnhandledRejection);
        window.addEventListener("error", handleError);

        return () => {
            window.removeEventListener("unhandledrejection", handleUnhandledRejection);
            window.removeEventListener("error", handleError);
        };
    }, []);

    return (
        <SessionProvider>
            <FirebaseAuthProvider>
                <LayoutContent>{children}</LayoutContent>
            </FirebaseAuthProvider>
        </SessionProvider>
    );
}
