/**
 * Cooperative Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { getAuth } from "firebase-admin/auth";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAdminDb } from "@/lib/firebase-admin";
import CooperativeSidebar from "./CooperativeSidebar";

export default async function CooperativeMemberLayout({
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
        redirect("/auth/login?redirect=/cooperatives");
    }

    let userProfile = {
        firstName: "",
        lastName: "",
        tier: ""
    };

    // Verify session and check access
    try {
        const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
        const userId = decodedClaims.uid;

        const accessResult = await checkServiceAccess(userId, "cooperative");

        if (!accessResult.hasAccess) {
            redirect(accessResult.redirectTo || "/cooperatives/onboarding");
        }

        // Fetch membership details for Sidebar
        const db = getAdminDb();
        const memberSnapshot = await db.collection("cooperative_members").doc(userId).get();
        if (memberSnapshot.exists) {
            const data = memberSnapshot.data();
            userProfile = {
                firstName: data?.firstName || "",
                lastName: data?.lastName || "",
                tier: data?.membershipTier || ""
            };
        }
    } catch (error) {
        console.error("Session verification failed:", error);
        redirect("/auth/login?redirect=/cooperatives");
    }

    return (
        <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Sidebar */}
            <CooperativeSidebar user={userProfile} />

            {/* Main Content */}
            <main className="flex-1 lg:ml-64">
                <div className="p-4 lg:p-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
