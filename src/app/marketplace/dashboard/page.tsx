import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

export const dynamic = 'force-dynamic';

export default async function MarketplaceDashboardRedirect() {
    const { session } = await requireSession();
    
    if (!session || !session.user) {
        redirect("/auth/login?callbackUrl=/marketplace/dashboard");
    }

    const roles = session.user.roles || [];
    let redirectPath: string | null = null;

    // Check Firestore for authoritative accountType (JWT may be stale)
    try {
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (userDoc.exists) {
            const registration = userDoc.data()?.serviceRegistrations?.marketplace;
            const accountType = registration?.accountType;

            // Sellers and "both" always go to seller dashboard
            if (accountType === "seller" || accountType === "both" || roles.includes("seller")) {
                redirectPath = "/marketplace/seller/dashboard";
            }
            // Buyers (including marketplace_buyer role) go to buyer dashboard
            else if (accountType === "buyer" || roles.includes("marketplace_buyer") || roles.includes("buyer")) {
                redirectPath = "/marketplace/buyer/dashboard";
            }
        }
    } catch (err) {
        console.error("[MarketplaceDashboard] Firestore check failed:", err);
        // Fallback to JWT roles if Firestore read fails
        if (roles.includes("seller")) {
            redirectPath = "/marketplace/seller/dashboard";
        } else if (roles.includes("marketplace_buyer") || roles.includes("buyer")) {
            redirectPath = "/marketplace/buyer/dashboard";
        }
    }

    if (redirectPath) {
        redirect(redirectPath);
    }

    // Default: not yet onboarded — send to onboarding
    redirect("/marketplace/onboarding");
}
