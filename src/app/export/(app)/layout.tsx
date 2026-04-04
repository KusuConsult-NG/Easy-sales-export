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
import { auth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default async function ExportAppLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();

    if (!session?.user?.id) {
        redirect("/auth/login?module=export");
    }

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
