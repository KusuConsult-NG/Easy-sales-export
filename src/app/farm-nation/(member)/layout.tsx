/**
 * Farm Nation Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { checkModuleAccess } from "@/lib/module-access-check";
import { auth } from "@/lib/auth"; // Use NextAuth session
import FarmNationSidebar from "./FarmNationSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function FarmNationLayoutContent({ children }: { children: React.ReactNode }) {
    // Get NextAuth session
    const session = await auth();

    // Check if user is authenticated
    if (!session?.user?.id) {
        redirect("/auth/login?module=farm-nation");
    }

    // Verify session and check access (Layer 1: JWT roles; Layer 2: Firestore fallback for stale JWT)
    try {
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "farm-nation");

        if (!hasAccess) {
            redirect("/farm-nation/onboarding");
        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirect("/auth/login?module=farm-nation");
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <FarmNationSidebar />

            {/* Main Content - Offset for sidebar */}
            <main className="lg:pl-64 min-h-screen transition-all">
                <div className="p-4 lg:p-8 mt-16 lg:mt-0">
                    {children}
                </div>
            </main>
        </div>
    );
}

export default function FarmNationMemberLayout({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <FarmNationLayoutContent>{children}</FarmNationLayoutContent>
        </ErrorBoundary>
    );
}
