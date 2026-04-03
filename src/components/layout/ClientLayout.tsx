"use client";

import { ReactNode, useState } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider, useSession } from "next-auth/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import SessionActivityTracker from "@/components/auth/SessionActivityTracker";
import { Sidebar } from "@/components/layout/Sidebar";
import { FirebaseAuthProvider } from "@/components/providers/FirebaseAuthProvider";
import { useFCMRegistration } from "@/hooks/useFCMRegistration";
import { PushNotificationBanner } from "@/components/notifications/PushNotificationBanner";
import { AiChatWidget } from "@/components/ai/AiChatWidget";
import { Menu } from "lucide-react";
import { getModuleConfig } from "@/lib/module-config";

interface ClientLayoutProps {
    children: ReactNode;
}

// Routes that should NOT have the global Sidebar (auth pages, landing page, admin, or modules with their own sidebar)
const noSidebarRoutes = [
    '/auth',
    '/contact',
    '/api',
    '/admin',              // Admin has its own layout/sidebar
    '/dashboard',          // Hub dashboard has its own DashboardNav sidebar
    '/farm-nation',        // Farm Nation has its own FarmNationSidebar
    '/marketplace/seller', // Marketplace seller area has its own MarketplaceSidebar
    '/export',             // Export has its own ExportSidebar
    '/academy',            // Academy has its own AcademySidebar
];

// Routes that are strictly landing pages (exact match) where sidebar should be hidden even if authenticated
const landingPages = [
    '/',
    '/wave',
    '/wave/landing',
    '/cooperatives',
    '/cooperatives/landing',
    '/marketplace',
    '/marketplace/landing',
    '/farm-nation',
    '/farm-nation/landing',
    '/academy',
    '/academy/landing',
    '/export',
    '/export/landing',
];

function LayoutContent({ children }: ClientLayoutProps) {
    const pathname = usePathname();
    const { data: session, status } = useSession();
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    // Register for push notifications once user is authenticated (non-blocking)
    useFCMRegistration();

    // Show push permission banner to authenticated users
    const isAuthenticated = status === "authenticated";

    // Pre-approval path segments — sidebar is NEVER shown on these
    const isExcludedFlow =
        pathname.includes('/login') ||
        pathname.includes('/register') ||
        pathname.includes('/onboarding') ||
        pathname.includes('/application') ||   // Wave application steps
        pathname.includes('/join') ||
        pathname.includes('/payment') ||        // Cooperative payment flow
        pathname.includes('/verify-payment') || // Payment verification
        pathname.includes('/pending') ||        // Pending approval pages
        pathname.includes('/pending-payment') ||
        pathname.includes('/review-pending') || // Wave review pending
        pathname.includes('/setup') ||          // Academy setup
        pathname.includes('/access-denied');    // Access denied pages

    // NOTE: We intentionally do NOT gate the sidebar on JWT roles here.
    // Module layouts already enforce access via a two-layer check (JWT + Firestore fallback).
    // If a user has passed the layout guard, they are approved — the sidebar should show.
    const shouldShowSidebar =
        status === "authenticated" &&
        session &&
        !noSidebarRoutes.some(route => pathname.startsWith(route)) &&
        !landingPages.includes(pathname) &&
        !isExcludedFlow;

    // Active module info for mobile top bar
    const activeModule = getModuleConfig(pathname);

    return (
        <ToastProvider>
            {/* Only show session tracker for authenticated users — never on public pages */}
            {status === "authenticated" && <SessionActivityTracker />}
            <ThemeProvider>
                {shouldShowSidebar ? (
                    <div className="flex h-screen overflow-hidden">
                        {/* Desktop sidebar (hidden on mobile — handled inside Sidebar.tsx) */}
                        <Sidebar
                            isMobileOpen={isMobileOpen}
                            onMobileClose={() => setIsMobileOpen(false)}
                        />

                        {/* Main content area */}
                        <div className="flex-1 flex flex-col overflow-hidden">
                            {/* ── Mobile Top Bar ── only visible on < lg ─────── */}
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
            </ThemeProvider>
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
