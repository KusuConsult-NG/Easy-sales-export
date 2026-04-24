/**
 * Farm Nation Member Layout
 *
 * Protected layout with server-side access control.
 * Navigation is handled by the global ModuleSidebar (ClientLayout.tsx).
 * FarmNationSidebar removed — global ModuleSidebar renders the Farm Nation
 * nav items automatically when pathname starts with /farm-nation.
 */

import { logger } from "@/lib/logger";
import { redirect } from "next/navigation";
import { checkModuleAccess } from "@/lib/module-access-check";
import { requireHubRegistration } from "@/lib/hub-guard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function FarmNationLayoutContent({ children }: { children: React.ReactNode }) {
    // 1. Authenticate and ensure fully registered
    const sessionResult = await requireHubRegistration();

    // 2. Ensure session is valid
    if (!sessionResult.session) {
        redirect("/auth/login?module=farm-nation");
    }

    const { session } = sessionResult;

    try {
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "farm-nation");
        if (!hasAccess) redirect("/farm-nation/onboarding");
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirect("/auth/login?module=farm-nation");
    }

    // No padding offset — global ModuleSidebar in ClientLayout handles the flex layout
    return <div className="p-4 lg:p-8">{children}</div>;
}

export default function FarmNationMemberLayout({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <FarmNationLayoutContent>{children}</FarmNationLayoutContent>
        </ErrorBoundary>
    );
}
