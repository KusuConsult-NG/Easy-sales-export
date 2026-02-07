"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import SessionActivityTracker from "@/components/auth/SessionActivityTracker";
import { Sidebar } from "@/components/layout/Sidebar";

interface ClientLayoutProps {
    children: ReactNode;
}

// Routes that should NOT have the Sidebar (auth pages, landing page, etc.)
const noSidebarRoutes = ['/auth'];

export function ClientLayout({ children }: ClientLayoutProps) {
    const pathname = usePathname();

    // Check if current route should have the Sidebar
    // Auth routes: no sidebar
    // Landing page (/): no sidebar  
    // All other routes: show sidebar
    const shouldShowSidebar = pathname !== '/' && !noSidebarRoutes.some(route => pathname.startsWith(route));

    return (
        <SessionProvider>
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
                </ThemeProvider>
            </ToastProvider>
        </SessionProvider>
    );
}
