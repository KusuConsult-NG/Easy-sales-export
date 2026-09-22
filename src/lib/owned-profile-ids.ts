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

import { cache } from "react";

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
async function ownedProfileIdsUncached(liveId: string): Promise<string[]> {
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

/**
 * The live id for a stored one — the forward walk, as a value.
 *
 * For a caller that must COMPARE two stored ids inside a rule it does not own.
 * lib/quote-negotiation.ts is the case: it is a pure, synchronous law that
 * compares a quote's parties against a cart line's, and it is shared by the
 * money paths precisely because it does no I/O. Making it `async` to resolve
 * ids would spread this module across a rule whose whole value is that it has
 * no dependencies.
 *
 * So the CALLER normalises and the law stays a law. The id given back is
 * unchanged when it is already live, when it is unknown, and when the lookup
 * fails — never null for a non-empty input, so a comparison can never start
 * passing because a resolution quietly returned nothing.
 */
async function liveProfileIdUncached(storedId: unknown): Promise<string> {
    if (typeof storedId !== "string" || storedId.trim() === "") return "";

    try {
        const resolved = await resolveActiveUserId(
            storedId, db.collection(COLLECTIONS.USERS) as unknown as UserCollection,
        );
        return resolved.id;
    } catch (error) {
        logger.error("[owned-profile-ids] could not resolve an id; using the one given", {
            storedId, error: error instanceof Error ? error.message : String(error),
        });
        return storedId;
    }
}

/**
 * Narrow `query` to rows whose ARRAY field contains one of `ids`.
 *
 * The sibling of `filterByOwner`, for the other shape a seller is stored in. A
 * marketplace order names its sellers in `sellerIds`, an array, because one
 * order can span several — so the seller's own order list and the numbers above
 * it ask `array-contains` rather than `==`.
 *
 * ONE ID STAYS `array-contains`, for the same reason the scalar helper keeps
 * `==`: for the overwhelming majority of accounts this emits the identical
 * query to the one that has always run, and a change that cannot alter the
 * common case cannot regress it.
 */
export function filterByOwnerInArray<Q extends Filterable>(
    query: Q, field: string, ids: string[],
): Q {
    return (ids.length === 1
        ? query.where(field, "array-contains", ids[0])
        : query.where(field, "array-contains-any", ids)) as Q;
}

/**
 * Every id belonging to the person `anyId` names — live or superseded.
 *
 *   `ownedProfileIds` searches BACKWARD and therefore expects the LIVE id:
 *   handed a superseded one it finds what points AT it and misses the live row
 *   entirely. That is fine where the id comes from the session, which is live
 *   by construction, and wrong everywhere else.
 *
 *   A reader that takes an id as a PARAMETER cannot make that assumption — a
 *   certificate list, a saved-items store, an unread count, an admin opening a
 *   member's record by an id they were given. Composing the forward walk with
 *   the backward one is the whole fix, and it is one line rather than two at
 *   every call site precisely so nobody has to remember which case they are in.
 *
 *   ONE EXTRA KEYED READ over `ownedProfileIds`, and only that: a live id
 *   resolves to itself on the first hop.
 */
async function ownedProfileIdsForUncached(anyId: string): Promise<string[]> {
    return ownedProfileIdsUncached(await liveProfileIdUncached(anyId));
}

/**
 * ── RESOLVED ONCE PER REQUEST, NOT ONCE PER READ ────────────────────────────
 *
 *   THE OWNER: "this app has gone back to being super slow. all the tabs loads
 *   very slow."
 *
 *   #904's fix is right and stays. What it did not carry was a cost model.
 *   `ownedProfileIdsFor` is called at 116 sites and `liveProfileId` at 44
 *   more, and each call is TWO indexed lookups against `users` — 42,845 rows,
 *   106 MB. For one signed-in person, inside one page render, every one of
 *   those returns THE SAME ANSWER.
 *
 *   A screen that reads four owner-scoped collections therefore paid for a
 *   dozen `users` queries to learn one fact it had already learned. Nothing in
 *   the codebase memoised anything: a search for React's `cache` across
 *   src/ returned zero uses.
 *
 *   `cache()` is per-REQUEST, which is exactly the lifetime this fact has.
 *   Two profiles merging mid-render is not a thing that happens, and the next
 *   request resolves afresh — so this cannot serve a stale identity to a later
 *   page the way a module-level Map would.
 *
 *   OUTSIDE A REQUEST IT IS A NO-OP, which is why the maintenance scripts and
 *   the suites are unaffected: React gives an un-scoped caller its own cache
 *   per call, so each one still reads.
 *
 *   The uncached forms stay callable inside this module so the resolution
 *   chain does not memoise itself twice over.
 */
//   ANNOTATED, because cache() erodes the inferred return type and every
//   caller that maps over the result then trips noImplicitAny.
export const ownedProfileIdsFor: (anyId: string) => Promise<string[]> =
    cache(ownedProfileIdsForUncached);

/**
 * The same treatment for the two the chain is built from, because both are
 * public and both are called directly — `liveProfileId` at 44 sites of its own.
 */
export const ownedProfileIds: (liveId: string) => Promise<string[]> =
    cache(ownedProfileIdsUncached);
export const liveProfileId: (storedId: unknown) => Promise<string> =
    cache(liveProfileIdUncached);

/**
 * Is the caller either party to this row?
 *
 * The escrow and dispute gates are two-sided — "buyer or seller, and nobody
 * else" — and asking `isOwnedBySession` twice would resolve the first id even
 * when the second is an exact match. EVERY EXACT MATCH IS TRIED FIRST, so the
 * ordinary caller on either side of a transaction still pays for no read at
 * all, and only a genuine miss walks.
 *
 * Refuses on an empty list, which is the shape a row missing both parties
 * has — a gate that admitted everybody to a malformed row would be worse than
 * one that admits nobody.
 */
export async function isAnyOwnedBySession(rowOwnerIds: unknown[], liveId: string): Promise<boolean> {
    if (rowOwnerIds.some((id) => typeof id === "string" && id === liveId)) return true;

    for (const id of rowOwnerIds) {
        if (await isOwnedBySession(id, liveId)) return true;
    }
    return false;
}

/**
 * Are two stored ids the same PERSON?
 *
 *   #904's widening found a hole rather than only a defect, and this is it.
 *
 *   Two places refuse to let somebody trade with themselves:
 *
 *       _escrow_lifecycle   `data.sellerId === data.buyerId` → "Invalid seller"
 *       _quotes             `sellerId === userId` → "on your own listing"
 *
 *   Both compare RAW IDS. A person with two profiles — which this platform has
 *   in quantity (#477 lists six on one address) — is two different ids, so
 *   both checks pass and the platform lets them sell to themselves. On an
 *   escrow that is a funded transaction between one person and themselves;
 *   what it is good for is washing money through the platform's own books and
 *   farming whatever a completed sale confers.
 *
 *   THIS ONE REFUSES MORE THAN IT DID, which is the opposite direction to
 *   every other use of this module, and it is deliberate. Nothing legitimate
 *   is lost: there is no honest reason to buy from yourself, and a person who
 *   somehow meant to would have been refused already had they been signed in
 *   to the other profile.
 *
 *   BOTH SIDES ARE RESOLVED, not just one. `isOwnedBySession` may assume its
 *   second argument is live because it comes from the session; here both ids
 *   come off rows or off the wire, and two SUPERSEDED profiles pointing at one
 *   live row are the same person without either being live.
 *
 *   A failure answers "not the same person", which is today's behaviour for
 *   every pair — so a lookup that breaks cannot start refusing honest trades.
 */
export async function isSamePerson(a: unknown, b: unknown): Promise<boolean> {
    if (typeof a !== "string" || a.trim() === "") return false;
    if (typeof b !== "string" || b.trim() === "") return false;
    if (a === b) return true;

    try {
        const users = db.collection(COLLECTIONS.USERS) as unknown as UserCollection;
        const [left, right] = await Promise.all([
            resolveActiveUserId(a, users),
            resolveActiveUserId(b, users),
        ]);
        return left.id === right.id;
    } catch (error) {
        logger.error("[owned-profile-ids] could not compare two identities; treating as different", {
            a, b, error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
