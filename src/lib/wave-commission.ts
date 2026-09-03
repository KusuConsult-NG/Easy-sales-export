/**
 * What a WAVE member earns on one sale.
 *
 *   #270 THE COMMISSION WAS FLOORED WHEN CREDITED AND UNROUNDED WHEN SHOWN.
 *
 *        Two computations of one figure, in two files, with two different
 *        rounding rules:
 *
 *          order-management.ts   Math.floor(totalAmount * waveCommissionRate)
 *                                — whole naira, rounded DOWN, and this is the
 *                                  one that increments the balance she can
 *                                  actually withdraw
 *          wave/_wv_earnings.ts  saleAmount * commissionRate
 *                                — an unrounded float, and this is the one
 *                                  behind the "Total earnings" figure on her
 *                                  screen
 *
 *        So the two numbers on the WAVE earnings page disagree, and they
 *        disagree in the direction that matters: she is shown more than she can
 *        take. Measured over ten ordinary sales at 5%:
 *
 *          credited (floor per sale)   NGN 2,531
 *          displayed (unrounded)       NGN 2,538.3500000000004
 *          gap she can see and not have  NGN 7.35
 *
 *        Up to NGN 1 lost per sale, permanently, and the discrepancy grows with
 *        every order. A member with a few hundred sales is looking at a figure
 *        that is wrong by hundreds of naira.
 *
 *        #253 unified the RATE across these same two files — one commission
 *        rate, two live copies "kept in step by nobody". The rate was made
 *        shared and the ROUNDING was not, so the two copies went on disagreeing
 *        about the same money by a different route. One level down, same shape.
 *
 *        The float is the smaller half of it. `saleAmount * 0.05` summed over
 *        many sales accumulates binary residue — 2538.3500000000004 rather than
 *        2538.35 — and _wv_earnings.ts PERSISTS that number as
 *        waveEarningsBalance when it backfills, into a field the live path
 *        otherwise increments with whole integers.
 *
 * WHY KOBO AND NOT FLOOR
 * ----------------------
 * Naira has kobo; a commission of NGN 99.95 is a real amount and the naira is
 * not the smallest unit this platform handles — every Paystack call in the
 * codebase converts to integer kobo precisely because of that. Flooring to
 * whole naira quietly keeps the fraction, always in the platform's favour, and
 * nothing anywhere records that as a decision: it has no comment defending it,
 * while the rate beside it has a long one. It reads as what `Math.floor`
 * happened to do rather than what anyone chose.
 *
 * THIS CHANGES WHAT MEMBERS ARE CREDITED, upward, by under NGN 1 per sale. If
 * the intent really was to floor, this is the one function to change and both
 * call sites follow — which is the point of it being one function.
 */

/** Kobo per naira. The smallest unit any of this rounds to. */
const KOBO = 100;

/**
 * The commission on one sale, exact to the kobo.
 *
 * Returns 0 rather than NaN for an unusable input. A NaN here would propagate
 * into a balance through FieldValue.increment and be unrecoverable — the same
 * reasoning as the amount guard in paystack-transfer.ts.
 */
export function waveCommission(saleAmount: unknown, commissionRate: unknown): number {
    const amount = Number(saleAmount);
    const rate = Number(commissionRate);

    if (!Number.isFinite(amount) || !Number.isFinite(rate)) return 0;
    if (amount <= 0 || rate <= 0) return 0;

    return Math.round(amount * rate * KOBO) / KOBO;
}

/**
 * A running total of commissions, exact to the kobo.
 *
 * Adding kobo-exact values in floating point still drifts — 99.95 + 99.95 is
 * not reliably 199.90 — so the sum is taken in whole kobo and converted once at
 * the end. This is what stops a displayed balance from reading
 * 2538.3500000000004, and what stops that number being written into
 * waveEarningsBalance by the backfill.
 */
export function sumWaveCommissions(commissions: readonly number[]): number {
    const kobo = commissions.reduce(
        (total, c) => total + (Number.isFinite(c) ? Math.round(c * KOBO) : 0),
        0,
    );
    return kobo / KOBO;
}
