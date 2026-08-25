/**
 * Is this payment the right amount for this order? — one answer.
 *
 * WHY THIS EXISTS
 * ---------------
 * A marketplace order payment is fulfilled by TWO paths, and they validated the
 * amount differently:
 *
 *   _payment_verify.ts        the interactive path, when the buyer is redirected
 *                             back. Refused a payment outside the CURRENT
 *                             minOrderAmount/maxOrderAmount, and refused ANY
 *                             mismatch against the order total — over or under.
 *
 *   payments/service.ts       processMarketplaceOrder, used by the Paystack
 *                             WEBHOOK and by reconcile-paystack's auto-heal.
 *                             Checked no fee bounds at all, and refused only
 *                             UNDERpayment; an overpayment logged a warning and
 *                             fulfilled.
 *
 * So the same payment got different answers depending on which path reached it
 * first — and those two race by design: the interactive path's own comment says
 * "the webhook usually finishes before the user is redirected back".
 *
 * IT WAS WORSE THAN A RACE
 * ------------------------
 * A payment the interactive path refused never reached claimPaymentOnce, so it
 * has no `processed_payments` row. reconcile-paystack compares Paystack's
 * successful transactions against that collection, finds it missing, and
 * AUTO-HEALS it by calling processMarketplaceOrder — which does not apply the
 * checks that rejected it. The validation was undone by the reconciler, on a
 * schedule, unattended.
 *
 * THE RULES, AND WHY EACH ONE
 * ---------------------------
 * UNDERPAYMENT IS REFUSED. Both paths already agreed, and fulfilling an order
 * for less than it costs is the one case where refusing is clearly right.
 *
 * OVERPAYMENT IS ACCEPTED AND FLAGGED, not refused. Refusing leaves a buyer who
 * has been charged with no order and an error message — the outcome this codebase
 * treats as the worst one everywhere else it appears (see the "PAID BUT
 * UNFULFILLABLE" handling in _payment_verify.ts). The webhook already behaved
 * this way. What was missing is the record: export investments route an
 * overpayment to `overfunded_review` and keep it out of revenue, and marketplace
 * orders had no equivalent, so the surplus was simply unrecorded.
 *
 * PLACEMENT-TIME FEE BOUNDS ARE NOT RE-APPLIED. `minOrderAmount` is enforced at
 * placement, in three places in _payment_orders.ts. Re-checking it after the money
 * has been taken cannot prevent anything — the order exists and the buyer has
 * paid — and it CAN strand them: an admin changing the fee configuration between
 * placement and payment turns a valid order into "Invalid payment amount". The
 * order total is the thing worth checking at this point, and it is checked.
 */

/** Naira of rounding slack, matching what both paths already allowed. */
export const ORDER_AMOUNT_TOLERANCE = 1;

export type OrderPaymentVerdict =
    | { ok: true; overpaidBy: 0 }
    | { ok: true; overpaidBy: number }
    | { ok: false; reason: "underpaid"; shortfall: number; message: string }
    | { ok: false; reason: "no_expected_amount"; message: string };

/**
 * Compares what was paid against what the order costs.
 *
 * `expectedAmount` is the ORDER's total, not the gateway metadata's copy of it.
 * The interactive path compared against `metadata.totalAmount` — a value that
 * travelled to Paystack and back — while the webhook compared against
 * `orderData.totalAmount`. The order is the record the goods are shipped against,
 * so it is the one that decides.
 */
export function checkOrderPaymentAmount(
    amountPaid: number,
    expectedAmount: number | null | undefined,
): OrderPaymentVerdict {
    const paid = Number(amountPaid);

    if (!Number.isFinite(paid) || paid <= 0) {
        return {
            ok: false,
            reason: "underpaid",
            shortfall: Number(expectedAmount) || 0,
            message: "No payment amount could be read for this order.",
        };
    }

    const expected = Number(expectedAmount);
    if (!Number.isFinite(expected) || expected <= 0) {
        // Refused rather than waved through. An order with no total is not
        // something to fulfil against a payment of any size.
        return {
            ok: false,
            reason: "no_expected_amount",
            message: "This order has no total recorded, so the payment cannot be matched to it.",
        };
    }

    if (paid + ORDER_AMOUNT_TOLERANCE < expected) {
        return {
            ok: false,
            reason: "underpaid",
            shortfall: Number((expected - paid).toFixed(2)),
            message: "The amount paid is less than this order's total.",
        };
    }

    const surplus = paid - expected;
    if (surplus > ORDER_AMOUNT_TOLERANCE) {
        return { ok: true, overpaidBy: Number(surplus.toFixed(2)) };
    }

    return { ok: true, overpaidBy: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this order total within the configured bounds?
 *
 *   #272 THE CEILING WAS REMOVED ON A RATIONALE THAT ONLY HELD FOR THE FLOOR.
 *
 *        _payment_verify.ts dropped a pair of bounds from the PAYMENT path and
 *        explained why: "minOrderAmount is already enforced in three places in
 *        _payment_orders.ts when the order is created, so re-checking here
 *        prevents nothing — and an admin changing the fee configuration between
 *        placement and payment turned a charged buyer's valid order into
 *        'Invalid payment amount'."
 *
 *        Correct, and an argument about ONE bound. The sentence names
 *        minOrderAmount and the deletion took two. The floor kept its three
 *        placement-time checks; the ceiling had none to fall back on, so
 *        removing the re-check removed the only enforcement it had. A scan of
 *        every non-comment line in src found zero live readers of
 *        maxOrderAmount afterwards.
 *
 *        So the ceiling belongs where that comment says bounds belong — at
 *        PLACEMENT, beside the floor, at the same three sites — and NOT back in
 *        the payment path, where it would reintroduce the charged-buyer failure
 *        the removal was right to eliminate.
 *
 * An unconfigured maximum means NO maximum rather than zero. Failing closed is
 * right for a permission and wrong for a limit nobody set — the opposite
 * direction from #245, and for the opposite reason.
 */
export type OrderBoundsVerdict =
    | { ok: true }
    | { ok: false; reason: "below_minimum" | "above_maximum" | "unreadable"; message: string };

export function checkOrderAmountBounds(
    totalAmount: unknown,
    fees: { minOrderAmount?: number; maxOrderAmount?: number },
): OrderBoundsVerdict {
    const total = Number(totalAmount);

    // #112: the escrow amount check failed OPEN when the amount could not be
    // read. A bound that cannot evaluate is not a bound.
    if (!Number.isFinite(total) || total < 0) {
        return { ok: false, reason: "unreadable", message: "Invalid order amount" };
    }

    const min = Number(fees?.minOrderAmount);
    if (Number.isFinite(min) && total < min) {
        return {
            ok: false,
            reason: "below_minimum",
            message: `Minimum order amount is NGN ${min.toLocaleString()}`,
        };
    }

    const max = Number(fees?.maxOrderAmount);
    if (Number.isFinite(max) && max > 0 && total > max) {
        return {
            ok: false,
            reason: "above_maximum",
            message: `Maximum order amount is NGN ${max.toLocaleString()}. Please contact support for a larger order.`,
        };
    }

    return { ok: true };
}
