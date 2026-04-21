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
    
    // 2. Extrapolate db record for registration verification
    try {
        const db = getAdminDb();
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(sessionResult.session.user.id).get();
        
        if (!userDoc.exists) {
            redirect("/hub/register");
        }
        
        const userData = userDoc.data();
        
        // 3. Define "Fully Registered" Status
        // A fully registered user must have base identification and contact details populated.
        // Legacy 'fullName' or 'firstName/lastName' combo must exist, along with phone and email.
        const hasName = Boolean(userData?.fullName || (userData?.firstName && userData?.lastName));
        const hasEmail = Boolean(userData?.email);
        const hasPhone = Boolean(userData?.phone);
        
        const isFullyRegistered = hasName && hasEmail && hasPhone;
        
        if (!isFullyRegistered) {
            redirect("/hub/register");
            // NOTE: redirect() throws a Next.js navigation error, so this stops execution.
        }
    } catch(err) {
        // If the database fails or throws an internal exception, 
        // DO NOT allow bypass. Protect the module by actively redirecting to hub registration.
        // Redirect throws an internal nextjs navigation exception so we shouldn't swallow it.
        if (err instanceof Error && err.message === "NEXT_REDIRECT") {
            throw err;
        }
        console.error("Hub Guard Exception:", err);
        redirect("/hub/register");
    }
    
    return sessionResult;
}
