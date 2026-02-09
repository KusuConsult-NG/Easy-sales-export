/**
 * Export Windows Layout with Access Control
 * 
 * Protects all export app routes (dashboard, opportunities, portfolio, transactions)
 * Redirects based on verification status
 */

import { redirect } from "next/navigation";
import { getAuth } from "firebase-admin/auth";
import { cookies } from "next/headers";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { initializeApp, getApps } from "firebase-admin/app";

export default async function ExportAppLayout({
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

    if (!sessionCookie) {
        redirect("/auth/login");
    }

    try {
        // Verify session
        const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
        const userId = decodedClaims.uid;

        // Check service access
        const accessResult = await checkServiceAccess(userId, "export");

        if (!accessResult.hasAccess) {
            // Redirect to appropriate page based on status
            if (accessResult.redirectTo) {
                redirect(accessResult.redirectTo);
            }
            redirect("/export");
        }

        // User has access, render the app
        return <>{children}</>;
    } catch (error) {
        console.error("Export access check error:", error);
        redirect("/auth/login");
    }
}
