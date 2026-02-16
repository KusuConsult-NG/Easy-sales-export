/**
 * Buyer Layout with Access Control
 * 
 * Protects buyer routes and provides navigation wrapper
 */

import { redirect } from "next/navigation";
import { logger } from '@/lib/logger';
import { checkServiceAccess } from "@/lib/auth/service-access";
import { auth } from "@/lib/auth"; // Use NextAuth session
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function BuyerLayoutContent({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
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
        redirect("/marketplace/login");
    }

    try {
        const userId = session.user.id;

        // Check marketplace access (buyer)
        const accessResult = await checkServiceAccess(userId, "marketplace");

        if (!accessResult.hasAccess) {
            if (accessResult.redirectTo) {
                redirect(accessResult.redirectTo);
            }
            redirect("/marketplace/onboarding");
        }

        // User has access, render the layout
        return <BuyerLayoutContent>{children}</BuyerLayoutContent>;
    } catch (error) {
        logger.error("Buyer access check error:", error);
        redirect("/marketplace/login");
    }
}
