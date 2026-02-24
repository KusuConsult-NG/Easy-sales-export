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

interface ClientLayoutProps {
    children: ReactNode;
}

// Routes that should NOT have the Sidebar (auth pages, landing page, etc.)
const noSidebarRoutes = [
    '/auth',
    '/contact',
    '/api',
    '/admin' // Admin has its own layout/sidebar
];

// Routes that are strictly landing pages (exact match) where sidebar should be hidden even if authenticated
const landingPages = [
    '/',
    '/wave',
    '/cooperatives',
    '/marketplace',
    '/farm-nation',
    '/academy',
    '/export',
    '/wave/landing'
];

// Module prefixes that require an approved role before showing the sidebar
// Maps route prefix → required role(s)
const MODULE_ROLE_MAP: Record<string, string[]> = {
    '/cooperatives': ['cooperative_member'],
    '/wave': ['wave_participant'],
    '/export': ['export_participant'],
    '/marketplace': ['buyer', 'seller'],
    '/farm-nation': ['farmer', 'land_owner', 'investor'],
    '/academy': ['academy_participant'],
};

function LayoutContent({ children }: ClientLayoutProps) {
    const pathname = usePathname();
    const { data: session, status } = useSession();

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

    // Role-awareness: hide sidebar if user has no approved role for this module
    const userRoles: string[] = (session?.user?.roles as string[]) || [];
    const moduleEntry = Object.entries(MODULE_ROLE_MAP).find(([prefix]) =>
        pathname.startsWith(prefix)
    );
    const lacksModuleRole = moduleEntry
        ? !moduleEntry[1].some(role => userRoles.includes(role))
        : false;

    const shouldShowSidebar =
        status === "authenticated" &&
        session &&
        !noSidebarRoutes.some(route => pathname.startsWith(route)) &&
        !landingPages.includes(pathname) &&
        !isExcludedFlow &&
        !lacksModuleRole;

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
