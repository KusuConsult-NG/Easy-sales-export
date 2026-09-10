/**
 * How much of an export listing is left, and whether anybody is counting.
 *
 *   #582 EVERY PAID EXPORT ORDER WAS CANCELLED AS OUT OF STOCK.
 *
 *   Three names for one quantity, and no two of them met:
 *
 *     THE SELLER'S FORM COLLECTED NONE AT ALL. /export/products/create has
 *     fields for name, icon, category, origin, season, pricePerMT, minOrderMT,
 *     grades and certifications. There is no stock input, and the admin
 *     catalogue editor has none either.
 *
 *     submitExportProductAction VALIDATES `availableQuantityMT` — carefully,
 *     refusing a negative — a field no caller has ever sent.
 *
 *     AND THE FULFILMENT DECREMENTS `availableQuantity`, the MARKETPLACE's
 *     field name, on a collection that has never carried it.
 *
 *   decrement_many_or_fail reads `COALESCE((raw_data ->> field)::numeric, 0)`,
 *   so A FIELD THAT IS NOT THERE IS ZERO, and zero is short of any positive
 *   amount. Every export buyer order therefore reached:
 *
 *       logger.error("PAID BUT OUT OF STOCK — refund required")
 *       status: "cancelled_out_of_stock", paymentStatus: "paid_awaiting_refund"
 *
 *   The buyer was charged, the payment reference was already claimed so a retry
 *   is a no-op, and somebody has to refund by hand. Not on some rows: on every
 *   row, because no row anywhere carries the field.
 *
 * ── AN UNRECORDED STOCK IS NOT A STOCK OF ZERO ──────────────────────────────
 *
 *   That distinction is the whole fix, and it is the same reading this codebase
 *   already applies twice: a missing ceiling means uncapped in
 *   increment_within_ceiling (migration 015), and a missing minOrderMT means no
 *   minimum (#580). The platform has never recorded export stock, so it must
 *   not refuse orders on the strength of a number nobody has set.
 *
 *   A listing with a real, positive quantity is still counted down, and a
 *   genuine shortfall is still refused all-or-nothing — that is #279's fix and
 *   it is untouched. What changed is that "nobody is counting" now reads as
 *   "nobody is counting" rather than "none left".
 *
 *   THE NAME IS `availableQuantityMT`, because export is priced and ordered in
 *   metric tons and that is the name the validation already used. The
 *   marketplace keeps `availableQuantity`, which is correct for it: this was a
 *   field name copied across modules, not a shared rule.
 */

export const EXPORT_STOCK_FIELD = "availableQuantityMT";

/**
 * The recorded stock of an export listing, or null when none is recorded.
 *
 * Only a finite number that is zero or more counts. A row that stores a string
 * that will not parse, a negative, or nothing at all is UNTRACKED — and zero is
 * deliberately a real answer, because a seller who types 0 means sold out.
 */
export function exportStockOf(row: { [key: string]: unknown } | null | undefined): number | null {
    const raw = row?.[EXPORT_STOCK_FIELD];
    if (raw === undefined || raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Whether this listing's stock is counted at all. */
export function exportStockIsTracked(row: { [key: string]: unknown } | null | undefined): boolean {
    return exportStockOf(row) !== null;
}
