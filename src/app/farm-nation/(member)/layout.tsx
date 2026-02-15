/**
 * Farm Nation Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { logger } from '@/lib/logger';
import { redirect } from "next/navigation";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { getAuth } from "firebase-admin/auth";
import { initializeApp, getApps } from "firebase-admin/app";
import FarmNationSidebar from "./FarmNationSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default async function FarmNationMemberLayout({
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
        redirect("/farm-nation/login");
    }

    // Verify session and check access
    try {
        const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
        const userId = decodedClaims.uid;

        const accessResult = await checkServiceAccess(userId, "farmNation");

        if (!accessResult.hasAccess) {
            redirect(accessResult.redirectTo || "/farm-nation");
        }
    } catch (error) {
        logger.error("Session verification failed:", error);
        redirect("/farm-nation/login");
    }

    return (
        <ErrorBoundary>
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
                <FarmNationSidebar />

                {/* Main Content - Offset for sidebar */}
                <main className="lg:pl-64 min-h-screen transition-all">
                    <div className="p-4 lg:p-8 mt-16 lg:mt-0">
                        {children}
                    </div>
                </main>
            </div>
        </ErrorBoundary>
    );
}
