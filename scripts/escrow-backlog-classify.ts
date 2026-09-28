/**
 *   #968 THE CLASSIFIER FOR THE ESCROWS THE FIVE-DAY RULE CANNOT REACH.
 *
 *   api/cron/release-escrow releases an unconfirmed escrow five days after
 *   DISPATCH, reading a `shippedAt` that _updateOrderStatusAction stamps onto the
 *   escrow row when the seller marks the order shipped.
 *
 *   Every escrow that existed before that shipped has no such stamp, and a
 *   `where` on a missing field does not match it. That is deliberate — asked what
 *   the first run should do with the rows already sitting there, the owner chose:
 *   report them, do not pay them.
 *
 *   The cron reports a COUNT, which it can get from two aggregates. Telling the
 *   operator anything more useful means reading the ORDERS as well, to find out
 *   whether a row has no stamp because it predates the rule or because the goods
 *   have genuinely not moved. That join is what this classifier is for, and why
 *   it lives in a script rather than on every cron tick.
 *
 *   WHY IT IS A PURE FUNCTION IN ITS OWN FILE. The same reason
 *   export-funding-goal-kind.ts exists: the decision about a row is the part
 *   worth testing, and it cannot be tested through a script that needs a
 *   production database and a service-role key. #967's note on that backfill
 *   records what it cost to find out the rule by guessing at it three times.
 *
 *   ONE THING THIS DELIBERATELY DOES NOT DO: decide anything. Releasing a
 *   backlogged escrow moves real money to a seller on an order no buyer
 *   confirmed, and which of these an operator should release is a judgement about
 *   specific customers, not an outcome a script should reach on its own.
 */

/** What the classifier knows about one escrow row and the order behind it. */
export interface BacklogInput {
    escrowId: string;
    /** The escrow row's status, already normalised to the ESCROW_STATUSES vocabulary. */
    escrowStatus: string | null;
    /** The dispatch stamp ON THE ESCROW ROW. Absent for every row predating #968. */
    escrowShippedAt: Date | null;
    /** The dispatch stamp ON THE ORDER, which _updateOrderStatusAction has always written. */
    orderShippedAt: Date | null;
}

export type BacklogVerdict =
    /** The cron will release this on its next run. Not backlog. */
    | { outcome: 'cron-will-pay' }
    /**
     * Shipped before the rule existed and already past the window: the seller has
     * been waiting longer than the policy allows and nothing will ever pay them,
     * because the stamp is only written at the dispatch event and that has passed.
     */
    | { outcome: 'overdue-unreachable'; daysSinceDispatch: number }
    /**
     * Shipped before the rule existed, not yet past the window. Will become
     * overdue-unreachable and never be paid by the cron, for the same reason.
     */
    | { outcome: 'pending-unreachable'; daysSinceDispatch: number }
    /** The goods have not been dispatched, so there is correctly no clock. */
    | { outcome: 'not-dispatched' }
    /** Confirmed, disputed or settled — another path owns this row. */
    | { outcome: 'not-awaiting'; status: string | null };

/**
 * The statuses the dispatch clock governs.
 *
 * Duplicated from lib/escrow-status rather than imported: scripts/ is outside the
 * Next.js path alias, and pulling `@/lib/...` in here has broken the docker build
 * context check before. Two values, and the test asserts they still match the
 * source of truth — which is the only reason a copy is acceptable.
 */
export const DISPATCH_AWAITING_STATUSES = ['funded', 'in_transit'] as const;

export function classifyBacklogRow(
    input: BacklogInput,
    windowDays: number,
    now: Date = new Date(),
): BacklogVerdict {
    const { escrowStatus, escrowShippedAt, orderShippedAt } = input;

    if (!escrowStatus || !(DISPATCH_AWAITING_STATUSES as readonly string[]).includes(escrowStatus)) {
        return { outcome: 'not-awaiting', status: escrowStatus };
    }

    //   Stamped: the cron's own query reaches it and this script has no business
    //   reporting it as stranded. Whether it is PAST the window is the cron's
    //   decision, not this one's — a row stamped an hour ago is still "the cron
    //   will pay this", just not yet.
    if (escrowShippedAt) return { outcome: 'cron-will-pay' };

    //   No stamp and no dispatch on the order either. The seller has not shipped,
    //   so no deadline should be running. This is the correct state, not backlog.
    if (!orderShippedAt) return { outcome: 'not-dispatched' };

    /*
     *   No stamp, but the ORDER says the goods went out — so this shipped before
     *   #968 and will never be stamped, because the stamp is written at the
     *   dispatch event and that moment has passed. These are the rows a human has
     *   to release, and they do not age out of needing one.
     */
    const days = (now.getTime() - orderShippedAt.getTime()) / 86_400_000;
    //   Floored, not rounded: a row 4.9 days out has not completed five days, and
    //   reporting it as five would put it in the overdue column a day early.
    const daysSinceDispatch = Math.max(0, Math.floor(days));

    return days >= windowDays
        ? { outcome: 'overdue-unreachable', daysSinceDispatch }
        : { outcome: 'pending-unreachable', daysSinceDispatch };
}
