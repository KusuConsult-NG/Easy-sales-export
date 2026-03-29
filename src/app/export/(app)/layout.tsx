/**
 * Export Windows Layout with Access Control
 * 
 * Protects all export app routes (dashboard, opportunities, portfolio, transactions)
 * Redirects based on verification status
 */

import { redirect } from "next/navigation";
import { logger } from '@/lib/logger';
import { checkModuleAccess } from "@/lib/module-access-check";
import { auth } from "@/lib/auth"; // Use NextAuth session
import { ErrorBoundary } from "@/components/ErrorBoundary";

import ExportSidebar from "./ExportSidebar";

export default async function ExportAppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Get NextAuth session
    const session = await auth();

    if (!session?.user?.id) {
        redirect("/auth/login?module=export");
    }

    try {
        // Check service access (Layer 1: JWT roles; Layer 2: Firestore fallback for stale JWT)
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "export");

        if (!hasAccess) {
            redirect("/export/onboarding");
        }

    } catch (error) {
        logger.error("Export access check error:", error);
        redirect("/auth/login?module=export");
    }

    // User has access, render the app outside try/catch to satisfy React error-boundaries
    return (
        <ErrorBoundary>
            <div className="min-h-screen bg-slate-50">
                <ExportSidebar />
                <main className="lg:pl-64 min-h-screen transition-all">
                    <div className="p-4 lg:p-8 mt-16 lg:mt-0">
                        {children}
                    </div>
                </main>
            </div>
        </ErrorBoundary>
    );
}
