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
 * The id this row is superseded BY, or null when it is not superseded.
 *
 *   #804 A POINTER THAT NAMES ITS OWN ROW SUPERSEDES NOTHING, AND FOUR READERS
 *        HAD TO KNOW IT SEPARATELY.
 *
 *   The walk below has always known: `if (!next || next === id)` ends it at
 *   that row, which is what makes the row LIVE. `supabaseAuthId` is why — an
 *   active row carries its own id there, as pointerOf's comment says — and
 *   `_migratedTo` picked up the same shape somewhere in the migrations.
 *
 *   Everything that asked the question with a QUERY got it wrong, because
 *   `where("_migratedTo", "!=", "")` cannot compare a field to the row's own
 *   id. Three did:
 *
 *     duplicate-profile-resolution  reported settled pairs as cycles (#802)
 *     user-population               subtracted live people from "Total Users"
 *     contactable-account           put live people in the DO-NOT-CONTACT set
 *
 *   The last is the one that reached a person: a self-pointing row landed in
 *   loadNonContactableUserIds and loadNonContactablePhones, so that member was
 *   dropped from every in-app and SMS broadcast — the exact harm that module
 *   exists to prevent, inverted.
 *
 *   TAKES THE POINTER RATHER THAN THE ROW, because the callers deliberately
 *   read different fields: the duplicate resolver judges on `_migratedTo`
 *   alone, while _wallet_consolidation and pointerOf also honour
 *   `supabaseAuthId`. Sharing the RULE without flattening that difference is
 *   the whole point — a helper that picked the field for them would silently
 *   change what three modules mean by "superseded".
 */
export function supersedingPointer(id: string, pointer: unknown): string | null {
    const to = str(pointer);
    return to !== null && to !== id ? to : null;
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

/* ────────────────────────────────────────────────────────────────────────────
 *
 *   AND THE SAME QUESTION ASKED BACKWARDS, WHICH NOTHING ABOVE ANSWERS.
 *
 *   Everything up to here walks FORWARD: given an id, which row is the live
 *   one. That is the right question for a notice, a payment or a login,
 *   because each of those arrives holding an id and needs the person.
 *
 *   A SCREEN LISTING SOMEBODY'S OWN THINGS ASKS THE OPPOSITE. My Properties
 *   holds the person — the live id, already resolved by session-guard — and
 *   needs every id their rows could be filed under:
 *
 *       land-actions.ts   .where('ownerId', '==', session.user.id)
 *
 *   A listing created before the duplicate was settled carries the SUPERSEDED
 *   id. The seller signs in as the live row (profile-choice ranks a superseded
 *   row last, #490), the query asks for the live id, and the listing is
 *   invisible to the person who created it.
 *
 *   THAT IS #904's SYMPTOM WITH A DIFFERENT CAUSE, and the owner's words fit
 *   both exactly: "My properties are not listed under my property tab".
 *   Migration 040 repaired the rows whose owner was written under the wrong
 *   KEY NAME. These rows have the right key with a superseded VALUE, and no
 *   backfill can touch them — see below.
 *
 * ── WHY THIS IS RESOLVED AT READ TIME AND NOT BACKFILLED ────────────────────
 *
 *   The obvious repair is 040 again: rewrite `ownerId` from the superseded id
 *   to the live one. It would work, and it would quietly destroy the one
 *   promise the duplicate-profile tool makes (#724):
 *
 *       "IT IS REVERSIBLE ... If the owner picks wrong, clearing one field
 *        puts the group back exactly as it was."
 *
 *   It is reversible because resolving a duplicate MOVES NO DATA — it writes
 *   one pointer. A backfill that rewrites owner keys is the data moving, and
 *   after it clearing `_migratedTo` no longer restores anything: the listings
 *   stay on the row the operator has just decided was the wrong one. So the
 *   pointer is followed on every read instead, and an operator who picks wrong
 *   still un-picks it with one field.
 *
 * ── THE CONTROL, WHICH IS THE WHOLE DIFFICULTY ──────────────────────────────
 *
 *   040 refused to hand back a listing whose two owner keys DISAGREED, because
 *   that is what a sale looks like afterwards and handing it back would be a
 *   theft rather than a repair. The same trap is here in a subtler form.
 *
 *   `pointerOf` reads `_migratedTo` FIRST and `supabaseAuthId` only when the
 *   first is absent. A backward search has to find candidates by querying
 *   either field — so it will also turn up a row carrying `supabaseAuthId:
 *   <us>` AND `_migratedTo: <somebody else>`. That row does not resolve to us:
 *   forward, it lands on somebody else. Accepting it would put a stranger's
 *   listings on our screen and, because the ownership gates share this rule,
 *   hand us the right to edit and delete them.
 *
 *   So every candidate is put back through `pointerOf` and kept only if it
 *   points at the id we searched for. The query is a way of finding rows to
 *   ask about; `pointerOf` remains the only thing that decides.
 *
 * ── AND IT STOPS WHERE THE FORWARD WALK STOPS ───────────────────────────────
 *
 *   Same MAX_MIGRATION_HOPS, deliberately. A row nine hops away does NOT
 *   forward-resolve to us — the walk gives up at the limit and stays where it
 *   is — so a backward search that claimed it would disagree with the forward
 *   one about who somebody is. That disagreement is #449's defect exactly, and
 *   re-introducing it in the other direction is the one failure this module
 *   exists to prevent.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * How many profiles one person may be found to have before the search stops.
 *
 * Production has people on six rows (#477 lists them), so this is not a cap on
 * anything real — it is a cap on a pathological id turning one screen into an
 * unbounded `IN` list. When it fires the result says so rather than quietly
 * serving a subset.
 */
export const MAX_OWNED_PROFILES = 50;

/** One row found pointing at the id that was searched for. */
export interface PointingRow {
    id: string;
    row: UserRow;
}

export interface OwnedIdentities {
    /**
     * The live id FIRST, then every id whose forward walk lands on it.
     * Deduplicated, and never empty — it always contains the id asked about.
     */
    ids: string[];
    /** True when a limit stopped the search, so `ids` may be incomplete. */
    truncated: boolean;
    /** How many levels of supersession were crossed. 0 when there are none. */
    depth: number;
}

/**
 * Every id that belongs to the person `liveId` is signed in as.
 *
 * `readRowsPointingAt` is supplied by the caller for the same reason
 * `resolveActiveUser` takes `readRow`: the RULE is what has to be shared, not
 * the query. It may over-return — rows matching either pointer field is the
 * cheapest thing a store can answer — because `pointerOf` filters below.
 *
 * Breadth-first, so a chain A → B → live is followed the whole way: B is found
 * from live, and A is then found from B.
 */
export async function resolveOwnedIdentities(
    liveId: string,
    readRowsPointingAt: (id: string) => Promise<PointingRow[]>,
): Promise<OwnedIdentities> {
    const ids: string[] = [liveId];
    //   Seeded with the live id, which is what stops the live row being
    //   re-added when it is returned by its own `supabaseAuthId` — an active
    //   row carries its OWN id there, as `pointerOf` notes.
    const seen = new Set<string>([liveId]);

    let frontier: string[] = [liveId];
    let depth = 0;
    let truncated = false;

    while (frontier.length > 0 && depth < MAX_MIGRATION_HOPS) {
        const next: string[] = [];

        for (const target of frontier) {
            for (const candidate of await readRowsPointingAt(target)) {
                //   THE CONTROL. The store found this row by EITHER pointer;
                //   only `pointerOf` decides where it actually resolves, and a
                //   row whose `_migratedTo` names somebody else resolves to
                //   them. See the header — this is 040's disagreeing-keys case.
                if (pointerOf(candidate.row) !== target) continue;
                if (seen.has(candidate.id)) continue;

                if (ids.length >= MAX_OWNED_PROFILES) {
                    truncated = true;
                    continue;
                }

                seen.add(candidate.id);
                ids.push(candidate.id);
                next.push(candidate.id);
            }
        }

        frontier = next;
        depth += 1;
    }

    //   Rows were still being found when the hop limit ran out. Beyond it the
    //   forward walk would not bring them here anyway, but the caller is told
    //   its answer is partial rather than left to assume it is complete.
    if (frontier.length > 0) truncated = true;

    return { ids, truncated, depth };
}

/** The shape of a collection reference, narrowed to what the backward search needs. */
export interface UserQueryCollection {
    where: (field: string, op: string, value: unknown) => {
        limit: (n: number) => {
            get: () => Promise<{ docs: { id: string; data: () => UserRow | undefined }[] }>;
        };
    };
}

/**
 * The form a reader uses: every id belonging to `liveId`, against `collection`.
 *
 * TWO QUERIES PER LEVEL, one per pointer field, because a row links itself by
 * `_migratedTo` (the duplicate tool and user-migration.ts) or by
 * `supabaseAuthId` alone (a legacy row linked to an auth account but never
 * tombstoned). Both are indexed — idx_users_supabase_auth_id from #489, and
 * idx_users_migrated_to from migration 042. #465 measured what querying either
 * costs WITHOUT one: `canceling statement due to statement timeout`.
 *
 * Bounded per query as well as in total: a limit here is what keeps one
 * pathological id from reading the user table into memory before the cap above
 * ever gets to refuse it.
 */
export async function resolveOwnedUserIds(
    liveId: string,
    collection: UserQueryCollection,
): Promise<OwnedIdentities> {
    return resolveOwnedIdentities(liveId, async (id) => {
        const [superseded, linked] = await Promise.all([
            collection.where("_migratedTo", "==", id).limit(MAX_OWNED_PROFILES).get(),
            collection.where("supabaseAuthId", "==", id).limit(MAX_OWNED_PROFILES).get(),
        ]);

        return [...superseded.docs, ...linked.docs]
            .map((d) => ({ id: d.id, row: d.data() ?? {} }));
    });
}
