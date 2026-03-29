/**
 * Buyer Layout with Access Control
 * 
 * Protects buyer routes and provides navigation wrapper
 */

import { redirect } from "next/navigation";
import { logger } from '@/lib/logger';
import { checkModuleAccess } from "@/lib/module-access-check";
import { auth } from "@/lib/auth"; // Use NextAuth session
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
    // Get NextAuth session
    const session = await auth();

    if (!session?.user?.id) {
        redirect("/auth/login?module=marketplace");
    }

    try {
        // Check service access (Layer 1: JWT roles; Layer 2: Firestore fallback for stale JWT)
        const hasAccess = await checkModuleAccess(session.user.id, session.user.roles || [], "marketplace");

        if (!hasAccess) {
            redirect("/marketplace/onboarding");
        }

    } catch (error) {
        logger.error("Buyer access check error:", error);
        redirect("/auth/login?module=marketplace");
    }

    // User has access, render the layout outside try/catch to satisfy React error-boundaries
    return <BuyerLayoutContent>{children}</BuyerLayoutContent>;
}
