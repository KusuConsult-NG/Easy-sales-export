import "server-only";

import { cache } from "react";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { filterByOwner, ownedProfileIds } from "@/lib/owned-profile-ids";
import { APPLICATION_SCAN_LIMIT } from "@/lib/latest-application";

/**
 * The application reads a page draw makes more than once, made once.
 *
 *   THIS WAS `academy-request-reads.ts` ONE PR AGO, AND EXPORT IS WHY IT MOVED.
 *
 *   #272 built it for Academy, where /academy/application runs two actions in
 *   one Promise.all and four of its ten reads were a question already in
 *   flight. Export's screen has the same shape — a gate and a status action
 *   asking the same collection in the same request — and writing a second
 *   `export-request-reads.ts` would have been two copies of one contract,
 *   which is the defect this audit keeps finding. One module, parameterised by
 *   the collection it reads.
 *
 *   It memoises the PROMISE, not the result. That is the whole point: callers
 *   that run together cannot see each other's answers, so the second one has
 *   to be able to join a round trip already started rather than wait for one
 *   that has finished.
 *
 * ── AND THE WRITES ──────────────────────────────────────────────────────────
 *
 *   A claim WRITES `userId` onto an application, which changes what the
 *   owner-scoped query would answer. `forgetApplicationReads` exists for
 *   exactly that caller and is called on every claim path. Same rule as
 *   `forgetUserDoc`: a memo that outlives the write it was taken before is
 *   #692 in a new collection.
 */

type Snap = { empty: boolean; docs: any[] };

const requestScope = cache((): Map<string, Promise<Snap>> => new Map());

function once(key: string, read: () => Promise<Snap>): Promise<Snap> {
    const scope = requestScope();

    const inFlight = scope.get(key);
    if (inFlight) return inFlight;

    const started = read();

    //   A FAILED READ MUST NOT BE REMEMBERED — see lib/current-user-doc. These
    //   feed payment walls and module gates, so a remembered rejection turns
    //   one transient error into "has not applied" for every later caller
    //   instead of just the unlucky one.
    void started.catch(() => { scope.delete(key); });

    scope.set(key, started);
    return started;
}

/** Every application in `collection` filed under any profile this person owns. */
export function applicationsOwnedBy(collection: string, userId: string): Promise<Snap> {
    return once(`owned:${collection}:${userId}`, async () => filterByOwner(
        db.collection(collection), "userId", await ownedProfileIds(userId),
    ).get());
}

/**
 * Applications in `collection` carrying `email` in `field`.
 *
 * A candidate set, never an answer: every caller puts this through
 * `claimableByEmail` and may read only the rows nobody owns. See
 * lib/claimable-application for the two defects that rule exists against.
 *
 * Bounded at APPLICATION_SCAN_LIMIT because `claimableByEmail` needs the SET —
 * it reports how many already belong to somebody else — and because that is
 * the bound module-access-check's own copies of these queries already use.
 */
export function applicationsTypedTo(collection: string, field: string, email: string): Promise<Snap> {
    const normalized = email.toLowerCase().trim();
    return once(`typed:${collection}:${field}:${normalized}`, async () => db
        .collection(collection)
        .where(field, "==", normalized)
        .limit(APPLICATION_SCAN_LIMIT)
        .get());
}

/** A completed payment of `type` under any profile this person owns. */
export function completedPaymentFor(userId: string, type: string): Promise<Snap> {
    return once(`paid:${type}:${userId}`, async () => filterByOwner(
        db.collection(COLLECTIONS.PROCESSED_PAYMENTS), "userId",
        await ownedProfileIds(userId),
    )
        .where("type", "==", type)
        .where("status", "==", "completed")
        .limit(1)
        .get());
}

/**
 * Drop this request's application memos, so the next read fetches again.
 *
 * For a caller that has just CLAIMED an application — written `userId` onto a
 * row the owner-scoped query could not previously see.
 */
export function forgetApplicationReads(): void {
    requestScope().clear();
}
