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
