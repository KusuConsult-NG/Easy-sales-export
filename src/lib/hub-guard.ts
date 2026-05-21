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
    
    // Automatically block users who are not even authenticated or are banned
    if (!sessionResult.session) {
        // Proper handling of the nested error object structure (result.error.error)
        const errorMessage = sessionResult.error?.error || "Authentication required";
        redirect(`/auth/login?error=${encodeURIComponent(errorMessage)}`);
    }
    
    // ── ADMIN BYPASS ──────────────────────────────────────────────────────────
    // Admin/super_admin accounts are provisioned directly and are NEVER subject
    // to the hub registration completeness check. They should always pass through.
    const sessionRoles: string[] = (sessionResult.session.user as any)?.roles || [];
    const isAdminAccount = sessionRoles.some((r: string) =>
        r === 'admin' || r === 'super_admin' || r.endsWith('_admin')
    );
    if (isAdminAccount) {
        return sessionResult;
    }
    
    let shouldRedirect = false;
    
    // 2. Extrapolate db record for registration verification
    try {
        const { getCached, CacheKeys } = await import("@/lib/redis");
        const cacheKey = CacheKeys.userProfile(sessionResult.session.user.id);
        
        // Leverage cached user data populated by requireSession
        let userData: any = await getCached(cacheKey);
        
        // Maintain live Firestore validation fallback to prevent stale session exploits
        if (!userData) {
            const db = getAdminDb();
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(sessionResult.session.user.id).get();
            
            if (userDoc.exists) {
                userData = userDoc.data();
            }
        }
        
        if (!userData) {
            shouldRedirect = true;
        } else {
            // 3. Define "Fully Registered" Status
            // Strictly enforce userData.profileComplete === true. Deny dashboard or module access
            // to any account that does not meet this check.
            if (userData?.profileComplete === true) {
                // User has explicitly completed their profile. 
                // CRITICAL: Check if they still need to secure their account (legacy members)
                if (userData.requiresPasswordChange) {
                    redirect("/auth/reset-legacy-password");
                }
                return sessionResult;
            } else {
                // Check for legacy members who haven't completed profile yet but have the flag
                if (userData?.requiresPasswordChange) {
                    redirect("/auth/reset-legacy-password");
                }

                console.warn(`[HubGuard] Redirecting user ${sessionResult.session.user.id} - Profile is incomplete.`);
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
