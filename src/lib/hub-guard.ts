import "server-only";
import { requireSession } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Enforces strict module onboarding checks.
 * A user MUST have completed Hub Registration before they can access any active module's onboarding logic.
 * 
 * Rules:
 * 1. Must be logged in (have a valid session).
 * 2. Must be fully registered in the database.
 * 3. Partially registered users are redirected to /hub/register
 */
export async function requireHubRegistration() {
    // 1. Session verification
    const sessionResult = await requireSession();
    
    // Automatically block users who are not even authenticated
    if (!sessionResult.session) {
        redirect("/hub/register");
    }
    let shouldRedirect = false;
    
    // 2. Extrapolate db record for registration verification
    try {
        const db = getAdminDb();
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(sessionResult.session.user.id).get();
        
        if (!userDoc.exists) {
            shouldRedirect = true;
        } else {
            const userData = userDoc.data();
            
            // 3. Define "Fully Registered" Status
            const hasName = Boolean(userData?.fullName || (userData?.firstName && userData?.lastName));
            const hasEmail = Boolean(userData?.email);
            const hasPhone = Boolean(userData?.phone);
            
            const isFullyRegistered = hasName && hasEmail && hasPhone;
            
            if (!isFullyRegistered) {
                shouldRedirect = true;
            }
        }
    } catch(err) {
        console.error("Hub Guard Exception:", err);
        shouldRedirect = true;
    }
    
    // IMPORTANT: Next.js redirect() MUST be called outside the try/catch block
    // to prevent swallowing the NEXT_REDIRECT internal exception.
    if (shouldRedirect) {
        redirect("/hub/register");
    }
    
    return sessionResult;
}
