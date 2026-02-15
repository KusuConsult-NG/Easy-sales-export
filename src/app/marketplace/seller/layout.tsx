/**
 * Seller Layout with Access Control
 * 
 * Protects seller routes (requires verification) and provides navigation wrapper
 */

import { redirect } from "next/navigation";
import { getAuth } from "firebase-admin/auth";
import { cookies } from "next/headers";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { initializeApp, getApps } from "firebase-admin/app";
import MarketplaceSidebar from "./MarketplaceSidebar";

async function SellerLayoutContent({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <MarketplaceSidebar />

            {/* Main Content */}
            <main className="lg:pl-64 min-h-screen transition-all">
                <div className="p-4 lg:p-8 mt-16 lg:mt-0">
                    {children}
                </div>
            </main>
        </div>
    );
}

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
    // Initialize Firebase Admin if needed
    if (getApps().length === 0) {
        initializeApp();
    }

    const auth = getAuth();

    // Get session cookie
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session")?.value;

    if (!sessionCookie) {
        redirect("/marketplace/login");
    }

    try {
        // Verify session
        const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
        const userId = decodedClaims.uid;

        // Check marketplace access (seller - requires verification)
        const accessResult = await checkServiceAccess(userId, "marketplace");

        if (!accessResult.hasAccess) {
            if (accessResult.redirectTo) {
                redirect(accessResult.redirectTo);
            }
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
                const sellerDoc = await adminDb.collection('marketplace_sellers').doc(userId).get();

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
                console.error("Failed to check seller status:", dbError);
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

        // User has access, render the layout
        return <SellerLayoutContent>{children}</SellerLayoutContent>;
    } catch (error) {
        console.error("Seller access check error:", error);
        redirect("/marketplace/login");
    }
}
