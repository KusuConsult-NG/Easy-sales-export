/**
 *   #493 A DELIVERY ESTIMATE IS A DAY. IT WAS BEING PROMISED TO THE MINUTE.
 *
 *   _updateOrderStatusAction wrote it like this, when a seller marked an order
 *   shipped:
 *
 *       const estimatedDate = new Date();
 *       estimatedDate.setDate(estimatedDate.getDate() + 7);
 *       updateData.estimatedDeliveryDate = estimatedDate;
 *
 *   `new Date()` carries the current TIME OF DAY, and two of the three screens
 *   that render the field print hour and minute:
 *
 *       Est. Delivery    12 Sep 2026, 14:32
 *
 *   14:32 is the moment the seller clicked a button. It says nothing about when
 *   anything arrives, and the buyer reads it as a delivery time.
 *
 *   AND THE THREE SCREENS DISAGREED. Two used formatDateTime, one used
 *   formatLocalDate — the same stored value rendered two ways, and the buyer can
 *   reach two of the three. A value the buyer and the seller read differently is
 *   a disagreement waiting to become a dispute, which is why the formatter lives
 *   here rather than being chosen per screen.
 *
 *   SEVEN DAYS IS NOT CHANGED. Whether a Lagos-to-Lagos order and a
 *   Lagos-to-Maiduguri order deserve the same window is a logistics decision
 *   this repository holds no data for — and it is the decision
 *   lib/validations/marketplace.ts was right to refuse to invent. What changes
 *   is that the number is named and stated once, so revisiting it is one edit
 *   rather than a search.
 */

/**
 * How long after shipping the platform estimates delivery.
 *
 * Stated once. It was an inline `+ 7` inside a status-transition branch, which
 * is where a number goes to be forgotten.
 */
export const DELIVERY_ESTIMATE_DAYS = 7;

/**
 * The estimate for an order shipped at `shippedAt`.
 *
 * END OF THE SEVENTH DAY, not the same clock time seven days later. Two
 * reasons, and the second is the one that matters:
 *
 *   - it is what the value MEANS. Nobody is promising 14:32.
 *   - a comparison of "is this order late" against a mid-morning timestamp
 *     fires at breakfast on the day the order was promised for, which would
 *     make an order late on the day it is due.
 */
export function estimatedDeliveryFrom(shippedAt: Date = new Date()): Date {
    const estimate = new Date(shippedAt.getTime());
    estimate.setDate(estimate.getDate() + DELIVERY_ESTIMATE_DAYS);
    //   Local end-of-day: the buyer and the seller are in the same market, and
    //   a date shown to both should turn over at their midnight rather than
    //   UTC's.
    estimate.setHours(23, 59, 59, 999);
    return estimate;
}

/**
 * How the estimate is shown, on every screen that shows it.
 *
 * A DAY, with no time. Returns "" for a missing value rather than "Unknown":
 * all three call sites guard on the field before rendering the row, so the
 * empty string is unreachable there — and a formatter that answers "Unknown"
 * would print that word the day one of them stops guarding.
 */
export function formatDeliveryEstimate(value: Date | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';

    const date = value instanceof Date ? value : new Date(value as string);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}
