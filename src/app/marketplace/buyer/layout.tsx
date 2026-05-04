/**
 * Buyer Layout with Access Control
 * 
 * Protects buyer routes and provides navigation wrapper
 */

import { redirect } from "next/navigation";
import { logger } from '@/lib/logger';
import { checkModuleAccess } from "@/lib/module-access-check";
import { requireHubRegistration } from "@/lib/hub-guard";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function BuyerLayoutContent({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <div className="min-h-screen bg-slate-50">
                {/* Main Content - Full Width */}
                <main className="w-full">
                    {children}
                </main>
            </div>
        </ErrorBoundary>
    );
}

export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
    // 1. Authenticate and ensure fully registered
    const sessionResult = await requireHubRegistration();

    // 2. Ensure session is valid
    if (!sessionResult.session) {
        redirect("/auth/login?module=marketplace");
    }

    const { session } = sessionResult;

    let redirectPath: string | null = null;
    try {
        // Check service access (Layer 1: JWT roles; Layer 2: Firestore fallback for stale JWT)
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "marketplace");

        if (!hasAccess) {
            redirectPath = "/marketplace/onboarding";
        }

    } catch (error) {
        logger.error("Buyer access check error:", error);
        redirectPath = "/auth/login?module=marketplace";
    }

    if (redirectPath) {
        redirect(redirectPath);
    }

    // User has access, render the layout outside try/catch to satisfy React error-boundaries
    return <BuyerLayoutContent>{children}</BuyerLayoutContent>;
}
