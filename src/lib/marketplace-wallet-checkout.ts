/**
 *   #400 A WALLET CHECKOUT THAT TAKES THE MONEY AND LEAVES THE ORDER UNPAID.
 *
 *   From the orphan queue (#399). walletCheckoutAction has no live caller, and
 *   the reason it matters is not that it is dead — it is what happens if
 *   somebody wires it up, which its own name invites.
 *
 *   WHAT IT DOES, AND WHAT IT DOES NOT
 *   -----------------------------------
 *   It is careful about the half it implements. #91 replaced the
 *   caller-controlled amount with the order's own totalAmount, the debit goes
 *   through debitWalletOnce keyed on `order:<id>` so a double submit charges
 *   once, ownership is checked before the money moves, and both ledger rows
 *   record the amount actually debited.
 *
 *   Then it stops. It does NOT:
 *
 *     - mark the order paid — no status write of any kind
 *     - create the escrow rows the marketplace holds seller money in
 *     - compute or withhold the platform fee (#271)
 *     - notify anybody
 *
 *   So a buyer paying this way would have their wallet debited, two ledger rows
 *   written saying `status: "completed"`, and an order still sitting unpaid with
 *   no escrow behind it. The seller is never paid because there is nothing to
 *   release. The money leaves the buyer and reaches nobody, and the "completed"
 *   rows are what reconciliation reads to decide a payment produced what it
 *   should have — so the discrepancy is recorded as a success.
 *
 *   THE LIVE CHECKOUT, AND WHY THIS IS NOT SIMPLY A MISSING BUTTON
 *   ---------------------------------------------------------------
 *   /marketplace/checkout offers one method. Its own state says so:
 *   `useState<"paystack">("paystack")` — a type with a single member. Payment
 *   goes to Paystack, and _payment_verify.ts then creates the escrow rows per
 *   seller with the fee split and the deterministic escrowIdFor id, and moves
 *   the order.
 *
 *   Paying from the wallet is therefore not a feature with a missing button. It
 *   is a feature whose second half — fulfilment — was never written. Adding a
 *   "Pay with wallet" option on top of this action would be the shortest route
 *   to taking a customer's money and giving them nothing.
 *
 *   RETIRED, NOT DELETED — the #379/#386/#395/#396/#398 pattern
 *   ------------------------------------------------------------
 *   It refuses as its first statement, before the schema parse and the session
 *   lookup. The implementation stays whole behind MARKETPLACE_WALLET_CHECKOUT,
 *   off unless set to the exact word "enabled". #91's repairs are untouched and
 *   still asserted, with the flag armed, by wallet-behaviour.test.ts,
 *   wallet-money-paths.test.ts and wallet-actions.test.ts.
 *
 *   NOTHING IS LOST, because nothing was gained: there is no behaviour here for
 *   a live path to have to carry (#384's rule). What would be needed to turn it
 *   on is the fulfilment half, not the flag.
 */

/** The environment variable that arms the wallet checkout. */
export const MARKETPLACE_WALLET_CHECKOUT_ENV = "MARKETPLACE_WALLET_CHECKOUT";

/** The one value that arms it. Anything else, including "1" and "true", does not. */
export const MARKETPLACE_WALLET_CHECKOUT_ENABLED_VALUE = "enabled";

/** Is the retired wallet checkout switched on? */
export function isMarketplaceWalletCheckoutEnabled(): boolean {
    return process.env[MARKETPLACE_WALLET_CHECKOUT_ENV] === MARKETPLACE_WALLET_CHECKOUT_ENABLED_VALUE;
}

/**
 * What a caller is told, and what whoever enables this needs to know.
 *
 * Names the missing half explicitly. A developer meeting this refusal must not
 * have to discover by experiment that the debit works and the fulfilment does
 * not.
 */
export const MARKETPLACE_WALLET_CHECKOUT_REFUSAL =
    "Wallet checkout is retired: it debits the wallet and never completes the "
    + "order. It writes no order status, creates no escrow, computes no platform "
    + "fee and notifies nobody, so the buyer would be charged and the seller "
    + "would have nothing to be paid from. Marketplace payment goes through "
    + "Paystack from /marketplace/checkout, which creates the escrow rows per "
    + "seller with the fee split before the order moves. Arming this needs the "
    + "fulfilment half written first, not the flag set.";
