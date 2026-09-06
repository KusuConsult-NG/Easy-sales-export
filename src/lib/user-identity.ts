/**
 * Which user row is the live one.
 *
 *   #449 SIX PLACES ANSWERED THIS, FIVE OF THEM DIFFERENTLY FROM THE SIXTH, AND
 *   THE SIXTH COULD HANG A LOGIN FOREVER.
 *
 *   A legacy profile is linked to its Supabase account by `_migratedTo`, written
 *   by lib/user-migration.ts. Six readers follow that pointer:
 *
 *     lib/user-cache.ts            RECURSED, with no cycle guard and no limit
 *     lib/session-guard.ts         one hop
 *     infrastructure/payments      one hop, then `supabaseAuthId`
 *     api/webhooks/paystack        one hop
 *     api/cron/reconcile-paystack  one hop
 *     lib/auth.ts                  its own order, see login-profile-resolution
 *
 *   THREE FAILURES, ALL MEASURED AGAINST THE REAL FUNCTION BEFORE THIS EXISTED.
 *
 *     A CYCLE HANGS THE REQUEST. Two rows pointing at each other made
 *     getUserProfile recurse forever. It does not overflow the stack — every
 *     hop awaits, so it yields to the microtask queue and simply spins. The
 *     probe that found this did not fail; it never returned, and had to be
 *     killed. In production that is a login request that never answers, holding
 *     a function until the platform times it out.
 *
 *     A DANGLING POINTER REFUSED THE LOGIN. `_migratedTo` naming a row that is
 *     not there returned null — and lib/auth.ts turns null into
 *     `throw new Error("User profile not found in database")`. The user has a
 *     profile. It is the one they started from. They were told they do not
 *     exist because a POINTER was broken, which is the worst possible reading
 *     of that state: the migration half-completing is exactly when somebody
 *     most needs to get in. Measured: `DANGLING OUTCOME: NULL`.
 *
 *     A TWO-HOP CHAIN SPLIT THE PLATFORM IN TWO. A → B → C: getUserProfile
 *     landed on C, every one-hop reader landed on B. So the session said one
 *     account and the contribution handler credited another. Measured:
 *     `getUserProfile lands on: Ada Final / id C` while the others stop at B.
 *
 *   ONE RULE, STATED HERE, AND IT ALWAYS RETURNS A ROW THAT EXISTS.
 */

/** How far a migration chain may be followed before it is treated as broken. */
export const MAX_MIGRATION_HOPS = 8;

export type UserRow = Record<string, unknown>;

/** Why the walk stopped — carried out so callers can log it rather than guess. */
export type ResolutionStop = "no-pointer" | "dangling" | "cycle" | "hop-limit";

export interface ResolvedIdentity {
    /** The id of the row to use. Never a row that does not exist. */
    id: string;
    /** That row, or null only when the STARTING id had no row either. */
    row: UserRow | null;
    hops: number;
    stoppedBecause: ResolutionStop;
    /** True when the chain was broken, so the caller can log it once. */
    healed: boolean;
}

function str(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * The next id this row points at: `_migratedTo`, then `supabaseAuthId`.
 *
 * That order is not invented here. lib/auth.ts already decides a login by it,
 * and infrastructure/payments/service.ts already spelled it out:
 *
 *     if (userData?._migratedTo)         activeUserId = userData._migratedTo;
 *     else if (userData?.supabaseAuthId) activeUserId = userData.supabaseAuthId;
 *
 * Two readers of six knew about the second half. Stating it once is the point
 * of this module — an active row carries its OWN id in supabaseAuthId, so
 * following it there stops immediately and costs nothing.
 */
function pointerOf(row: UserRow | null): string | null {
    if (!row) return null;
    return str(row["_migratedTo"]) ?? str(row["supabaseAuthId"]);
}

/**
 * Walk `_migratedTo` from `startId` to the live row.
 *
 * `readRow` is supplied by the caller because the six readers reach two
 * different stores; the RULE is what has to be shared, not the query.
 *
 * The walk keeps the last row that actually EXISTED. A broken link therefore
 * degrades to the newest good row rather than to nothing — which is the whole
 * difference between a user signing in on a legacy profile and a user being
 * told their account does not exist.
 */
export async function resolveActiveUser(
    startId: string,
    readRow: (id: string) => Promise<UserRow | null>,
): Promise<ResolvedIdentity> {
    const seen = new Set<string>([startId]);

    let id = startId;
    let row = await readRow(startId);
    let hops = 0;

    // The starting row is absent: there is nothing to walk and nothing to
    // invent. This is the one case that legitimately resolves to no row.
    if (!row) {
        return { id: startId, row: null, hops: 0, stoppedBecause: "no-pointer", healed: false };
    }

    for (;;) {
        const next = pointerOf(row);
        if (!next || next === id) {
            return { id, row, hops, stoppedBecause: "no-pointer", healed: false };
        }

        if (seen.has(next)) {
            // Two rows pointing at each other. Before this, the walk never
            // ended.
            return { id, row, hops, stoppedBecause: "cycle", healed: true };
        }

        if (hops >= MAX_MIGRATION_HOPS) {
            return { id, row, hops, stoppedBecause: "hop-limit", healed: true };
        }

        seen.add(next);
        const nextRow = await readRow(next);
        hops += 1;

        if (!nextRow) {
            // The pointer names a row that is not there. Keep the last good
            // one; do NOT resolve to nothing.
            return { id, row, hops, stoppedBecause: "dangling", healed: true };
        }

        id = next;
        row = nextRow;
    }
}

/** The shape of a collection reference, narrowed to what the walk needs. */
export interface UserCollection {
    doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => UserRow | undefined }> };
}

/**
 * The live id for `userId`, following the whole chain against `collection`.
 *
 * The form the payment paths use. They previously followed ONE hop while
 * getUserProfile followed the chain, so on a twice-migrated member the session
 * said one account and the money went to another. Both walk the same distance
 * now.
 */
export async function resolveActiveUserId(
    userId: string,
    collection: UserCollection,
): Promise<ResolvedIdentity> {
    return resolveActiveUser(userId, async (id) => {
        const doc = await collection.doc(id).get();
        return doc.exists ? (doc.data() ?? null) : null;
    });
}

/**
 * The active id for a row already in hand, without another read.
 *
 * ONE HOP ONLY, and that is a real limitation: it cannot check that the id it
 * returns exists, and it cannot follow a chain. Prefer resolveActiveUserId
 * wherever the caller can read rows — every caller in this repository can, and
 * does. This is kept for a caller that genuinely holds nothing but the row.
 */
export function activeIdFromRow(userId: string, row: UserRow | null | undefined): string {
    return pointerOf(row ?? null) ?? userId;
}
