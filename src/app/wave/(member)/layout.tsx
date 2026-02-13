/**
 * WAVE Member Layout
 * 
 * Protected layout with server-side access control and sidebar navigation
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkServiceAccess } from "@/lib/auth/service-access";
import WaveSidebar from "./WaveSidebar";

export default async function WaveMemberLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Get session from NextAuth
    const { auth } = await import("@/lib/auth");
    const session = await auth();

    // Check if user is authenticated
    if (!session?.user) {
        redirect("/wave/login?redirect=/wave");
    }

    const { db } = await import("@/lib/firebase-admin");

    const userId = session.user.id;

    // Fetch user data using Admin SDK (bypasses Firestore rules)
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();

    if (!userData) {
        redirect("/wave/login?redirect=/wave");
    }

    // Check WAVE registration
    // We replicate checkWaveAccess logic here but with server-side data
    const registration = userData.serviceRegistrations?.wave;

    if (!registration) {
        redirect("/wave/application");
    }

    // Handle pending/review status
    if (registration.status === "pending" || registration.status === "under_review") {
        redirect("/wave/application/review-pending");
    }

    if (registration.status === "rejected") {
        redirect("/wave/application");
    }

    // Check for approved status AND role
    // Note: We use wave_participant as defined in role-app-mapping
    const hasRole = userData.roles?.includes("wave_participant");

    if (registration.status === "approved" && hasRole) {
        // Access granted
    } else {
        // Fallback for inconsistent state
        redirect("/wave/application");
    }

    return (
        <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Sidebar */}
            <WaveSidebar />

            {/* Main Content */}
            <main className="flex-1 lg:ml-64">
                <div className="p-4 lg:p-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
