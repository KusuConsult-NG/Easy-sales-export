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
    '/export'
];

function LayoutContent({ children }: ClientLayoutProps) {
    const pathname = usePathname();
    const { data: session, status } = useSession();

    // Check if current route should have the Sidebar
    // Requirements:
    // 1. User must be authenticated
    // 2. Not on excluded routes
    // 3. Not on a landing page (exact match)
    const shouldShowSidebar =
        status === "authenticated" &&
        session &&
        !noSidebarRoutes.some(route => pathname.startsWith(route)) &&
        !landingPages.includes(pathname);

    return (
        <ToastProvider>
            <SessionActivityTracker />
            <ThemeProvider>
                {shouldShowSidebar ? (
                    <div className="flex h-screen overflow-hidden">
                        <Sidebar />
                        <main className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
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
