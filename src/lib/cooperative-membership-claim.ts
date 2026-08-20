/**
 * When a membership found by email may be treated as the caller's.
 *
 * WHY THIS EXISTS
 * ---------------
 * Five readers look a cooperative membership up by userId, fall back to the
 * document id, and then fall back to the caller's EMAIL:
 *
 *   cooperative/_dashboard.ts        getDashboardDataAction
 *   cooperative/_coop_membership.ts  _getMembershipAction
 *   cooperative/_coop_membership.ts  _checkCooperativeStatusAction
 *   cooperative/_coop_identity.ts    getCooperativeMemberIdCardAction
 *   cooperative/_coop_registration.ts  getCooperativeApplicationAction and
 *                                      resubmitCooperativeApplicationAction
 *
 * On a hit they do not merely READ the row: they write `userId` onto it,
 * binding that membership to the caller permanently, and then return it as
 * theirs — savingsBalance, loanBalance, documents, BVN and NIN included.
 *
 * A MATCHING EMAIL IS NOT PROOF OF OWNERSHIP. The caller's address comes from
 * their own profile, and profile.ts lets them change it. So a user could set
 * their address to that of an ORPHANED membership — a member who paid by form
 * submission and never completed registration, which is precisely the case the
 * processed_payments fallback below these exists to handle — load any one of
 * those five screens, and inherit that person's cooperative record.
 *
 * Supabase enforces uniqueness among registered addresses, so the target has to
 * be an address no account currently holds. An orphaned membership is exactly
 * that.
 *
 * getDashboardDataAction was hardened against this in an earlier pass and its
 * four siblings were not — so the hole stayed open, and once ANY of them bound
 * the row, the dashboard's own check passed trivially because `userId` now
 * matched. A control present in one door of five is not a control.
 *
 * THE EVIDENCE THIS DEMANDS
 * -------------------------
 * The same the dashboard already demanded: either the row is already the
 * caller's, or there is a completed cooperative registration payment whose
 * reference matches the membership AND whose userId is the caller. That ties
 * the record to the caller's money rather than to a string they can edit.
 */

import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

export interface EmailMatchedMembership {
    /** The membership row's data. */
    data: Record<string, any> | null | undefined;
    /** Its document id, for logging. */
    id: string;
}

/**
 * True when this email-matched membership may be treated as, and bound to, the
 * caller.
 *
 * `db` is passed in rather than imported so this module stays free of the
 * "use server" adapter graph and can be unit-tested without it.
 */
export async function mayClaimMembershipByEmail(
    db: any,
    membership: EmailMatchedMembership,
    userId: string,
): Promise<boolean> {
    const data = membership.data;
    if (!data) return false;

    // Already theirs.
    if (data.userId === userId) return true;

    // Somebody else's, explicitly. Never claimable.
    if (data.userId && data.userId !== userId) {
        logger.warn(
            "[membership-claim] email matched a membership owned by another user — not claiming",
            { membershipId: membership.id, callerId: userId },
        );
        return false;
    }

    // Orphaned: claimable only on proof that the caller paid for it.
    if (!data.paymentReference) return false;

    const proof = await db
        .collection(COLLECTIONS.PROCESSED_PAYMENTS)
        .where("reference", "==", data.paymentReference)
        .limit(1)
        .get();

    const claimable = !proof.empty && proof.docs[0].data()?.userId === userId;

    if (!claimable) {
        logger.warn(
            "[membership-claim] email matched an orphaned membership but no payment ties it to the caller — not claiming",
            { membershipId: membership.id, callerId: userId },
        );
    }

    return claimable;
}
