/**
 * Academy Learner Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { redirect } from "next/navigation";
import { hasAppAccess } from "@/lib/role-app-mapping";
import { auth } from "@/lib/auth"; // Use NextAuth session
import { logger } from '@/lib/logger';
import { ErrorBoundary } from "@/components/ErrorBoundary";

import AcademySidebar from "./AcademySidebar";

async function AcademyLayoutContent({ children }: { children: React.ReactNode }) {
    // Get NextAuth session
    const session = await auth();

    // Check if user is authenticated
    if (!session?.user?.id) {
        redirect("/auth/login?module=academy");
    }

    // Verify session and check access
    try {
        // Check service access
        const hasAccess = hasAppAccess(session.user.roles || [], "academy");

        if (!hasAccess) {
            redirect("/academy/setup");
        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirect("/auth/login?module=academy");
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <AcademySidebar />

            {/* Main Content - Offset for sidebar */}
            <main className="lg:pl-64 min-h-screen transition-all">
                <div className="p-4 lg:p-8 mt-16 lg:mt-0">
                    {children}
                </div>
            </main>
        </div>
    );
}

export default function AcademyLearnerLayout({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <AcademyLayoutContent>{children}</AcademyLayoutContent>
        </ErrorBoundary>
    );
}
