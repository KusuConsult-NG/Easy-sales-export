/**
 * Export Windows Layout with Access Control
 *
 * Protects all export app routes (dashboard, opportunities, portfolio, transactions).
 * Navigation is handled by the global ModuleSidebar (ClientLayout.tsx).
 * ExportSidebar removed — global ModuleSidebar renders Export nav items
 * automatically when pathname starts with /export.
 */

import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";
import { checkModuleAccess } from "@/lib/module-access-check";
import { requireHubRegistration } from "@/lib/hub-guard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default async function ExportAppLayout({ children }: { children: React.ReactNode }) {
    // 1. Authenticate and ensure fully registered
    const sessionResult = await requireHubRegistration();

    // 2. Ensure session is valid
    if (!sessionResult.session) {
        redirect("/auth/login?module=export");
    }

    const { session } = sessionResult;

    try {
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "export");
        if (!hasAccess) redirect("/export/onboarding");
    } catch (error) {
        logger.error("Export access check error:", error);
        redirect("/auth/login?module=export");
    }

    // No padding offset — global ModuleSidebar in ClientLayout handles the flex layout
    return (
        <ErrorBoundary>
            <div className="p-4 lg:p-8">{children}</div>
        </ErrorBoundary>
    );
}
