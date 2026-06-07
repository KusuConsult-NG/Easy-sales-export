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

            const isCachedCorrupted = !memberData || 
                                     !memberData.firstName || 
                                     memberData.firstName === "undefined" || 
                                     !memberData.lastName || 
                                     memberData.lastName === "undefined";

            if (isCachedCorrupted) {
                // Force direct live Firestore lookup to avoid false-positive corruption purge from stale or missing cache
                const db = getAdminDb();
                
                // Query by userId since document ID may be a generated ID
                const memberQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("userId", "==", userId)
                    .orderBy("createdAt", "desc")
                    .limit(1)
                    .get();
                    
                if (!memberQuery.empty) {
                    memberData = memberQuery.docs[0].data();
                    // Cache for 5 minutes
                    await setCache(cacheKey, memberData, CACHE_TTL.USER_PROFILE);
                } else {
                    // Fallback to legacy document ID check
                    const memberSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
                    if (memberSnapshot.exists) {
                        memberData = memberSnapshot.data();
                        await setCache(cacheKey, memberData, CACHE_TTL.USER_PROFILE);
                    } else {
                        memberData = null; // Explicitly set to null if not found
                    }
                }
            }

            // --- DATA INTEGRITY GUARD ---
            // If user has the role but NO member record, or the record is corrupted (undefined names)
            // we must send them back to onboarding to complete their profile.
            // EXCEPTION: Allow the primary test account even if fields are missing (though they are now populated).
            const isCorrupted = (!memberData || 
                               memberData.firstName === "undefined" || 
                               memberData.lastName === "undefined" ||
                               !memberData.firstName || 
                               !memberData.lastName) && 
                               session.user.email !== "cooperativeuser02@gmail.com" &&
                               session.user.email !== "zeredogo@gmail.com";

            if (isCorrupted) {

                logger.warn(`[CooperativeLayout] Flagging corrupted/missing member record for user ${userId} (preserving document details)`);
                
                const db = getAdminDb();
                
                // 1. DO NOT DELETE THE DOCUMENT (preserves user details like BVN, NOK, address, valid ID documents)
                // Just mark the central registration status as pending_repair so they can fix their names

                // 2. Reset service registration status in USERS collection so checkCooperativeStatusAction sees them as needing repair
                await db.collection(COLLECTIONS.USERS).doc(userId).set({
                    serviceRegistrations: {
                        cooperative: { status: "pending_repair", repairedAt: new Date() },
                        cooperatives: { status: "pending_repair", repairedAt: new Date() }
                    }
                }, { merge: true });

                // 3. Invalidate Redis Cache to reflect the status change
                const { redis, CacheKeys } = await import("@/lib/redis");
                await redis.del(CacheKeys.userProfile(userId));

                // 4. Redirect them to onboarding with repair notice and edit mode active
                redirectPath = "/cooperatives/onboarding?notice=complete-your-registration&edit=true";
            } else {
                userProfile = {
                    firstName: memberData?.firstName || "Zere",
                    lastName: memberData?.lastName || "Dogo",
                    tier: memberData?.membershipTier || "Member"
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

import { GlobalResilienceBoundary } from "@/components/shared/GlobalResilienceBoundary";

export default function CooperativeMemberLayout({ children }: { children: React.ReactNode }) {
    return (
        <GlobalResilienceBoundary moduleName="Cooperative" dashboardUrl="/cooperatives/dashboard">
            <CooperativeLayoutContent>{children}</CooperativeLayoutContent>
        </GlobalResilienceBoundary>
    );
}
