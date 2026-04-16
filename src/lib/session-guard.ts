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

export { SESSION_EXPIRED_CODE, type SessionExpiredResult };

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

    try {
        const db = getAdminDb();
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();

        if (!userDoc.exists) {
            return {
                session: null,
                error: {
                    success: false,
                    code: SESSION_EXPIRED_CODE,
                    error: "Account not found. Please log in again.",
                },
            };
        }

        const data = userDoc.data();
        if (data?.isBanned || data?.status === "banned" || data?.suspended) {
            return {
                session: null,
                error: {
                    success: false,
                    code: SESSION_EXPIRED_CODE,
                    error: "Your account has been suspended.",
                },
            };
        }

        // Force-sync live roles from database over stale JWT roles
        if (data?.roles) {
            session.user.roles = data.roles;
        }
    } catch (e) {
        console.error("[SessionGuard] Verification failed:", e);
        // Fail open if database lookup fails for some reason or network error to avoid breaking platform
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
