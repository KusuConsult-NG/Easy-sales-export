import "server-only";

import { cache } from "react";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { filterByOwner, ownedProfileIds } from "@/lib/owned-profile-ids";
import { APPLICATION_SCAN_LIMIT } from "@/lib/latest-application";

/**
 * The three Academy reads a page draw makes more than once, made once.
 *
 *   THE OWNER: "fix the academy one next."
 *
 *   Measured with #261's read meter and a real per-request memoiser, one draw
 *   of /academy/application cost TEN reads — and FOUR of them were a question
 *   already asked in the same request:
 *
 *       1  users:doc                     checkAcademyStatus
 *       2  users:doc                     checkAcademyPaymentStatus — SAME ROW
 *       3  users:query   ┐ the identity search (shared already)
 *       4  users:query   ┘
 *       5  academy_applications:query    status:  userId IN <owned>
 *       6  processedPayments:query       payment: academy_registration, completed
 *       7  academy_applications:query    status:  personalInfo.email == <mine>
 *       8  academy_applications:query    payment: userId IN <owned>     — SAME AS 5
 *       9  processedPayments:query       status:  academy_registration  — SAME AS 6
 *      10  academy_applications:query    payment: personalInfo.email    — SAME AS 7
 *
 *   The page runs the two actions in `Promise.all` — deliberately, and its own
 *   header explains why — so they are in flight together and neither can see
 *   the other's answer. THAT IS WHAT THIS MODULE IS FOR: it memoises the
 *   PROMISE, not the result, so the second caller joins the first caller's
 *   round trip instead of starting a second one. lib/current-user-doc's header
 *   makes the same argument for the user row, and this is that argument applied
 *   to the three reads underneath it.
 *
 * ── WHY IT IS A MODULE AND NOT A PARAMETER ──────────────────────────────────
 *
 *   Because the callers do not know about each other, which is exactly why the
 *   duplication survived review: none of the three is wrong on its own. A page
 *   that had to thread these snapshots through as arguments would be a fourth
 *   copy of the contract, and two copies of one contract is the defect this
 *   audit keeps finding.
 *
 * ── AND THE WRITES ──────────────────────────────────────────────────────────
 *
 *   A claim WRITES `userId` onto an application, which changes what the
 *   owner-scoped query would answer. `forgetAcademyReads` exists for exactly
 *   that caller and is called on every claim path. Same rule as
 *   `forgetUserDoc`, and for the same reason: a memo that outlives the write it
 *   was taken before is #692 in a new collection.
 */

type Snap = { empty: boolean; docs: any[] };

const requestScope = cache((): Map<string, Promise<Snap>> => new Map());

function once(key: string, read: () => Promise<Snap>): Promise<Snap> {
    const scope = requestScope();

    const inFlight = scope.get(key);
    if (inFlight) return inFlight;

    const started = read();

    //   A FAILED READ MUST NOT BE REMEMBERED — see lib/current-user-doc. These
    //   feed a payment wall and a module gate, so a remembered rejection turns
    //   one transient error into "has not paid" for every later caller.
    void started.catch(() => { scope.delete(key); });

    scope.set(key, started);
    return started;
}

/** Every Academy application filed under any profile this person owns. */
export function academyApplicationsOwnedBy(userId: string): Promise<Snap> {
    return once(`owned:${userId}`, async () => filterByOwner(
        db.collection(COLLECTIONS.ACADEMY_APPLICATIONS), "userId",
        await ownedProfileIds(userId),
    ).get());
}

/**
 * Applications carrying `email` as the address TYPED ON THE FORM.
 *
 * A candidate set, never an answer: `personalInfo.email` is not a field anybody
 * authenticated as, so every caller puts this through `claimableByEmail` and
 * may read only the rows nobody owns. See lib/claimable-application.
 *
 * Bounded at APPLICATION_SCAN_LIMIT because `claimableByEmail` needs the SET —
 * it reports how many of them already belong to somebody else — and because
 * that is the bound module-access-check's own copy of this query already uses.
 */
export function academyApplicationsTypedTo(email: string): Promise<Snap> {
    const normalized = email.toLowerCase().trim();
    return once(`typed:${normalized}`, async () => db
        .collection(COLLECTIONS.ACADEMY_APPLICATIONS)
        .where("personalInfo.email", "==", normalized)
        .limit(APPLICATION_SCAN_LIMIT)
        .get());
}

/** A completed `academy_registration` payment under any profile this person owns. */
export function completedAcademyRegistrationFor(userId: string): Promise<Snap> {
    return once(`paid:${userId}`, async () => filterByOwner(
        db.collection(COLLECTIONS.PROCESSED_PAYMENTS), "userId",
        await ownedProfileIds(userId),
    )
        .where("type", "==", "academy_registration")
        .where("status", "==", "completed")
        .limit(1)
        .get());
}

/**
 * Drop this request's Academy memos, so the next read fetches again.
 *
 * For a caller that has just CLAIMED an application — written `userId` onto a
 * row the owner-scoped query could not previously see.
 */
export function forgetAcademyReads(): void {
    requestScope().clear();
}
