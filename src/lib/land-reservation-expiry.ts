/**
 * When a property reservation has been held long enough to be given back.
 *
 *   #140 A RESERVATION NEVER EXPIRED, AND `pendingSince` WAS WRITTEN FOR
 *        EXACTLY THAT AND READ BY NOTHING.
 *
 *        Two paths take a parcel off the market while one buyer proceeds, and
 *        both stamp the moment they did it:
 *
 *          _fn_purchases.ts        claims PURCHASABLE → "pending"
 *                                  patch: { pendingBuyerId, pendingSince }
 *          farm-nation-payment.ts  claims PURCHASABLE → "pending_escrow"
 *                                  patch: { pendingBuyerId, pendingSince }
 *
 *        Both release the hold when their own next write fails (#136, #139),
 *        and the buyer can cancel (#138). NOTHING RELEASES A HOLD THE BUYER
 *        SIMPLY WALKED AWAY FROM. A scan for a reader of `pendingSince` found
 *        one hit: the sentence in land-listing-status.ts recording that it has
 *        none.
 *
 *        So a buyer who opens the checkout and closes the tab takes the parcel
 *        off the market permanently. The owner cannot relist it. No other buyer
 *        can claim it — the claim starts from PURCHASABLE_STATUSES and the
 *        listing is not in one. And an admin cannot free it either, because
 *        #137 deliberately removed "pending" from the statuses an approval may
 *        overwrite, precisely so an approval could not seize a parcel somebody
 *        was paying for. Every one of those guards is correct; together they
 *        left the abandoned case with no way out at all.
 *
 *   WHY AN EXPIRY IS WELL-FOUNDED HERE AND WAS NOT FOR #196
 *
 *        #196 declined to expire export bookings because nothing recorded an
 *        agreed deadline, so an expiry would have had to invent one. The
 *        opposite is true here: `pendingSince` is the fact, it is written by
 *        both paths at the moment the hold is taken, and it is written for this.
 *
 *   THE TWO WINDOWS, AND WHY THEY DIFFER
 *
 *        A hold is not one thing. "pending_escrow" means the buyer has been
 *        handed to Paystack and is on the payment page; that is a matter of
 *        minutes, and a Paystack checkout session does not outlive an hour.
 *        "pending" means a purchase REQUEST exists and payment is being
 *        arranged between people, which on a land sale is measured in days.
 *
 *        Both are deliberately generous. The cost of releasing too early is
 *        #135 rebuilt — two buyers, two escrows, one parcel — and the cost of
 *        releasing too late is a parcel off the market a while longer. Those
 *        are not symmetrical, so the thresholds sit well clear of the real
 *        durations rather than close to them.
 *
 *        THE CAS CLAIM IS THE REAL GUARANTEE, not the clock. The sweep moves a
 *        listing only OUT OF the exact hold status it read, so a payment that
 *        has landed — moving the listing to pending_payment, pending_transfer
 *        or sold — makes the claim refuse. The threshold decides when to try;
 *        the claim decides whether it is safe.
 *
 * This module is pure and imports nothing, so mocking the database layer cannot
 * break it — #381's lesson, where a shared rule that reached into a
 * database-backed module took three unrelated suites down with it.
 */

/**
 * The statuses that mean "held for one buyer", and how long each may be held.
 *
 * Keyed by status rather than expressed as one number, because the two holds
 * describe different waits. A status absent from this map is not a hold and is
 * never swept.
 */
export const RESERVATION_HOLD_HOURS: Readonly<Record<string, number>> = {
    /** A purchase request exists and payment is being arranged. Seven days. */
    pending: 24 * 7,
    /** The buyer is on the Paystack page right now. Two hours. */
    pending_escrow: 2,
};

export const RESERVATION_HOLD_STATUSES: readonly string[] =
    Object.keys(RESERVATION_HOLD_HOURS);

/** Is this a status that holds a parcel for one buyer? */
export function isReservationHold(status: unknown): boolean {
    return RESERVATION_HOLD_STATUSES.includes(String(status ?? ""));
}

/**
 * When the hold was taken, across both shapes the row can carry.
 *
 * land_listings rows hold a Firestore Timestamp or an ISO string depending on
 * which writer produced them — the same split exportWindowEndDate handles.
 */
export function reservationStartedAt(value: unknown): Date | null {
    if (!value) return null;

    const raw = typeof (value as { toDate?: () => Date }).toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : value as string | number | Date;

    const d = new Date(raw as string);
    return Number.isNaN(d.getTime()) ? null : d;
}

export type ReservationVerdict =
    | { lapsed: true; heldForHours: number; allowedHours: number }
    | { lapsed: false; reason: "not_a_hold" | "no_timestamp" | "still_within_window" };

/**
 * Has this listing been held long enough to give it back?
 *
 * A HOLD WITH NO `pendingSince` IS LEFT ALONE. That is not a lapsed
 * reservation; it is a row this code cannot date, and guessing an age for it
 * would release parcels at random. The cron reports these separately so they
 * are visible rather than silently skipped — a hold nobody can date is exactly
 * the row an operator needs to look at, and there should be none, since both
 * writers stamp it.
 */
export function reservationHasLapsed(
    listing: { status?: unknown; pendingSince?: unknown } | null | undefined,
    now: Date = new Date(),
): ReservationVerdict {
    const status = String(listing?.status ?? "");
    if (!isReservationHold(status)) return { lapsed: false, reason: "not_a_hold" };

    const startedAt = reservationStartedAt(listing?.pendingSince);
    if (!startedAt) return { lapsed: false, reason: "no_timestamp" };

    const allowedHours = RESERVATION_HOLD_HOURS[status];
    const heldForHours = (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60);

    return heldForHours > allowedHours
        ? { lapsed: true, heldForHours, allowedHours }
        : { lapsed: false, reason: "still_within_window" };
}

/**
 * The fields that take a listing out of a hold, whoever is releasing it.
 *
 * `pendingSince` was NOT cleared by any of the three existing release paths —
 * the two failure rollbacks and the buyer's cancel all cleared `pendingBuyerId`
 * and `previousStatus` and left the timestamp behind. A field that outlives the
 * state it describes is how a sweep keyed on it comes to release the wrong row,
 * so all four paths clear the same three fields now, from one definition.
 *
 * `status` is deliberately NOT here: the caller decides what to restore it to,
 * and statusAfterCancellation needs the `previousStatus` this object clears.
 */
export function releasedReservationFields(): Record<string, null> {
    return { pendingBuyerId: null, pendingSince: null, previousStatus: null };
}
