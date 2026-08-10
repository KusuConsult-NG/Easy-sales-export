/**
 * Cooperative balance rules that more than one path has to agree on.
 *
 * The minimum balance lived as a local `const MINIMUM_BALANCE = 5000` inside
 * the withdrawal route. That was fine while withdrawal was the only thing that
 * could reduce savings. Repaying a loan from savings is a second such path, and
 * two copies of a money rule in two files is how the copies come to disagree —
 * the recurring shape in this codebase is a rule applied to one path and not to
 * its sibling.
 *
 * It is exported as a value rather than read from configuration because both
 * call sites also render it in the message shown to the member, and the number
 * they are told must be the number that was enforced.
 */

/** Naira that must remain in a member's savings after any reduction. */
export const COOPERATIVE_MINIMUM_BALANCE = 5000;

/** "₦5,000" — for the message that explains a refused debit. */
export function formatMinimumBalance(): string {
    return `₦${COOPERATIVE_MINIMUM_BALANCE.toLocaleString()}`;
}

/**
 * What a member may actually take out, given a balance.
 *
 * Never negative: a member already at or under the floor has nothing available,
 * and a negative "available" figure rendered into a sentence reads as a debt.
 */
export function availableAboveFloor(balance: number): number {
    return Math.max(0, Number(balance || 0) - COOPERATIVE_MINIMUM_BALANCE);
}
