/**
 * WAVE Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { auth } from "@/lib/auth"; // Use NextAuth session
// import WaveSidebar from "./WaveSidebar"; // Removed in favor of global Sidebar
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default async function WaveMemberLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Get NextAuth session
    const session = await auth();

    // Check if user is authenticated
    if (!session?.user?.id) {
        redirect("/auth/login?module=wave");
    }

    // Verify session and check access
    try {
        const userId = session.user.id;
        const accessResult = await checkServiceAccess(userId, "wave");

        if (!accessResult.hasAccess) {
            redirect(accessResult.redirectTo || "/wave/application");
        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirect("/auth/login?module=wave");
    }

    return (
        <ErrorBoundary>
            <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
                {/* Main Content - Sidebar handled by ClientLayout */}
                <main className="flex-1">
                    <div className="p-4 lg:p-8">
                        {children}
                    </div>
                </main>
            </div>
        </ErrorBoundary>
    );
}
