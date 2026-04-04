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
import { auth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function FarmNationLayoutContent({ children }: { children: React.ReactNode }) {
    const session = await auth();

    if (!session?.user?.id) {
        redirect("/auth/login?module=farm-nation");
    }

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
