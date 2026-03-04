import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * requireAdmin — Live Role Re-Validation
 *
 * Re-fetches the user's roles directly from Firestore on every call.
 * This ensures role revocations take effect immediately, rather than
 * waiting up to 8h for the JWT to expire.
 *
 * Usage in server actions:
 *   const result = await requireAdmin();
 *   if ("error" in result) return { success: false, error: result.error };
 *   const { userId } = result;
 */
export async function requireAdmin(): Promise<
    { userId: string } | { error: string }
> {
    // 1. Verify the user has an active NextAuth session
    const session = await auth();
    if (!session?.user?.id) {
        return { error: "Unauthenticated" };
    }

    try {
        // 2. Re-fetch roles live from Firestore (bypasses the stale JWT)
        const db = getAdminDb();
        const userDoc = await db
            .collection(COLLECTIONS.USERS)
            .doc(session.user.id)
            .get();

        if (!userDoc.exists) {
            return { error: "User profile not found" };
        }

        const data = userDoc.data();
        const roles: string[] = data?.roles || [];

        // 3. Check for banned / suspended status while we have the document
        if (data?.isBanned === true || data?.status === "banned" || data?.suspended === true) {
            return { error: "Account suspended. Contact support." };
        }

        // 4. Verify the live role
        if (!roles.includes("admin") && !roles.includes("super_admin")) {
            return { error: "Unauthorized: Admin access required" };
        }

        return { userId: session.user.id };
    } catch (error) {
        console.error("[requireAdmin] Firestore lookup failed:", error);
        // Fail closed — never grant access if we cannot verify the live role
        return { error: "Authorization check failed. Please try again." };
    }
}
