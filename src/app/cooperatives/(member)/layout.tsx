/**
 * Cooperative Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { getAuth } from "firebase-admin/auth";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAdminDb } from "@/lib/firebase-admin";
import CooperativeSidebar from "./CooperativeSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default async function CooperativeMemberLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Initialize Firebase Admin if needed
    if (getApps().length === 0) {
        initializeApp();
    }

    const auth = getAuth();

    // Get session cookie
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session")?.value;

    // Check if user is authenticated
    if (!sessionCookie) {
        redirect("/cooperatives/login?redirect=/cooperatives");
    }

    let userProfile = {
        firstName: "",
        lastName: "",
        tier: ""
    };

    // Verify session and check access
    try {
        const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
        const userId = decodedClaims.uid;

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
                {/* Sidebar */}
                <CooperativeSidebar user={userProfile} />

                {/* Main Content */}
                <main className="flex-1 lg:ml-64">
                    <div className="p-4 lg:p-8">
                        {children}
                    </div>
                </main>
            </div>
        </ErrorBoundary>
    );
}
