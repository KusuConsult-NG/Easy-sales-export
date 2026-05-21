/**
 * Seller Layout with Access Control
 *
 * Protects seller routes (requires seller approval).
 * Navigation is handled by the global ModuleSidebar (ClientLayout.tsx).
 * MarketplaceSidebar removed — global ModuleSidebar renders Marketplace nav
 * items automatically when pathname starts with /marketplace.
 */

import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";
import { checkModuleAccess } from "@/lib/module-access-check";
import { requireHubRegistration } from "@/lib/hub-guard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { COLLECTIONS } from "@/lib/types/firestore";

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
    // 1. Authenticate and ensure fully registered
    const sessionResult = await requireHubRegistration();

    // 2. Ensure session is valid
    if (!sessionResult.session) {
        redirect("/marketplace/login");
    }

    const { session } = sessionResult;

    let redirectPath: string | null = null;
    try {
        const userId = session.user.id;

        // Layer 1 + 2: JWT roles + Firestore fallback
        const hasAccess = await checkModuleAccess(userId, session.user.roles || [], "marketplace");
        const { isAdmin } = await import("@/lib/admin-permissions");
        const isUserAdmin = isAdmin(session.user.roles);

        if (!hasAccess && !isUserAdmin) {
            redirectPath = "/marketplace/onboarding";
        } else if (isUserAdmin) {
            // Admins bypass seller status checks
            redirectPath = null;
        } else {
            // Additional: verify seller approval status (cache-first)
            const { getCached, setCache, CACHE_TTL } = await import("@/lib/redis");
            const cacheKey = `seller:status:${userId}`;

            let sellerStatus = await getCached<{ status: string; businessName?: string }>(cacheKey);

            // If the cached status is not approved, we should verify live Firestore status before redirecting to avoid infinite loops from stale cache.
            if (!sellerStatus || sellerStatus.status !== "approved") {
                const { getAdminDb } = await import("@/lib/firebase-admin");
                const adminDb = getAdminDb();

                try {
                    const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(userId).get();
                    const userData = userDoc.data();
                    const registration = userData?.serviceRegistrations?.marketplace;

                    let liveStatus: { status: string; businessName?: string } | null = null;

                    if (registration?.status) {
                        liveStatus = {
                            status: registration.status,
                            businessName: userData?.businessName,
                        };
                    } else {
                        // Fallback: query SELLER_VERIFICATIONS by userId field
                        const verSnap = await adminDb
                            .collection(COLLECTIONS.SELLER_VERIFICATIONS)
                            .where("userId", "==", userId)
                            .get();

                        if (!verSnap.empty) {
                            const sortedDocs = verSnap.docs.map(d => d.data()).sort((a: any, b: any) => {
                                const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
                                const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
                                return bTime - aTime;
                            });
                            const verData = sortedDocs[0];
                            liveStatus = {
                                status: verData?.status || "pending",
                                businessName: verData?.businessName,
                            };
                        }
                    }

                    if (liveStatus) {
                        sellerStatus = liveStatus;
                        await setCache(cacheKey, sellerStatus, CACHE_TTL.USER_PERMISSIONS);
                    } else if (!sellerStatus) {
                        redirectPath = "/marketplace/onboarding";
                    }
                } catch (dbError) {
                    logger.error("Failed to check live seller status:", dbError);
                    if (!sellerStatus) {
                        redirectPath = "/marketplace/onboarding";
                    }
                }
            }

            if (!redirectPath) {
                if (!sellerStatus)                          redirectPath = "/marketplace/onboarding";
                else if (sellerStatus.status === "pending")      redirectPath = "/marketplace/onboarding/pending";
                else if (sellerStatus.status === "rejected")     redirectPath = "/marketplace/onboarding/rejected";
                else if (sellerStatus.status !== "approved")     redirectPath = "/marketplace/onboarding";
            }
        }
    } catch (error) {
        logger.error("Seller access check error:", error);
        redirectPath = "/marketplace/login";
    }

    if (redirectPath) {
        redirect(redirectPath);
    }

    // No padding offsets — global ModuleSidebar in ClientLayout handles the flex layout
    return (
        <ErrorBoundary>
            <div className="p-4 lg:p-8">{children}</div>
        </ErrorBoundary>
    );
}
