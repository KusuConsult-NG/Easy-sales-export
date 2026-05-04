/**
 * WAVE Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { checkModuleAccess } from "@/lib/module-access-check";
import { requireHubRegistration } from "@/lib/hub-guard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function WaveLayoutContent({ children }: { children: React.ReactNode }) {
    // 1. Authenticate and ensure fully registered
    const sessionResult = await requireHubRegistration();

    // 2. Ensure session is valid
    if (!sessionResult.session) {
        redirect("/auth/login?module=wave");
    }

    const { session } = sessionResult;

    let redirectPath: string | null = null;
    // Verify session and check access (Layer 1: JWT roles; Layer 2: Firestore fallback for stale JWT)
    try {
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "wave");

        if (!hasAccess) {
            redirectPath = "/wave/application";
        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirectPath = "/auth/login?module=wave";
    }

    if (redirectPath) {
        redirect(redirectPath);
    }

    return (
        <div className="p-4 lg:p-8">
            {children}
        </div>
    );
}

export default function WaveMemberLayout({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <WaveLayoutContent>{children}</WaveLayoutContent>
        </ErrorBoundary>
    );
}
