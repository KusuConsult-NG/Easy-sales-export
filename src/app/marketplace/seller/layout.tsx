/**
 * Seller Layout with Access Control
 * 
 * Protects seller routes (requires verification) and provides navigation wrapper
 */

import { redirect } from "next/navigation";
import { logger } from '@/lib/logger';
import { checkModuleAccess } from "@/lib/module-access-check";
import { auth } from "@/lib/auth"; // Use NextAuth session
import MarketplaceSidebar from "./MarketplaceSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { COLLECTIONS } from "@/lib/types/firestore";

function SellerLayoutContent({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <div className="min-h-screen bg-slate-50">
                <MarketplaceSidebar />

                {/* Main Content */}
                <main className="lg:pl-64 min-h-screen transition-all">
                    <div className="p-4 lg:p-8 mt-16 lg:mt-0">
                        {children}
                    </div>
                </main>
            </div>
        </ErrorBoundary>
    );
}

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
    // Get NextAuth session
    const session = await auth();

    if (!session?.user?.id) {
        redirect("/marketplace/login");
    }

    try {
        const userId = session.user.id;

        // Check service access (Layer 1: JWT roles; Layer 2: Firestore fallback for stale JWT)
        const hasAccess = await checkModuleAccess(userId, session.user.roles || [], "marketplace");

        if (!hasAccess) {
            redirect("/marketplace/onboarding");
        }

        // ADDITIONAL CHECK: Verify seller approval status - CHECK CACHE FIRST
        const { getCached, setCache, CacheKeys, CACHE_TTL } = await import("@/lib/redis");
        const cacheKey = `seller:status:${userId}`;

        let sellerStatus = await getCached<{ status: string; businessName?: string }>(cacheKey);

        if (!sellerStatus) {
            // Cache miss - fetch from Firestore
            const { getAdminDb } = await import("@/lib/firebase-admin");
            const adminDb = getAdminDb();

            try {
                const sellerDoc = await adminDb.collection(COLLECTIONS.MARKETPLACE_SELLERS).doc(userId).get();

                if (sellerDoc.exists) {
                    const sellerData = sellerDoc.data();
                    sellerStatus = {
                        status: sellerData?.status || 'pending',
                        businessName: sellerData?.businessName,
                    };

                    // Cache for 2 minutes
                    await setCache(cacheKey, sellerStatus, CACHE_TTL.USER_PERMISSIONS);
                } else {
                    // If sellerDoc does not exist, redirect to onboarding
                    redirect('/marketplace/onboarding');
                }
            } catch (dbError) {
                logger.error("Failed to check seller status:", dbError);
                // If DB check fails, treat as no status found, redirect to onboarding
                redirect('/marketplace/onboarding');
            }
        }

        // Now, apply status checks using sellerStatus (from cache or Firestore)
        if (!sellerStatus) {
            // This case should ideally be handled by the 'else' block above,
            // but as a fallback if sellerStatus is still null/undefined after cache/DB check
            redirect('/marketplace/onboarding');
        }

        // Block pending sellers
        if (sellerStatus.status === 'pending') {
            redirect('/marketplace/onboarding/pending');
        }

        // Block rejected sellers
        if (sellerStatus.status === 'rejected') {
            redirect('/marketplace/onboarding/rejected');
        }

        // Only approved sellers can access dashboard
        if (sellerStatus.status !== 'approved') {
            redirect('/marketplace/onboarding');
        }

    } catch (error) {
        logger.error("Seller access check error:", error);
        redirect("/marketplace/login");
    }

    // User has access, render the layout outside of the try/catch to satisfy React error-boundary rules
    return <SellerLayoutContent>{children}</SellerLayoutContent>;
}
