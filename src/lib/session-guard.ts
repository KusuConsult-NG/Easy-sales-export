/**
 * session-guard.ts  (server-only — never import this from client components)
 *
 * Usage in any server action:
 *   const sessionResult = await requireSession();
 *   if (!sessionResult.session) return sessionResult.error;
 *   const { session } = sessionResult;
 */

import "server-only";

import { auth } from "@/lib/auth";
import type { Session } from "next-auth";
import { SESSION_EXPIRED_CODE, type SessionExpiredResult } from "@/lib/session-expiry-code";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { isAdmin as _isAdmin } from "@/lib/role-utils";
import type { UserRole } from "@/lib/types/roles";

export { SESSION_EXPIRED_CODE, type SessionExpiredResult };

/**
 * Check if a list of roles contains an admin-level role.
 * Thin wrapper over role-utils so callers can import from a single server-only module.
 */
export function isAdmin(roles: UserRole[] | string[] | undefined): boolean {
    return _isAdmin((roles ?? []) as UserRole[]);
}

type ValidSession = Session & { user: NonNullable<Session["user"]> & { id: string } };

export async function requireSession(): Promise<
    | { session: ValidSession; error: null }
    | { session: null; error: SessionExpiredResult }
> {
    const session = await auth();

    if (!session?.user?.id) {
        return {
            session: null,
            error: {
                success: false,
                code: SESSION_EXPIRED_CODE,
                error: "Your session has expired. Please log in again.",
            },
        };
    }

    let shouldRedirectToPasswordReset = false;
    let data: any = null;

    try {
        const { getCached, CacheKeys, setCache, CACHE_TTL } = await import("@/lib/redis");
        const cacheKey = CacheKeys.userProfile(session.user.id);

        let fromCache = false;

        // 1. Try Redis cache first
        try {
            data = await getCached(cacheKey);
            if (data) fromCache = true;
        } catch (e) {
            console.error("[SessionGuard] Redis cache read failed:", e);
        }

        // 2. Fallback to Firestore if cache misses
        if (!data) {
            const db = getAdminDb();
            const userId = session.user.id;
            const userEmail = session.user.email;
            logger.debug(`[SessionGuard] Fetching user doc for ID: ${userId} from collection: ${COLLECTIONS.USERS}`);
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

            if (!userDoc.exists) {
                logger.debug(`[SessionGuard] Account NOT found in Firestore for ID: ${userId}. Attempting auto-repair.`);
                try {
                    const { FieldValue } = await import("firebase-admin/firestore");
                    // IMPORTANT: session.user.name can be literally "User" when NextAuth
                    // reads an empty Firebase Auth displayName. Do NOT write that into Firestore
                    // or the admin table will show "User" for every such account.
                    const rawName = session.user.name;
                    const isPlaceholderName = !rawName || rawName === "User" || rawName === "Unknown";
                    const fullName = isPlaceholderName ? (userEmail || "") : rawName;
                    const nameParts = isPlaceholderName ? [] : fullName.split(" ");

                    const userProfile: Record<string, any> = {
                        uid: userId,
                        email: userEmail || "",
                        roles: ["general_user"],
                        isVerified: true,
                        verified: true,
                        profileComplete: false,
                    };

                    // Only write name fields when we have a real name — avoids
                    // polluting the DB with placeholder strings like "User".
                    if (!isPlaceholderName) {
                        userProfile.fullName = fullName;
                        userProfile.firstName = nameParts[0] || "";
                        userProfile.lastName = nameParts.slice(1).join(" ") || "";
                    }
                    
                    await db.collection(COLLECTIONS.USERS).doc(userId).set({
                        ...userProfile,
                        createdAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                    
                    data = userProfile;
                    logger.debug(`[SessionGuard] Successfully auto-repaired ghost account for ID: ${userId}`);
                } catch (repairErr) {
                    console.error(`[SessionGuard] Failed to auto-repair ghost account for ID: ${userId}`, repairErr);
                    return {
                        session: null,
                        error: {
                            success: false,
                            code: SESSION_EXPIRED_CODE,
                            error: "Account not found. Please log in again.",
                        },
                    };
                }
            } else {
                data = userDoc.data();
            }

            // 3. Populate cache
            if (data) {
                try {
                    await setCache(cacheKey, {
                         ...(data as any),
                         roles: data.roles || [] 
                    }, CACHE_TTL.USER_PROFILE);
                } catch (e) {
                    console.error("[SessionGuard] Redis cache write failed:", e);
                }
            }
        }

    } catch (e) {
        console.error("[SessionGuard] Verification failed:", e);
        // Fail open if database lookup fails for some reason or network error to avoid breaking platform
    }

    if (data) {
        // 4. Verify account status
        if (data.isBanned || data.status === "banned" || data.suspended) {
            return {
                session: null,
                error: {
                    success: false,
                    code: SESSION_EXPIRED_CODE,
                    error: "Your account has been suspended.",
                },
            };
        }

        // Force-sync live roles and serviceRegistrations from database/cache over stale JWT roles
        if (data.roles) {
            session.user.roles = data.roles;
        }
        if (data.serviceRegistrations) {
            session.user.serviceRegistrations = data.serviceRegistrations;
        }

        // Check for password change requirement (Legacy Reset Bypass)
        if (data.requiresPasswordChange) {
            let isResetPasswordRoute = false;
            try {
                const { headers } = await import("next/headers");
                const headerList = await headers();
                const xUrl = headerList.get("x-url") || "";
                const xInvokePath = headerList.get("x-invoke-path") || "";
                
                // Secure path check: only allow bypass if explicitly on the reset-legacy-password page
                isResetPasswordRoute = 
                    xInvokePath === "/auth/reset-legacy-password" || 
                    xUrl.includes("/auth/reset-legacy-password");
            } catch (e) {
                console.error("[SessionGuard] Headers check failed:", e);
            }

            if (!isResetPasswordRoute) {
                shouldRedirectToPasswordReset = true;
            }
        }
    }

    if (shouldRedirectToPasswordReset) {
        const { redirect } = await import("next/navigation");
        redirect("/auth/reset-legacy-password");
    }

    return { session: session as ValidSession, error: null };
}

export function isSessionExpired(result: unknown): result is SessionExpiredResult {
    return (
        typeof result === "object" &&
        result !== null &&
        (result as any).success === false &&
        (result as any).code === SESSION_EXPIRED_CODE
    );
}
