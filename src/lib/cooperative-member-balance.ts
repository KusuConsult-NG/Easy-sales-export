/**
 * One member's savings, under two field names.
 *
 * COOPERATIVE_MEMBERS is the current home for a member's balance and keys it
 * `savingsBalance`. Before it there was a nested subcollection —
 * `cooperatives/{cooperativeId}/members/{userId}` — and those documents key the
 * same money `balance`. Nothing in this codebase creates a nested member any
 * more, but four places still read or write one, and they did not agree:
 *
 *   dashboard.ts                    READS  `balance` only, in the nested branch
 *                                   (the root branch one line above already
 *                                   read `savingsBalance ?? balance`)
 *   cron/release-escrow             WRITES `savingsBalance`
 *   _coop_admin_money reject        WRITES `balance`
 *   _coop_admin_money approve       WRITES `lockedBalance` (unambiguous)
 *
 * So an export return paid into a legacy member's savings by the cron landed
 * in `savingsBalance`, and the dashboard — reading `balance` for exactly those
 * members — showed none of it. The member's export ROI was invisible to them.
 * A rejected withdrawal refunded the other field, which the cron path in turn
 * never reads.
 *
 * Two names for one figure, with the writers split between them, is the same
 * shape as the contribution/cooperative_contribution and the verificationStatus
 * findings. The answer is the same: one module both sides import.
 *
 * WHY NOT SIMPLY REPOINT EVERYTHING AT `savingsBalance`
 * -----------------------------------------------------
 * Because a legacy document may hold its money in `balance`, and incrementing
 * `savingsBalance` on it would not migrate that money — it would create a
 * second field beside it and split the member's savings across two numbers.
 * The reads take either; the writes go to whichever field the document already
 * carries, and to `savingsBalance` when it carries neither.
 */

/** Field names a cooperative member's spendable savings may live under. */
export const COOPERATIVE_BALANCE_FIELDS = ["savingsBalance", "balance"] as const;

export type CooperativeBalanceField = (typeof COOPERATIVE_BALANCE_FIELDS)[number];

/** The canonical field — what a document gets when it carries neither. */
export const CANONICAL_BALANCE_FIELD: CooperativeBalanceField = "savingsBalance";

/**
 * A member's savings, from whichever field the document uses.
 *
 * Non-numeric and absent values read as 0 rather than NaN: this figure is
 * rendered into a dashboard and summed into platform totals, and a NaN in
 * either is worse than a zero.
 */
export function readCooperativeBalance(data: Record<string, unknown> | null | undefined): number {
    const raw = data?.savingsBalance ?? data?.balance ?? 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
}

/**
 * The field an increment should be applied to for this document.
 *
 * `savingsBalance` wins when both are present — it is the canonical name, and a
 * document carrying both is already inconsistent, so the increment should at
 * least land on the one every current reader prefers.
 */
export function balanceFieldOf(
    data: Record<string, unknown> | null | undefined,
): CooperativeBalanceField {
    if (data && data.savingsBalance !== undefined) return "savingsBalance";
    if (data && data.balance !== undefined) return "balance";
    return CANONICAL_BALANCE_FIELD;
}
