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

import { ownedProfileIdsFor } from "@/lib/owned-profile-ids";

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

    const byId = await membersCollection.doc(userId).get();
    if (byId.exists) {
        return { id: byId.id ?? userId, data: byId.data() ?? {} };
    }

    const byField = await membersCollection.where("userId", "==", userId).limit(1).get();
    if (!byField.empty) {
        const doc = byField.docs[0];
        return { id: doc.id, data: doc.data() ?? {} };
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
export async function findCooperativeMemberRowForPerson(
    membersCollection: any,
    userId: string,
): Promise<CooperativeMemberRow | null> {
    if (!userId) return null;

    const owned = await ownedProfileIdsFor(userId);
    for (const id of owned.length ? owned : [userId]) {
        const row = await findCooperativeMemberRow(membersCollection, id);
        if (row) return row;
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
 *   2. The two-key walk above — doc id, then the `userId` field.
 *   3. doc(userId), to be created. Legacy references carry no membershipId
 *      (the webhook's own branch makes the same allowance) and a member who
 *      has no row at all still needs one.
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
            if (!owner || owner === userId) {
                return { ref: membersCollection.doc(membershipId), id: membershipId };
            }
        }
    }

    const row = await findCooperativeMemberRow(membersCollection, userId);
    if (row) return { ref: membersCollection.doc(row.id), id: row.id };

    return { ref: membersCollection.doc(userId), id: userId };
}
