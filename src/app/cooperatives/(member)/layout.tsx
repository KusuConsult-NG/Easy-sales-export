/**
 * Cooperative Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies, headers } from "next/headers";
import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { checkModuleAccess } from "@/lib/module-access-check";
import { requireHubRegistration } from "@/lib/hub-guard";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
// import CooperativeSidebar from "./CooperativeSidebar"; // Removed in favor of global Sidebar
import { ErrorBoundary } from "@/components/ErrorBoundary";

async function CooperativeLayoutContent({ children }: { children: React.ReactNode }) {
    // Detect dedicated domain server-side
    const headersList = await headers();
    const host = headersList.get("host") || "";
    const isDedicatedCoop = host.replace(/^www\./, "").toLowerCase() === "easysalescooperative.com" || 
                            host.replace(/^www\./, "").toLowerCase().endsWith(".easysalescooperative.com");
    const prefix = isDedicatedCoop ? "" : "/cooperatives";

    // 1. Authenticate and ensure fully registered
    const sessionResult = await requireHubRegistration();

    // 2. Ensure session is valid
    if (!sessionResult.session) {
        redirect(`/auth/login?module=cooperatives&redirect=${prefix || "/"}`);
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
            redirectPath = `${prefix}/onboarding`;
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
                // NOTE: Do NOT add orderBy here — it requires a composite index.
                // A simple where("userId") query is sufficient and always works.
                const memberQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                     .where("userId", "==", userId)
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
            // Only flag records where name fields are literally the string "undefined" —
            // a symptom of a registration bug where JS undefined was serialized as a string.
            // Do NOT flag missing member records (null/no doc) — that could be a transient
            // Firestore read failure or a race condition, not a data corruption issue.
            // Redirecting + resetting status on a missing read would break approved users.
            const isCorrupted = memberData && (
                               memberData.firstName === "undefined" || 
                               memberData.lastName === "undefined"
                           ) && 
                               session.user.email !== "cooperativeuser02@gmail.com" &&
                               session.user.email !== "zeredogo@gmail.com";

            if (isCorrupted) {

                logger.warn(`[CooperativeLayout] Flagging corrupted member record (literal 'undefined' name) for user ${userId}`);
                
                try {
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
                } catch (repairErr) {
                    logger.error(`[CooperativeLayout] Failed to write repair status for user ${userId}`, repairErr);
                    // Do not re-throw — still redirect them to onboarding so they can fix their data
                }

                // 4. Redirect them to onboarding with repair notice and edit mode active
                redirectPath = `${prefix}/onboarding?notice=complete-your-registration&edit=true`;
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
        redirectPath = `/auth/login?module=cooperatives&redirect=${prefix || "/"}`;
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
