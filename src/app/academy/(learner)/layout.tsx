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

    let redirectPath: string | null = null;
    try {
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "academy");

        if (!hasAccess) {
            redirectPath = "/academy/setup";
        } else {
            // Enforce Payment Integrity Gate
            // Only hard-redirect if the payment check definitively confirms unpaid.
            // If the action fails or returns an unexpected value, allow access so the
            // dashboard can handle the state itself — avoids a redirect loop.
            try {
                const { checkAcademyPaymentStatusAction } = await import("@/app/actions/academy");
                const payStatus = await checkAcademyPaymentStatusAction();
                if (payStatus.success && payStatus.data === "unpaid") {
                    const { isAdmin } = await import("@/lib/admin-permissions");
                    const isUserAdmin = isAdmin(session.user.roles);
                    if (!isUserAdmin) {
                        logger.info(`Forcing unpaid active academy user ${session.user.id} to payment flow.`);
                        redirectPath = "/academy/application";
                    }
                }
            } catch (payError) {
                logger.warn(`[AcademyLayout] Payment check failed for ${session.user.id}, allowing dashboard access: ${(payError as Error)?.message}`);
                // Allow access — the dashboard page will handle the payment state
            }
        }

    } catch (error) {
        logger.error("Session verification failed:", error);
        redirectPath = "/auth/login?module=academy";
    }

    if (redirectPath) {
        redirect(redirectPath);
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
