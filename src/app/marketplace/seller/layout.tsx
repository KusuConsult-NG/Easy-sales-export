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
import { auth } from "@/lib/auth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { COLLECTIONS } from "@/lib/types/firestore";

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();

    if (!session?.user?.id) {
        redirect("/marketplace/login");
    }

    try {
        const userId = session.user.id;

        // Layer 1 + 2: JWT roles + Firestore fallback
        const hasAccess = await checkModuleAccess(userId, session.user.roles || [], "marketplace");
        if (!hasAccess) redirect("/marketplace/onboarding");

        // Additional: verify seller approval status (cache-first)
        const { getCached, setCache, CACHE_TTL } = await import("@/lib/redis");
        const cacheKey = `seller:status:${userId}`;

        let sellerStatus = await getCached<{ status: string; businessName?: string }>(cacheKey);

        if (!sellerStatus) {
            const { getAdminDb } = await import("@/lib/firebase-admin");
            const adminDb = getAdminDb();

            try {
                const sellerDoc = await adminDb.collection(COLLECTIONS.MARKETPLACE_SELLERS).doc(userId).get();

                if (sellerDoc.exists) {
                    const sellerData = sellerDoc.data();
                    sellerStatus = {
                        status: sellerData?.status || "pending",
                        businessName: sellerData?.businessName,
                    };
                    await setCache(cacheKey, sellerStatus, CACHE_TTL.USER_PERMISSIONS);
                } else {
                    redirect("/marketplace/onboarding");
                }
            } catch (dbError) {
                logger.error("Failed to check seller status:", dbError);
                redirect("/marketplace/onboarding");
            }
        }

        if (!sellerStatus)                          redirect("/marketplace/onboarding");
        if (sellerStatus.status === "pending")      redirect("/marketplace/onboarding/pending");
        if (sellerStatus.status === "rejected")     redirect("/marketplace/onboarding/rejected");
        if (sellerStatus.status !== "approved")     redirect("/marketplace/onboarding");

    } catch (error) {
        logger.error("Seller access check error:", error);
        redirect("/marketplace/login");
    }

    // No padding offsets — global ModuleSidebar in ClientLayout handles the flex layout
    return (
        <ErrorBoundary>
            <div className="p-4 lg:p-8">{children}</div>
        </ErrorBoundary>
    );
}
