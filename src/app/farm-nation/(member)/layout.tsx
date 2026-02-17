/**
 * Farm Nation Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { hasAppAccess } from "@/lib/role-app-mapping";
import { auth } from "@/lib/auth"; // Use NextAuth session
import FarmNationSidebar from "./FarmNationSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default async function FarmNationMemberLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Get NextAuth session
    const session = await auth();

    // Check if user is authenticated
    if (!session?.user?.id) {
        redirect("/auth/login?module=farm-nation");
    }

    // Verify session and check access
    try {
        // Check service access
        const hasAccess = hasAppAccess(session.user.roles || [], "farm-nation");

        if (!hasAccess) {
            redirect("/farm-nation/onboarding");
        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirect("/auth/login?module=farm-nation");
    }

    return (
        <ErrorBoundary>
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
                <FarmNationSidebar />

                {/* Main Content - Offset for sidebar */}
                <main className="lg:pl-64 min-h-screen transition-all">
                    <div className="p-4 lg:p-8 mt-16 lg:mt-0">
                        {children}
                    </div>
                </main>
            </div>
        </ErrorBoundary>
    );
}
