/**
 * Export Windows Layout with Access Control
 * 
 * Protects all export app routes (dashboard, opportunities, portfolio, transactions)
 * Redirects based on verification status
 */

import { redirect } from "next/navigation";
import { logger } from '@/lib/logger';
import { checkServiceAccess } from "@/lib/auth/service-access";
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
        const userId = session.user.id;

        // Check service access
        const accessResult = await checkServiceAccess(userId, "export");

        if (!accessResult.hasAccess) {
            // Redirect to appropriate page based on status
            if (accessResult.redirectTo) {
                redirect(accessResult.redirectTo);
            }
            redirect("/export");
        }

        // User has access, render the app
        return (
            <ErrorBoundary>
                <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
                    <ExportSidebar />
                    <main className="lg:pl-64 min-h-screen transition-all">
                        <div className="p-4 lg:p-8 mt-16 lg:mt-0">
                            {children}
                        </div>
                    </main>
                </div>
            </ErrorBoundary>
        );
    } catch (error) {
        logger.error("Export access check error:", error);
        redirect("/auth/login?module=export");
    }
}
