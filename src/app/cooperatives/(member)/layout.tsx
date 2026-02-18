/**
 * Cooperative Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { hasAppAccess } from "@/lib/role-app-mapping";
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
        redirect("/auth/login?module=cooperatives&redirect=/cooperatives");
    }

    let userProfile = {
        firstName: "",
        lastName: "",
        tier: ""
    };

    // Verify session and check access
    try {
        const userId = session.user.id;
        // Check service access
        const hasAccess = hasAppAccess(session.user.roles || [], "cooperatives");

        if (!hasAccess) {
            redirect("/cooperatives/onboarding");
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
        redirect("/auth/login?module=cooperatives&redirect=/cooperatives");
    }

    return (
        <ErrorBoundary>
            <div className="flex min-h-screen bg-slate-50">
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
