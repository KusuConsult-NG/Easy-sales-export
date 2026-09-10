/**
 * The minimum tonnage a product may be ordered in.
 *
 *   #580 A REQUIRED FIELD THAT NOTHING ON THE ORDER PATH READ.
 *
 *   `minOrderMT` is collected as a required input on both submission forms —
 *   the seller's /export/products/create and the admin's catalogue editor,
 *   each `required min={1}` — stored on every catalogue row, published by the
 *   public catalogue route, and printed on every product card as "Min: 20 MT".
 *
 *   It was enforced in exactly one place: the quantity stepper on the
 *   catalogue card, which clamps with Math.max(product.minOrderMT, ...) at
 *   every control. Two other doors ignored it completely.
 *
 *     THE CART'S OWN STEPPER. Both the sidebar on /export/buyer and the
 *     /export/buyer/cart page step by `item.quantityMT - 5` with no floor, so
 *     a buyer who added 20 MT of cashews — the minimum, because the card would
 *     not let them add less — could press minus twice in the cart and check
 *     out with 10.
 *
 *     AND THE CHARGE. initializeExportOrderPaymentAction validates that the
 *     tonnage is a positive finite number and nothing else, so whatever
 *     survived the cart was priced and charged.
 *
 *   A rule shown to the buyer on every card, applied on one of three doors:
 *   #38 / #179 / #183 / #324's shape, and the reason it is a function here
 *   rather than a Math.max in three files.
 *
 * ── AN ABSENT MINIMUM MEANS NONE ────────────────────────────────────────────
 *
 *   Deliberately, and for the same reason a missing ceiling means uncapped in
 *   migration 015: rows exist that predate the field, and inventing a floor
 *   for them would refuse orders nobody ever said were too small. Only a
 *   positive finite number is a minimum; anything else — undefined, null, 0,
 *   NaN, a string that will not parse, a negative — is no minimum at all.
 */
export function minimumOrderMT(product: { minOrderMT?: unknown } | null | undefined): number | null {
    const raw = Number(product?.minOrderMT);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * The tonnage to hold a cart line at: never below the product's minimum.
 *
 * Used by the cart context so that both steppers — the sidebar and the cart
 * page — get the rule from one place rather than each carrying a copy.
 */
export function clampToMinimumOrder(
    product: { minOrderMT?: unknown } | null | undefined,
    quantityMT: number,
): number {
    const minimum = minimumOrderMT(product);
    return minimum !== null && quantityMT < minimum ? minimum : quantityMT;
}
