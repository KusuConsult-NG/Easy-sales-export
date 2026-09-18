/**
 * How an order's money is split between the platform and the seller.
 *
 *   #271 THE PAYOUT FALLBACK USED A DIFFERENT FORMULA FROM THE ESCROW ROW,
 *        UNDER A COMMENT SAYING THEY AGREED.
 *
 *        The three escrow creators all write the same thing:
 *
 *            platformFee = Math.round(gross * platformFeePercentage)
 *            netAmount   = gross - platformFee
 *
 *        The payout path's fallback — used when an escrow row predates
 *        netAmount — wrote:
 *
 *            sellerAmount = Math.floor(gross * (1 - platformFeePercentage))
 *
 *        and carried the note "It uses the CONFIGURED percentage rather than a
 *        literal, so the two paths still agree." Sharing the percentage was the
 *        fix that comment describes, and it was not enough: the two EXPRESSIONS
 *        are not the same function.
 *
 *        Measured across every whole-naira gross from 500 to 20,000 at 5%, they
 *        disagree on 8,775 of 19,501 values — 45% of them — always by exactly
 *        NGN 1, always in the seller's disfavour:
 *
 *            gross 1,002  ->  escrow row says 952, the fallback paid 951
 *
 *        The algebra, so it is not a coincidence anyone has to re-derive: with
 *        f = frac(gross x rate) and 0 < f < 0.5, Math.round rounds the fee DOWN
 *        while Math.floor on the complement rounds the net DOWN too, so the
 *        same naira is deducted twice.
 *
 *        This is #113's family ("the admin release tells the seller the gross
 *        and pays the net") and #270's, which found the WAVE commission floored
 *        on one side and unrounded on the other. Three times now the same
 *        shape: one figure, two expressions, a comment asserting they match.
 *
 * ROUNDING IS UNCHANGED ON PURPOSE
 * --------------------------------
 * This is the escrow creators' existing rule, extracted verbatim — not a new
 * one. fee + net === gross exactly, at whole naira, which is the property that
 * matters and which already held on that side. There is no defect in the
 * granularity here, so changing it would be adjusting money for the sake of
 * tidiness. #270's WAVE case was different: there the two sides genuinely
 * disagreed and one of them had to move.
 */

/**
 * The platform's cut of one seller's share of an order.
 *
 * Returns 0 for anything unusable rather than NaN — a NaN fee makes a NaN net,
 * and a NaN reaching a payout or a ledger row is unrecoverable.
 */
export function platformFeeFor(grossAmount: unknown, feePercentage: unknown): number {
    const gross = Number(grossAmount);
    const rate = Number(feePercentage);

    if (!Number.isFinite(gross) || !Number.isFinite(rate)) return 0;
    if (gross <= 0 || rate <= 0) return 0;

    // Never more than the order itself, whatever the configured rate says.
    return Math.min(gross, Math.round(gross * rate));
}

/**
 * What the seller is owed — the figure written to escrow.netAmount and the
 * figure the payout must pay.
 *
 * Defined as the complement of the fee rather than computed independently, so
 * fee + net === gross by construction. That identity is what the old fallback
 * broke.
 */
export function sellerNetFor(grossAmount: unknown, feePercentage: unknown): number {
    const gross = Number(grossAmount);
    if (!Number.isFinite(gross) || gross <= 0) return 0;

    return gross - platformFeeFor(gross, feePercentage);
}

/**
 * The same total, split into the two charges that make it up.
 *
 *   #882 THE OWNER: "The commission is 3% and the escrow fee is 2%."
 *
 *   The platform withheld one five-per-cent figure and called it a platform
 *   fee. It is two charges, and the Farm Nation terms a seller ticks to accept
 *   already itemised them — at different numbers, which is its own defect and
 *   is corrected alongside this.
 *
 * ── THE ESCROW SHARE IS THE REMAINDER, AND THAT IS THE WHOLE POINT ──────────
 *
 *   Rounding two shares independently does NOT reliably reproduce the rounded
 *   total. At a gross of 1,050 with 3% and 2%: round(31.5) = 32, round(21) = 21,
 *   sum 53 — while the total is round(52.5) = 53. It agrees there and it does
 *   not always, and the case where it disagrees is #271 exactly: one figure, two
 *   expressions, and a note claiming they match.
 *
 *   So the TOTAL is computed by the existing function that every payout already
 *   uses, the commission is rounded, and the escrow fee is whatever is left.
 *   commission + escrow === platformFeeFor(gross, total) by construction, which
 *   is the property the ledger needs — the seller's net is unchanged and the
 *   breakdown can never fail to add up.
 *
 *   NOTHING HERE CHANGES WHAT ANYBODY IS PAID. It names the parts of a number
 *   that was already being withheld.
 */
export interface FeeSplit {
    /** The whole withholding — identical to platformFeeFor(gross, total). */
    total: number;
    commission: number;
    escrow: number;
}

export function feeSplitFor(
    grossAmount: unknown,
    fees: { platformFeePercentage?: unknown; commissionPercentage?: unknown } | null | undefined,
): FeeSplit {
    const total = platformFeeFor(grossAmount, fees?.platformFeePercentage);
    if (total <= 0) return { total: 0, commission: 0, escrow: 0 };

    const commission = Math.min(total, platformFeeFor(grossAmount, fees?.commissionPercentage));

    return { total, commission, escrow: total - commission };
}
