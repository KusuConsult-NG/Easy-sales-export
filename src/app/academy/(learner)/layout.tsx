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
import { requireHubRegistration } from "@/lib/hub-guard";
import { logger } from '@/lib/logger';
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function AcademyLayoutContent({ children }: { children: React.ReactNode }) {
    // 1. Authenticate and ensure fully registered
    const sessionResult = await requireHubRegistration();

    // 2. Ensure session is valid
    if (!sessionResult.session) {
        redirect("/auth/login?module=academy");
    }

    const { session } = sessionResult;

    try {
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "academy");

        if (!hasAccess) {
            redirect("/academy/setup");
        }

        // Enforce Payment Integrity Gate
        const { checkAcademyPaymentStatusAction } = await import("@/app/actions/academy");
        const payStatus = await checkAcademyPaymentStatusAction();
        if (payStatus.data === "unpaid") {
            const isAdmin = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin");
            if (!isAdmin) {
                logger.info(`Forcing unpaid active academy user ${session.user.id} to payment flow.`);
                redirect("/academy/application");
            }
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
