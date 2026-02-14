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

        // ADDITIONAL CHECK: Verify seller approval status from marketplace_sellers
        const { getAdminDb } = await import("@/lib/firebase-admin");
        const adminDb = getAdminDb();

        try {
            const sellerDoc = await adminDb.collection('marketplace_sellers').doc(userId).get();

            if (sellerDoc.exists) {
                const sellerData = sellerDoc.data();

                // Block pending sellers
                if (sellerData?.status === 'pending') {
                    redirect('/marketplace/onboarding/pending');
                }

                // Block rejected sellers
                if (sellerData?.status === 'rejected') {
                    redirect('/marketplace/onboarding/rejected');
                }

                // Only approved sellers can access dashboard
                if (sellerData?.status !== 'approved') {
                    redirect('/marketplace/onboarding');
                }
            }
        } catch (dbError) {
            console.error("Failed to check seller status:", dbError);
            // Continue - don't block if check fails
        }

        // User has access, render the layout
        return <SellerLayoutContent>{children}</SellerLayoutContent>;
    } catch (error) {
        console.error("Seller access check error:", error);
        redirect("/marketplace/login");
    }
}
