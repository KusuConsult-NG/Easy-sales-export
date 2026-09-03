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
