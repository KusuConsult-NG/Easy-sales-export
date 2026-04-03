/**
 * Academy Learner Layout
 *
 * Protected layout with server-side access control.
 * Navigation is handled by the global Sidebar (ClientLayout.tsx).
 * AcademySidebar removed — global Sidebar has all academy nav items
 * via MODULE_NAVIGATION["academy"] in sidebar-config.ts.
 */

import { redirect } from "next/navigation";
import { checkModuleAccess } from "@/lib/module-access-check";
import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function AcademyLayoutContent({ children }: { children: React.ReactNode }) {
    const session = await auth();

    if (!session?.user?.id) {
        redirect("/auth/login?module=academy");
    }

    try {
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "academy");

        if (!hasAccess) {
            redirect("/academy/setup");
        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirect("/auth/login?module=academy");
    }

    return (
        // No padding offset needed — global Sidebar in ClientLayout handles the flex layout
        <div className="p-4 lg:p-8">
            {children}
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
