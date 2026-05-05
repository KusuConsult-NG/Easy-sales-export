/**
 * Cooperative Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { checkModuleAccess } from "@/lib/module-access-check";
import { requireHubRegistration } from "@/lib/hub-guard";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
// import CooperativeSidebar from "./CooperativeSidebar"; // Removed in favor of global Sidebar
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function CooperativeLayoutContent({ children }: { children: React.ReactNode }) {
    // 1. Authenticate and ensure fully registered
    const sessionResult = await requireHubRegistration();

    // 2. Ensure session is valid
    if (!sessionResult.session) {
        redirect("/auth/login?module=cooperatives&redirect=/cooperatives");
    }

    const { session } = sessionResult;

    let userProfile = {
        firstName: "",
        lastName: "",
        tier: ""
    };

    let redirectPath: string | null = null;
    // Verify session and check access
    try {
        const userId = session.user.id;
        // Check service access (Layer 1: JWT roles; Layer 2: Firestore fallback for stale JWT)
        const hasAccess = await checkModuleAccess(userId, session.user.roles || [], "cooperatives");

        if (!hasAccess) {
            redirectPath = "/cooperatives/onboarding";
        } else {
            // Fetch membership details for Sidebar - CHECK CACHE FIRST
            const { getCached, setCache, CACHE_TTL } = await import("@/lib/redis");
            const cacheKey = `cooperative:member:${userId}`;

            let memberData = await getCached<any>(cacheKey);

            if (!memberData) {
                // Cache miss - fetch from Firestore
                const db = getAdminDb();
                const memberSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
                if (memberSnapshot.exists) {
                    memberData = memberSnapshot.data();
                    // Cache for 5 minutes
                    await setCache(cacheKey, memberData, CACHE_TTL.USER_PROFILE);
                }
            }

            // --- DATA INTEGRITY GUARD ---
            // If user has the role but NO member record, or the record is corrupted (undefined names)
            // we must send them back to onboarding to complete their profile.
            const isCorrupted = !memberData || 
                               memberData.firstName === "undefined" || 
                               memberData.lastName === "undefined" ||
                               !memberData.firstName || 
                               !memberData.lastName;

            if (isCorrupted) {
                logger.warn(`[CooperativeLayout] Purging corrupted/missing member record for user ${userId}`);
                
                const db = getAdminDb();
                
                // 1. Delete corrupted record if it exists
                if (memberData) {
                    await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).delete();
                }

                // 2. Reset service registration status in USERS collection so checkCooperativeStatusAction sees them as new
                await db.collection(COLLECTIONS.USERS).doc(userId).set({
                    serviceRegistrations: {
                        cooperative: { status: "pending_repair", repairedAt: new Date() },
                        cooperatives: { status: "pending_repair", repairedAt: new Date() }
                    }
                }, { merge: true });

                // 3. Invalidate Redis Cache to reflect the status change
                const { redis, CacheKeys } = await import("@/lib/redis");
                await redis.del(CacheKeys.userProfile(userId));

                redirectPath = "/cooperatives/onboarding?notice=complete-your-registration";
            } else {
                userProfile = {
                    firstName: memberData.firstName,
                    lastName: memberData.lastName,
                    tier: memberData.membershipTier || "Member"
                };
            }

        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirectPath = "/auth/login?module=cooperatives&redirect=/cooperatives";
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

export default function CooperativeMemberLayout({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <CooperativeLayoutContent>{children}</CooperativeLayoutContent>
        </ErrorBoundary>
    );
}
