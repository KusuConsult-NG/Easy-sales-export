import "server-only";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Whether this account has a second factor, read once and defined once.
 *
 *   #567 /settings/security/mfa ASKED THIS APPLICATION FOR THIS OVER HTTP.
 *
 *   Same shape as #562's and #564's screens: a "use client" page whose first
 *   act on mount was a `fetch` back to the server that had just rendered it.
 *
 * ── WHY IT THROWS RATHER THAN RETURNING false ───────────────────────────────
 *
 *   Because "this account has no second factor" and "I could not find out" are
 *   different answers, and this endpoint has already been wrong about that
 *   once. Its own catch used to reply `{ success: true, enabled: false }` — a
 *   DEFINITIVE "unprotected" — when what had happened was a database failure.
 *   #245's shape, a check failing open, on the indicator that tells a member
 *   whether their account is protected. It also defeated /profile, the one
 *   caller that was checking `success` before believing the answer.
 *
 *   So there is no boolean here that can absorb a failure. A read that cannot
 *   complete throws, and each caller decides what to say about it: the route
 *   answers 500, and the page seeds nothing so the screen keeps its own
 *   "unknown" state (#313).
 *
 *   A missing user row is NOT a failure — it is a real, readable "no second
 *   factor", and it is answered as one.
 */
export async function readMfaStatus(userId: string): Promise<{ enabled: boolean }> {
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();

    if (!userDoc.exists) return { enabled: false };

    return { enabled: userDoc.data()!.mfaEnabled === true };
}
