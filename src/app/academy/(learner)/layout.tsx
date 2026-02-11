/**
 * Academy Learner Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkServiceAccess } from "@/lib/auth/service-access";
import { getAuth } from "firebase-admin/auth";
import { initializeApp, getApps } from "firebase-admin/app";

import AcademySidebar from "./AcademySidebar";

export default async function AcademyLearnerLayout({
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
        redirect("/academy/login");
    }

    // Verify session and check access
    try {
        const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
        const userId = decodedClaims.uid;

        const accessResult = await checkServiceAccess(userId, "academy");

        if (!accessResult.hasAccess) {
            redirect(accessResult.redirectTo || "/academy/application");
        }
    } catch (error) {
        console.error("Session verification failed:", error);
        redirect("/academy/login");
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <AcademySidebar />

            {/* Main Content - Offset for sidebar */}
            <main className="lg:pl-64 min-h-screen transition-all">
                <div className="p-4 lg:p-8 mt-16 lg:mt-0">
                    {children}
                </div>
            </main>
        </div>
    );
}
