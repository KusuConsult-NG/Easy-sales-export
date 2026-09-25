/**
 * What an export investor put in, what comes back, and what they gained.
 *
 *   THE OWNER: "how can member's measure there ROI on export window"
 *
 * ── ONE FIGURE, STORED ONCE, READ FOUR WAYS ─────────────────────────────────
 *
 *   `expectedReturn` is written by both investment paths as
 *
 *       amount * exportWindowReturnMultiplier(window)
 *
 *   — see export-payment.ts and export/_ex_investments.ts. So it is the GROSS
 *   amount coming back: capital AND profit. ₦100,000 at the platform's 20%
 *   stores 120,000.
 *
 *   Four screens read that one number and three of them got it wrong, each in
 *   a different direction, and none of them agreed with the tile beside it:
 *
 *     portfolio, the tile     (totalReturns - totalInvested) / totalInvested
 *                             = 20%.  CORRECT, and the only one.
 *
 *     portfolio, the ROW      expectedReturn / amount = 120%, under a column
 *                             headed "ROI". Same page, same money, six times
 *                             the number in the tile above it.
 *
 *     portfolio + detail,     `+₦120,000` in green beside "Expected Return" on
 *     the money labels        a ₦100,000 investment. The plus sign and the
 *                             colour both say GAIN; the number is the gross.
 *
 *     investment detail,      `amount + expectedReturn` = ₦220,000 under the
 *     "Total Payout"          words Total Payout. The capital counted twice —
 *                             a member told they will be paid 2.2x what the
 *                             platform pays 1.2x on.
 *
 *   None of these is a rounding disagreement. They are four different answers
 *   to "what do I get", and a member comparing two screens has no way to know
 *   which to believe.
 *
 * ── SO THE THREE QUANTITIES ARE NAMED, ONCE ─────────────────────────────────
 *
 *     CAPITAL    what they paid in
 *     RETURN     what comes back in total — capital plus profit. This is what
 *                `expectedReturn` holds and what a payout transfers.
 *     PROFIT     RETURN - CAPITAL. What "+₦" and a green number mean.
 *
 *   ROI is PROFIT over CAPITAL, which is the definition, and it is the same
 *   arithmetic for one investment and for a whole portfolio — so both come
 *   from `roiPercent` below rather than from two expressions that happen to
 *   agree today.
 *
 *   NOTHING STORED CHANGES. `expectedReturn` still holds the gross, written by
 *   the same two paths, and the escrow-release cron still pays
 *   `amount * exportWindowReturnMultiplier(window)`. What changes is that the
 *   screens stop disagreeing about what that number means.
 */

const money = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** What comes back in total: capital plus profit. Never negative. */
export function investmentReturn(expectedReturn: unknown): number {
    return Math.max(0, money(expectedReturn));
}

/**
 * The gain alone — what a "+₦" label and a green number are claiming.
 *
 *   Clamped at zero rather than showing a negative gain, because a stored
 *   `expectedReturn` below the capital means a bad row, not a loss the platform
 *   is reporting: both writers compute it as `amount * multiplier` with the
 *   multiplier guaranteed positive.
 */
export function investmentProfit(capital: unknown, expectedReturn: unknown): number {
    return Math.max(0, investmentReturn(expectedReturn) - money(capital));
}

/**
 * Return on investment, as a whole percentage.
 *
 *   PROFIT over CAPITAL. The row that read `expectedReturn / capital` was
 *   reporting the return MULTIPLE — 120 where the answer is 20 — and it sat
 *   under a column headed ROI, one table below a tile that had it right.
 *
 *   Zero for a zero or missing capital, so a malformed row prints 0% rather
 *   than Infinity or NaN.
 */
export function roiPercent(capital: unknown, expectedReturn: unknown): number {
    const paid = money(capital);
    if (paid <= 0) return 0;
    return Math.round((investmentProfit(paid, expectedReturn) / paid) * 100);
}
