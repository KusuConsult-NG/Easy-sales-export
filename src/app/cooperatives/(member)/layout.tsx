/**
 * Cooperative Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { auth } from "@/lib/auth"; // Use NextAuth session
import { getAdminDb } from "@/lib/firebase-admin";
// import CooperativeSidebar from "./CooperativeSidebar"; // Removed in favor of global Sidebar
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default async function CooperativeMemberLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Get NextAuth session
    const session = await auth();

    // Check if user is authenticated
    if (!session?.user?.id) {
        redirect("/cooperatives/login?redirect=/cooperatives");
    }

    let userProfile = {
        firstName: "",
        lastName: "",
        tier: ""
    };

    // Verify session and check access
    try {
        const userId = session.user.id;
        const accessResult = await checkServiceAccess(userId, "cooperative");

        if (!accessResult.hasAccess) {
            redirect(accessResult.redirectTo || "/cooperatives/onboarding");
        }

        // Fetch membership details for Sidebar - CHECK CACHE FIRST
        const { getCached, setCache, CACHE_TTL } = await import("@/lib/redis");
        const cacheKey = `cooperative:member:${userId}`;

        let memberData = await getCached<any>(cacheKey);

        if (!memberData) {
            // Cache miss - fetch from Firestore
            const db = getAdminDb();
            const memberSnapshot = await db.collection("cooperative_members").doc(userId).get();
            if (memberSnapshot.exists) {
                memberData = memberSnapshot.data();
                // Cache for 5 minutes
                await setCache(cacheKey, memberData, CACHE_TTL.USER_PROFILE);
            }
        }

        if (memberData) {
            userProfile = {
                firstName: memberData?.firstName || "",
                lastName: memberData?.lastName || "",
                tier: memberData?.membershipTier || ""
            };
        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirect("/cooperatives/login?redirect=/cooperatives");
    }

    return (
        <ErrorBoundary>
            <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
                {/* Main Content - Sidebar handled by ClientLayout */}
                <main className="flex-1">
                    <div className="p-4 lg:p-8">
                        {children}
                    </div>
                </main>
            </div>
        </ErrorBoundary>
    );
}
