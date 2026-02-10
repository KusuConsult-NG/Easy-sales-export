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

async function SellerLayoutContent({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Main Content - Full Width */}
            <main className="w-full">
                {children}
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
        redirect("/auth/login");
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

        // User has access, render the layout
        return <SellerLayoutContent>{children}</SellerLayoutContent>;
    } catch (error) {
        console.error("Seller access check error:", error);
        redirect("/auth/login");
    }
}
