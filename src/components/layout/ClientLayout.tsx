"use client";

import { ReactNode } from "react";
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

    // Register for push notifications once user is authenticated (non-blocking)
    useFCMRegistration();

    // Show push permission banner to authenticated users
    const isAuthenticated = status === "authenticated";

    // Check if current route should have the Sidebar
    // Requirements:
    // 1. User must be authenticated
    // 2. Not on excluded routes (admin, auth, api)
    // 3. Not on a landing page (exact match)
    // 4. Not on any pre-approval flow (onboarding, payment, pending, setup, etc.)
    // 5. User must have an approved role for the module they're accessing

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
    // A JWT role-gate here would hide the sidebar for valid approved users with stale JWTs.
    const shouldShowSidebar =
        status === "authenticated" &&
        session &&
        !noSidebarRoutes.some(route => pathname.startsWith(route)) &&
        !landingPages.includes(pathname) &&
        !isExcludedFlow;

    return (
        <ToastProvider>
            {/* Only show session tracker for authenticated users — never on public pages */}
            {status === "authenticated" && <SessionActivityTracker />}
            <ThemeProvider>
                {shouldShowSidebar ? (
                    <div className="flex h-screen overflow-hidden">
                        <Sidebar />
                        <main className="flex-1 overflow-y-auto bg-slate-50">
                            {children}
                        </main>
                    </div>
                ) : (
                    <>{children}</>
                )}
                <Toaster position="top-right" richColors />
            </ThemeProvider>
            {/* Push notification permission banner — only shows to authenticated users
                who haven't yet granted or denied push permission */}
            {isAuthenticated && <PushNotificationBanner />}
            {/* Module-aware AI chatbot — self-hides on admin/auth routes */}
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
