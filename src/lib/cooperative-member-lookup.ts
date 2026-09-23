/**
 * Finding one member's membership row.
 *
 * COOPERATIVE_MEMBERS is keyed by the user id by MOST writers, and both loan
 * doors read it as `db.collection(COOPERATIVE_MEMBERS).doc(userId)`. That is
 * not the whole story, and the type already says so (see the note on
 * CooperativeMembership.id): joinCooperativeAction creates its row with an
 * AUTO-GENERATED document id, and the email and paymentReference claim paths
 * return whatever document they matched. Those rows carry `userId` as a FIELD
 * and are invisible to a doc-id read.
 *
 * A doc-id read that misses is indistinguishable from having no membership, so
 * the caller says "you must be a cooperative member" to somebody who is one.
 * That is the failed-lookup-rendered-as-absence shape, and here it lands on the
 * loan doors — the member is refused a loan they qualify for, with a message
 * telling them to join a cooperative they already belong to.
 *
 * getCooperativeApplicationAction already walks the doc-id → userId-field
 * chain by hand; this is that walk, in one place, for the callers that need a
 * member rather than an application.
 *
 * THE EMAIL FALLBACK IS DELIBERATELY NOT HERE. Matching a membership on a
 * free-text email is a CLAIM, gated by mayClaimMembershipByEmail (see #36 and
 * lib/cooperative-membership-claim.ts) — adopting a row on an email match is
 * how one account takes over another's membership. A caller that needs to
 * claim must go through that gate explicitly; a caller that needs to read a
 * balance must not claim anything at all.
 */

import { ownedProfileIds, ownedProfileIdsFor, isSamePerson } from "@/lib/owned-profile-ids";
import { isLiveUserRow, type UserRow } from "@/lib/user-identity";
import { cache } from "react";

import { filterByOwner } from "@/lib/owned-profile-ids";
import { APPLICATION_SCAN_LIMIT } from "@/lib/latest-application";
import type { CooperativeTier } from "@/lib/cooperative-tiers";

/**
 * The cooperative_members reads one page draw makes more than once, made once.
 *
 *   THE OWNER: "fix the remaining three cooperative reads next."
 *
 *   #275 took a cooperatives page draw from FOURTEEN reads to ten and stopped
 *   there, with a note naming what was left and why it needed its own change:
 *   three reads of this collection that the module gate and the status action
 *   each made, where only ONE was an identical query. These are the other two.
 *
 *       cooperative_members:doc     `.doc(userId)` — identical, memoised
 *       cooperative_members:query   `userId IN <owned>` vs `userId == <id>`
 *       cooperative_members:query   the two email queries, at different bounds
 *
 *   THE SECOND AND THIRD ARE NOT MEMO PROBLEMS, THEY ARE SHAPE PROBLEMS. Two
 *   callers asking the same question in two different ways cannot share an
 *   answer, so the shapes are made one — and in both cases the shape kept is
 *   the GATE's, because the gate is the one that decides module access and
 *   its bound is the one this codebase already reasoned about
 *   (APPLICATION_SCAN_LIMIT).
 *
 *   The per-id `userId == <id> LIMIT 1` loop is gone. It issued one query PER
 *   OWNED PROFILE; the owner-scoped query asks for all of them at once and is
 *   the query the gate already ran. Precedence is unchanged — see the loop in
 *   findCooperativeMemberRowForPerson, which still prefers a row keyed by an
 *   id over a row merely carrying it, and an earlier owned id over a later
 *   one.
 *
 * ── AND THE WRITES ──────────────────────────────────────────────────────────
 *
 *   Both the gate and the status action HEAL this collection — a missing
 *   `userId`, a membershipStatus that payment has overtaken. Every one of
 *   those calls `forgetCooperativeMemberReads`, or a reader later in the same
 *   request would be handed the rows as they were before the heal. That is
 *   #692 in a third collection, and the reason #275 would not do this as a
 *   footnote.
 */

type Snap = { empty: boolean; docs: any[] };
//   `any` deliberately: callers take `.ref` off this snapshot to heal the row
//   it names, and narrowing the type here would hide that from them.
type DocSnap = any;

const requestScope = cache((): Map<string, Promise<any>> => new Map());

function once<T>(key: string, read: () => Promise<T>): Promise<T> {
    const scope = requestScope();

    const inFlight = scope.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    /*
     *   `read()` MAY THROW BEFORE IT RETURNS A PROMISE — `.doc(id)` and
     *   `filterByOwner` are ordinary calls, and a bad argument or a handle
     *   that is not there throws where it stands. Without this wrapper that
     *   throw escapes synchronously, so one caller gets an exception and the
     *   next gets a promise for the same question. Callers should not have to
     *   handle a read two ways.
     */
    const started = (async () => read())();

    //   A FAILED READ MUST NOT BE REMEMBERED — see lib/current-user-doc. This
    //   feeds a module gate, so a remembered rejection turns one transient
    //   error into "not a member" for every later caller in the request.
    void started.catch(() => { scope.delete(key); });

    scope.set(key, started);
    return started;
}

/** The member row keyed by `id`, read once per request. */
export function memberDocOnce(membersCollection: any, id: string): Promise<DocSnap> {
    return once(`doc:${id}`, () => membersCollection.doc(id).get());
}

/** Every member row filed under any of `ownedIds`, read once per request. */
export function membersOwnedByOnce(membersCollection: any, ownedIds: string[]): Promise<Snap> {
    const key = `owned:${[...ownedIds].sort().join(",")}`;
    return once(key, () => filterByOwner(membersCollection, "userId", ownedIds)
        .limit(APPLICATION_SCAN_LIMIT)
        .get());
}

/**
 * Member rows carrying `email`, read once per request.
 *
 * A candidate set, never an answer: `email` on an imported membership is not a
 * field anybody authenticated as, so the caller that would CLAIM one puts it
 * through `mayClaimMembershipByEmail` first.
 */
export function membersByEmailOnce(membersCollection: any, email: string): Promise<Snap> {
    const normalized = email.toLowerCase().trim();
    return once(`email:${normalized}`, () => membersCollection
        .where("email", "==", normalized)
        .limit(APPLICATION_SCAN_LIMIT)
        .get());
}

/**
 * Drop this request's memos of this collection.
 *
 * For a caller that has just HEALED a row — written `userId` onto it, or moved
 * its membershipStatus — where a later reader in the same request would
 * otherwise be served the set taken before the write.
 */
export function forgetCooperativeMemberReads(): void {
    requestScope().clear();
}

/** The shape both loan doors need back: which row, and what is on it. */
export interface CooperativeMemberRow {
    id: string;
    data: Record<string, any>;
}

/**
 * Locate a member's membership row by user id.
 *
 * Two reads at most, cheapest first: the document id (what most writers use),
 * then the `userId` field (what the auto-id writers set). Returns null only
 * when neither finds anything — that is a genuine non-member.
 */
export async function findCooperativeMemberRow(
    membersCollection: any,
    userId: string,
): Promise<CooperativeMemberRow | null> {
    if (!userId) return null;

    const byId = await memberDocOnce(membersCollection, userId);
    if (byId.exists) {
        return { id: byId.id ?? userId, data: byId.data() ?? {} };
    }

    //   THE OWNER-SCOPED QUERY, NARROWED IN MEMORY. This asked
    //   `userId == <id> LIMIT 1` — one query per owned profile, and a shape
    //   the gate above never issues. It asks the gate's question now and
    //   filters, so the two share one round trip; `find` keeps the same
    //   "first match wins" that LIMIT 1 had.
    const byOwner = await membersOwnedByOnce(membersCollection, [userId]);
    const match = byOwner.docs.find((d: any) => d.data()?.userId === userId);
    if (match) {
        return { id: match.id, data: match.data() ?? {} };
    }

    return null;
}

/**
 * The same lookup, across every profile this person owns — LIVE ROW FIRST.
 *
 *   A member whose profile was superseded signs in as the live id. Their
 *   membership row may have been written under the old one, and the two-read
 *   walk above never looks there: it reports "no membership", and the caller
 *   tells somebody who joined and paid that they must join a cooperative.
 *   That is the failed-lookup-rendered-as-absence shape this module's header
 *   condemns, arriving through the profile pointer instead of the row key.
 *
 * WHY LIVE-FIRST IS THE WHOLE DESIGN, AND NOT AN ORDERING DETAIL
 * --------------------------------------------------------------
 *   Some callers DEBIT the row this returns. `filterByOwner(...).limit(1)`
 *   over the owned ids would answer with an ARBITRARY one of the person's
 *   rows — nothing in the query orders them — so a member with savings on
 *   their live row and an empty superseded row would be told "insufficient
 *   savings" depending on which came back. Walking the ids in order removes
 *   the ambiguity: `ownedProfileIdsFor` resolves FORWARD before it searches
 *   backward, so ids[0] is the live id and a row there always wins.
 *
 *   Savings sitting on a superseded row BESIDE a live row are still stranded,
 *   and are settled the way lib/wallet-lookup.ts settles the same condition —
 *   reported to a person, not silently reached across by a read path.
 *
 *   Two reads per profile at worst, and one profile is the overwhelming case,
 *   so this costs a member with a single profile exactly what the walk above
 *   already cost them.
 */
/**
 * As above, for every profile this person owns.
 *
 * `liveRow` IS THE CALLER'S OWN USER ROW, WHEN THE CALLER HOLDS IT.
 *
 *   `ownedProfileIdsFor` is `liveProfileId` composed with `ownedProfileIds`,
 *   and its own header says the forward walk costs "ONE EXTRA KEYED READ ...
 *   a live id resolves to itself on the first hop". That hop reads
 *   `users/<userId>` — which _checkCooperativeStatusAction had already
 *   fetched, and which the module gate had fetched before that.
 *
 *   Measured with #261's read meter: one draw of a cooperatives member page
 *   cost FOURTEEN reads, THREE of them that same row.
 *
 *   THE PARAMETER IS OPTIONAL BECAUSE THE WALK IS STILL RIGHT FOR MOST
 *   CALLERS. `membershipRefForPayment` and `cooperativeTierForPerson` are
 *   handed an id that may not be the caller's own — a membership id out of
 *   payment metadata, an admin looking at somebody else — and for those the
 *   forward resolution is the whole point. Omitting the row keeps today's
 *   behaviour exactly; passing `null` does too, since a row that is missing
 *   cannot say it is live.
 */
export async function findCooperativeMemberRowForPerson(
    membersCollection: any,
    userId: string,
    liveRow?: UserRow | null,
): Promise<CooperativeMemberRow | null> {
    if (!userId) return null;

    const owned = isLiveUserRow(userId, liveRow ?? null)
        ? await ownedProfileIds(userId)
        : await ownedProfileIdsFor(userId);
    const ids = owned.length ? owned : [userId];

    //   ONE QUERY FOR EVERY PROFILE, not one per profile — and it is the query
    //   the gate already ran, so the request pays for it once. The precedence
    //   below is exactly what the per-id loop had: a row KEYED by an id beats
    //   a row merely carrying it, and an earlier owned id beats a later one.
    const byOwner = await membersOwnedByOnce(membersCollection, ids);

    for (const id of ids) {
        const byId = await memberDocOnce(membersCollection, id);
        if (byId.exists) {
            return { id: byId.id ?? id, data: byId.data() ?? {} };
        }
        const match = byOwner.docs.find((d: any) => d.data()?.userId === id);
        if (match) {
            return { id: match.id, data: match.data() ?? {} };
        }
    }
    return null;
}

/**
 * WHICH ROW A REGISTRATION PAYMENT BELONGS TO.
 *
 *   ONE PERSON, TWO MEMBERSHIP ROWS: ONE HELD THE IDENTITY, THE OTHER HELD
 *   THE MONEY, AND THE ADMIN SCREEN SHOWED THE EMPTY ONE.
 *
 *   api/cooperatives/register writes the member's whole profile — name,
 *   phone, date of birth, occupation, LGA, address, next of kin,
 *   registrationFee — to a document under an AUTO-GENERATED id, and hands
 *   that id to Paystack as `metadata.membershipId`.
 *
 *   The webhook reads it back and fulfils onto the right row:
 *
 *       if (membershipId) memberRef = ...doc(membershipId)   (service.ts)
 *
 *   api/cooperative/verify-payment — the CLIENT half of the same payment,
 *   racing the webhook by design — did not. It opened with
 *
 *       const membershipRef = db.collection(COOPERATIVE_MEMBERS).doc(userId);
 *
 *   and fulfilled there with set(merge:true), which CREATES the document
 *   when it is absent. So the callback page manufactured a second membership
 *   row carrying userId, paymentStatus, paymentReference and membershipTier
 *   and nothing else — no name, no phone, no date of birth, no occupation,
 *   no LGA, no ward, no address, and no registrationFee, which is why such a
 *   member reads "Fee: ₦0" beside a completed payment.
 *
 *   Worse on the LOST claim: when the webhook won and fulfilled the correct
 *   row, syncAlreadyProcessed still wrote doc(userId) — so the blank
 *   duplicate appeared even on the path where nothing needed creating.
 *
 *   The member's details are not lost. They are on the other row, which
 *   stays "pending" and unpaid for ever, while the row an admin opens says
 *   active, paid, and blank.
 *
 * PRECEDENCE, cheapest-certain first:
 *
 *   1. `metadata.membershipId` — the row this payment was initiated for. Read
 *      before use: a stale id must not conjure a row, and one carrying
 *      somebody else's `userId` is refused outright rather than written to.
 *      The metadata comes back from Paystack's own API, so it is ours; the
 *      ownership check is there so that stays true if it ever is not.
 *   2. The walk above, ACROSS EVERY PROFILE THE PAYER OWNS, live row first.
 *   3. doc(userId), to be created. Legacy references carry no membershipId
 *      (the webhook's own branch makes the same allowance) and a member who
 *      has no row at all still needs one.
 *
 * AND ONE PERSON'S TWO IDS MUST NOT READ AS TWO PEOPLE HERE.
 *
 *   Both of those steps compared ids with `===`, which is the wrong question
 *   when the platform hands one human being more than one profile.
 *
 *   Step 1 refused a membershipId whose row carries the payer's SUPERSEDED
 *   id — their own registration row, from before the profiles were settled —
 *   and step 2 then failed to find it either, so the payment fell through to
 *   step 3 and manufactured the blank duplicate this header exists to
 *   describe. The member's ₦10,000 landed on a row with no name on it while
 *   their real registration stayed pending and unpaid.
 *
 *   `isSamePerson` is the question actually being asked — owned-profile-ids
 *   describes it as "the opposite direction to every other use of this
 *   module, and it is deliberate" — and a row belonging to somebody else is
 *   still refused, because two ids that resolve to different live profiles
 *   are two people.
 */
export async function membershipRefForPayment(
    membersCollection: any,
    userId: string,
    membershipId?: string | null,
): Promise<{ ref: any; id: string }> {
    if (membershipId && membershipId !== userId) {
        const byMetadata = await membersCollection.doc(membershipId).get();
        if (byMetadata.exists) {
            const owner = byMetadata.data()?.userId;
            if (!owner || await isSamePerson(owner, userId)) {
                return { ref: membersCollection.doc(membershipId), id: membershipId };
            }
        }
    }

    const row = await findCooperativeMemberRowForPerson(membersCollection, userId);
    if (row) return { ref: membersCollection.doc(row.id), id: row.id };

    return { ref: membersCollection.doc(userId), id: userId };
}

/**
 * The cooperative tier this PERSON holds, or null when they hold none.
 *
 *   #815 ONE RULE, BECAUSE TWO SIDES NOW DECIDE ON IT.
 *
 *   Farm Nation land is sold to cooperative members. Until now that rule lived
 *   only in the checkout SCREEN — `getUserTierAction()` then
 *   `if (tier !== "Member") router.push(...)` — and
 *   `initializePropertyPaymentAction` checked nothing at all. A server action is
 *   a public HTTP endpoint, so the gate stopped honest buyers and nobody else.
 *
 *   Both sides read this now, so they cannot disagree about who is a member.
 *
 *   AND IT RESOLVES THE PERSON, NOT THE SESSION ID. `getUserTierAction` used
 *   `findCooperativeMemberRow`, which reads the id it is handed and stops. A
 *   member whose membership row sits under a profile they no longer sign in as
 *   therefore read as a NON-member — refused at checkout, and shown no tier and
 *   no contributions on their own dashboard. That is the defect the userId
 *   sweep exists to remove, and this is one more reader catching up: the
 *   person-aware lookup walks every profile they own.
 */
export async function cooperativeTierForPerson(
    membersCollection: any,
    userId: string,
): Promise<CooperativeTier | null> {
    const row = await findCooperativeMemberRowForPerson(membersCollection, userId);
    if (!row) return null;

    const { calculateUserTier } = await import("@/lib/cooperative-tiers");
    return calculateUserTier(Number(row.data?.totalContributions) || 0);
}
