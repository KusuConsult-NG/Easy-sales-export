/**
 * Every profile id that belongs to the person now signed in.
 *
 *   #904 (THE SECOND CAUSE) "My properties are not listed under my property
 *   tab" — said twice by the owner, and answered twice, because two unrelated
 *   faults empty that screen in exactly the same way.
 *
 *   Migration 040 answered the first: the row was filed under the wrong KEY
 *   NAME, `userId` where every reader asks for `ownerId`, and a backfill copied
 *   it across.
 *
 *   This is the second: the right key holding a SUPERSEDED VALUE. A seller with
 *   two profiles lists a parcel, an admin later settles the duplicate with the
 *   #724 tool, and the listing keeps `ownerId: <the id that lost>`. The seller
 *   signs in as the row that won — profile-choice ranks a superseded row last
 *   (#490) — My Properties asks for that id, and the listing they created is
 *   invisible to them. Nothing is lost and nothing looks broken; the screen is
 *   simply empty, which the owner cannot tell from owning nothing.
 *
 *   THE RULE IS NOT HERE. It is lib/user-identity.ts, beside the forward walk
 *   it has to agree with — the header there records why a backward search that
 *   disagreed with the forward one would be #449 all over again. This module is
 *   the store and the failure mode: which collection, and what to do when it
 *   will not answer.
 *
 * ── IT FAILS SOFT, AND TOWARDS TODAY'S BEHAVIOUR ────────────────────────────
 *
 *   If the lookup throws, the caller gets `[liveId]` — exactly the single id
 *   every one of these screens filtered on before this existed. So the worst
 *   this can do under failure is leave the screen as it is now, never empty it:
 *   a seller seeing their live listings and not their superseded ones is the
 *   state being repaired, and it is much better than a seller seeing an error
 *   where a list used to be.
 *
 *   The notifier makes the same call for the same reason (#738): "losing a loan
 *   decision entirely is worse than one landing on a superseded row".
 *
 * ── AND IT IS NOT A NEW AUTHORISATION ───────────────────────────────────────
 *
 *   The ownership gates use this too, so a listing that appears on My
 *   Properties can also be edited and deleted there. That is deliberate and it
 *   widens nothing: `_migratedTo` is already the platform's statement that two
 *   rows are ONE PERSON — every money path spends against it (#449), the login
 *   signs in through it (#490), and a notice follows it (#738). A screen that
 *   listed rows it then refused to act on would be #884's complaint returned
 *   in a politer form ("a seller could not see, or edit, anything they had
 *   listed").
 *
 *   What it must never do is reach a row belonging to somebody ELSE, and that
 *   control lives with the rule — see `resolveOwnedIdentities`, which puts
 *   every candidate back through `pointerOf` and keeps only the ones that
 *   resolve to us.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import {
    resolveActiveUserId,
    resolveOwnedUserIds,
    type UserCollection,
    type UserQueryCollection,
} from "@/lib/user-identity";

/**
 * The ids `liveId`'s rows may be filed under — `liveId` first, always present.
 *
 * Two indexed equality lookups per level of supersession, and for the ordinary
 * account — no duplicates, nothing pointing at it — exactly two, both returning
 * at most the row itself.
 */
export async function ownedProfileIds(liveId: string): Promise<string[]> {
    try {
        const owned = await resolveOwnedUserIds(
            liveId, db.collection(COLLECTIONS.USERS) as unknown as UserQueryCollection,
        );

        if (owned.truncated) {
            //   Worth a line rather than a silent subset: it means somebody's
            //   rows are spread across more profiles than the search will
            //   follow, which is a duplicate group for the #724 screen to
            //   settle, not something to widen a limit for.
            logger.warn("[owned-profile-ids] search was truncated; some profiles may be missing", {
                liveId, found: owned.ids.length, depth: owned.depth,
            });
        }

        if (owned.ids.length > 1) {
            logger.info("[owned-profile-ids] resolved superseded profiles", {
                liveId, count: owned.ids.length,
            });
        }

        return owned.ids;
    } catch (error) {
        logger.error("[owned-profile-ids] could not resolve superseded profiles; using the live id", {
            liveId, error: error instanceof Error ? error.message : String(error),
        });
        return [liveId];
    }
}

/** The minimum a query builder has to offer for `filterByOwner` to narrow it. */
interface Filterable {
    where(field: string, op: string, value: unknown): Filterable;
}

/**
 * Narrow `query` to the rows `ids` owns, on `field`.
 *
 * ONE ID STAYS `==`, DELIBERATELY. The overwhelming majority of accounts have
 * never been superseded, and for them this emits the identical query to the one
 * that has always run — same operator, same value, same plan. A change that
 * cannot alter the common case cannot regress it, and `IN` over a single-item
 * list is a needlessly different shape to carry through every fallback path in
 * these actions.
 *
 * The `in` branch is served by the same expression indexes as the `==` one
 * (migration 041 for `ownerId` and `sellerId`): Postgres rewrites it to
 * `= ANY(...)`, which is an index scan per id rather than a scan of the table.
 */
export function filterByOwner<Q extends Filterable>(query: Q, field: string, ids: string[]): Q {
    return (ids.length === 1
        ? query.where(field, "==", ids[0])
        : query.where(field, "in", ids)) as Q;
}

/**
 * Does `rowOwnerId` — an owner taken off a row — name the person signed in as
 * `liveId`?
 *
 * THE OTHER DIRECTION, AND ON PURPOSE. A list query cannot resolve rows it has
 * not read yet, so it has to ask backwards: which ids are ours. A gate holds
 * ONE row and already knows its owner, so it asks forwards, which is the rule
 * this platform has had since #449 and costs a single keyed read.
 *
 * Both answer the same question and must agree, or a listing appears on My
 * Properties and refuses to open — #884's complaint returned in a politer form.
 * They agree because both are `pointerOf`, walked from opposite ends.
 *
 * THE MATCHING CASE NEVER READS ANYTHING. An owner whose row was never
 * superseded — nearly every owner — takes the first comparison and returns, so
 * this adds no work at all to the path it is on today. Only a MISS, which is a
 * refusal today, pays for the walk.
 *
 * A failure refuses, and that is not a safety trade being made here: the only
 * path that can reach the walk is one that refuses today regardless, so falling
 * back to `false` is falling back to current behaviour rather than to a
 * weakened check.
 */
export async function isOwnedBySession(rowOwnerId: unknown, liveId: string): Promise<boolean> {
    if (typeof rowOwnerId !== "string" || rowOwnerId.trim() === "") return false;
    if (rowOwnerId === liveId) return true;

    try {
        const resolved = await resolveActiveUserId(
            rowOwnerId, db.collection(COLLECTIONS.USERS) as unknown as UserCollection,
        );
        return resolved.id === liveId;
    } catch (error) {
        logger.error("[owned-profile-ids] could not resolve a row owner; refusing", {
            rowOwnerId, liveId, error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
