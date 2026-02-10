"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider, useSession } from "next-auth/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/contexts/ThemeContext";
import SessionActivityTracker from "@/components/auth/SessionActivityTracker";
import { Sidebar } from "@/components/layout/Sidebar";

interface ClientLayoutProps {
    children: ReactNode;
}

// Routes that should NOT have the Sidebar (auth pages, landing page, etc.)
const noSidebarRoutes = [
    '/auth',
    '/dashboard',
    '/wave',
    '/cooperatives/landing',
    '/marketplace',
    '/academy',
    '/export',
    '/farm-nation',
    '/contact'
];

function LayoutContent({ children }: ClientLayoutProps) {
    const pathname = usePathname();
    const { data: session, status } = useSession();

    // Check if current route should have the Sidebar
    // Requirements:
    // 1. User must be authenticated (session exists)
    // 2. Not on excluded routes (landing pages, auth, etc.)
    // 3. Not on home page
    const shouldShowSidebar =
        status === "authenticated" &&
        session &&
        pathname !== '/' &&
        !noSidebarRoutes.some(route => pathname.startsWith(route));

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
            <LayoutContent>{children}</LayoutContent>
        </SessionProvider>
    );
}
