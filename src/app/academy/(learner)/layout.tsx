/**
 * Academy Learner Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { redirect } from "next/navigation";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { auth } from "@/lib/auth"; // Use NextAuth session
import { logger } from '@/lib/logger';
import { ErrorBoundary } from "@/components/ErrorBoundary";

import AcademySidebar from "./AcademySidebar";

export default async function AcademyLearnerLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Get NextAuth session
    const session = await auth();

    // Check if user is authenticated
    if (!session?.user?.id) {
        redirect("/academy/login");
    }

    // Verify session and check access
    try {
        const userId = session.user.id;

        const accessResult = await checkServiceAccess(userId, "academy");

        if (!accessResult.hasAccess) {
            redirect(accessResult.redirectTo || "/academy/application");
        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirect("/academy/login");
    }

    return (
        <ErrorBoundary>
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
                <AcademySidebar />

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
