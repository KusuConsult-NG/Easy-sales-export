import "server-only";

import { rateLimit } from "@/lib/rate-limiter";
import { rateLimitConfig } from "@/lib/rate-limits.config";

/**
 *   #641 THE WITHDRAWAL RATE LIMIT GUARDED THE ONE DOOR NOBODY USES.
 *
 *   `rateLimitConfig.withdrawal` — "very strict (financial security)", five per
 *   minute — had exactly ONE consumer in this codebase:
 *
 *       src/app/api/cooperative/withdraw/route.ts
 *
 *   and nothing in the application calls that route. Every mention of the path
 *   anywhere else in src is prose in a comment. The member-facing screens call
 *   SERVER ACTIONS instead, and not one of them had a limiter:
 *
 *     cooperatives/(member)/withdraw       submitWithdrawalRequestAction
 *     cooperatives/(member)/fixed-savings  withdrawMaturedFixedSavingsAction
 *     wave/(member)/earnings               withdrawEarningsAction
 *
 *   So the strict financial limit was real for a door with no callers and absent
 *   from the three a member actually presses. This codebase's most frequent
 *   defect, on the operation where it is least affordable.
 *
 * ── WHAT IT COSTS, STATED PLAINLY ───────────────────────────────────────────
 *
 *   A withdrawal request is not a read. Each one DEBITS the member's savings,
 *   moves the amount into `lockedBalance`, and writes a row an administrator has
 *   to approve or reject. The floor check bounds the total (a member cannot take
 *   their balance below the minimum) but nothing bounded the COUNT: at the
 *   minimum of ₦1,000 a request, a balance can be fragmented into as many
 *   pending rows as it divides into, each one locked and each one landing in the
 *   admin queue. A retry loop on a flaky connection does it by accident.
 *
 * ── ONE LIMITER, NOT ONE PER DOOR ───────────────────────────────────────────
 *
 *   The limiter instance is shared rather than constructed at each call site,
 *   because `rateLimit()` builds its own counter and four counters named
 *   "withdrawal" would be four separate budgets — which is the same defect
 *   wearing the shape of a fix. `rate-limits.config.ts` already records what
 *   happens when limits share or split a key space by accident.
 *
 *   Keyed on the ACCOUNT, matching the route's own note: this operation is
 *   authenticated, and Nigerian mobile networks share IPs heavily, so an IP key
 *   would lock members out of their own money for their neighbours' activity.
 */

/** The one counter. Exported so the HTTP door shares it rather than build a second. */
export const withdrawalLimiter = rateLimit(rateLimitConfig.withdrawal);

export interface WithdrawalRateLimit {
    allowed: boolean;
    /** Whole seconds until the window reopens. 0 when allowed. */
    retryAfterSeconds: number;
    /** Ready to return as an action error. Empty when allowed. */
    message: string;
}

/**
 * May this member submit another withdrawal right now?
 *
 * Call it AFTER the session is resolved and BEFORE anything moves: a limiter
 * that runs after the debit has not limited anything.
 */
export async function checkWithdrawalRateLimit(userId: string): Promise<WithdrawalRateLimit> {
    const result = await withdrawalLimiter.check(userId);
    if (result.success) {
        return { allowed: true, retryAfterSeconds: 0, message: "" };
    }

    //   `reset` is an absolute epoch-milliseconds instant from both the Upstash
    //   window and the in-memory fallback. Reported as a duration because that
    //   is what a person can act on, and floored at one second so a message
    //   never says "try again in 0 seconds".
    const retryAfterSeconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));

    return {
        allowed: false,
        retryAfterSeconds,
        message:
            `Too many withdrawal requests. For your account's security this is limited to `
            + `${result.limit} per minute — please try again in ${retryAfterSeconds} second`
            + `${retryAfterSeconds === 1 ? "" : "s"}.`,
    };
}
