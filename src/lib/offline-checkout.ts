/**
 * The two checkout methods that take money OUTSIDE Paystack — and why they are
 * off.
 *
 *   #379 THE DECISION #334 ASKED FOR: RETIRED, NOT WIRED.
 *
 *        #334 corrected a help-centre page that described a checkout the
 *        product does not have — "choose between Paystack or Bank Transfer;
 *        for bank transfers, send payment to the provided account details and
 *        your order will be verified within 24 hours" — and left the product
 *        question open, because _payment_orders.ts really does export two
 *        finished-looking order creators:
 *
 *          createBankTransferOrderAction        paymentMethod "bank_transfer"
 *          createPaymentOnDeliveryOrderAction   paymentMethod "payment_on_delivery"
 *
 *        Both are session-guarded, cart-validated, fee-calculated and #272
 *        bounds-checked, and both RESERVE STOCK. No screen calls either. The
 *        decision is to retire them, and each has its own reason, measured
 *        rather than assumed.
 *
 *        BANK TRANSFER HAS NO SECOND HALF. The creator writes
 *        `paymentStatus: "pending_verification"` on the order, and NOTHING in
 *        this codebase reads that value on a marketplace order — no admin
 *        screen, no route, no action moves it on. So a wired bank-transfer
 *        checkout would take a buyer's cart, decrement the stock, mark the
 *        order "processing", and leave it in a state no one can advance. The
 *        24-hour manual verification the help page described does not exist as
 *        code, and building it is a queue, a screen and a permission, not a
 *        wiring change.
 *
 *        And it is not even a missing capability: Paystack's own payment page
 *        already accepts bank transfer. initializePaystackPayment defaults to
 *        channels ["card","bank_transfer","bank","ussd"], the live order path
 *        passes no override, and Paystack issues the account and confirms the
 *        transfer automatically. Wiring this would replace a working channel
 *        with a broken one.
 *
 *        PAYMENT ON DELIVERY BYPASSES ESCROW, WHICH IS THE PRODUCT. Its order
 *        is written with no escrow row at all. Two consequences follow directly
 *        from code that already exists:
 *
 *          confirmReceipt (marketplace/_buyer.ts) marks the order delivered and
 *          then loops over the escrow rows for that order — of which there are
 *          none — so no money moves, because none was ever held.
 *
 *          the platform fee is computed and stored ON the escrow row
 *          (platformFeeFor / sellerNetFor in the live path, #109 and #271), so
 *          an order without one earns the platform nothing and there is no
 *          record to reconcile against.
 *
 *        A dispute has no leverage either: every resolution path in
 *        marketplace/_escrow_disputes.ts and actions/disputes.ts acts on an
 *        escrow. Cash-on-delivery is a real commercial model and this platform
 *        is not currently built for it.
 *
 * NOT DELETED, AND NOT COMMENTED OUT
 * ----------------------------------
 * Removing a "use server" export is the owner's call, not a side effect of a
 * fix — the standing instruction for this codebase, and the same call made for
 * /vendor, the loan wizard and the second escrow release. The implementations
 * stay whole and readable for whoever finishes the feature.
 *
 * WHY A REFUSAL AND NOT JUST A NOTE
 * ---------------------------------
 * Because "no screen calls it" is not the same as "nobody can call it".
 * actions/marketplace/index.ts does `export * from "./_payment_orders"`, so both
 * are REGISTERED SERVER ACTIONS and reachable over the wire by any signed-in
 * caller — exactly the reasoning #374 applied to the unwired dispute resolver.
 * Until then, an armed action that reserves stock and creates an order the
 * platform cannot settle is not dead code; it is an open door.
 *
 * The gate is an environment flag, matching what this codebase already does for
 * paths that must not run by accident: GDPR_PURGE_DELETE_AUTH,
 * SEED_ALLOW_REMOTE, CLEANUP_ALLOW_REMOTE. Default off. Turning it on is a
 * deliberate act by somebody who has read why it is off.
 */

/** The methods this flag governs. Both write orders Paystack never sees. */
export const OFFLINE_CHECKOUT_METHODS = ["bank_transfer", "payment_on_delivery"] as const;

export type OfflineCheckoutMethod = (typeof OFFLINE_CHECKOUT_METHODS)[number];

/**
 * The env value that turns them on. A specific word rather than a truthy
 * value, so a stray "1" or "true" left in an environment cannot enable a
 * checkout the platform cannot settle.
 */
export const OFFLINE_CHECKOUT_ENV = "MARKETPLACE_OFFLINE_CHECKOUT";
export const OFFLINE_CHECKOUT_ENABLED_VALUE = "enabled";

export function isOfflineCheckoutEnabled(): boolean {
    return process.env[OFFLINE_CHECKOUT_ENV] === OFFLINE_CHECKOUT_ENABLED_VALUE;
}

/**
 * What a buyer is told, and what an operator reading the logs needs to know.
 *
 * Named per method because the two are missing DIFFERENT halves, and "this is
 * unavailable" would send whoever enables it looking in the wrong place.
 */
export function offlineCheckoutRefusal(method: OfflineCheckoutMethod): string {
    return method === "bank_transfer"
        ? "Bank transfer is handled on the payment page itself — choose 'Bank Transfer' there "
          + "and your payment is confirmed automatically. A separate transfer checkout is not available."
        : "Payment on delivery is not available. Orders on this marketplace are paid through "
          + "escrow, which is what protects both sides if something goes wrong.";
}
