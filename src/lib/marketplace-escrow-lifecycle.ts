/**
 *   #398 A COMPLETE SECOND ESCROW LIFECYCLE THAT HAS NEVER RUN, BESIDE THE ONE
 *        THAT HOLDS THE MONEY.
 *
 *   actions/marketplace/_escrow_lifecycle.ts exports four server actions —
 *   create, confirm payment, request release, release. Counting callers across
 *   all of src/, excluding the defining module:
 *
 *        createEscrowAction           0 live, 0 tests
 *        confirmEscrowPaymentAction   0 live, 1 test
 *        requestEscrowReleaseAction   0 live, 0 tests
 *        releaseEscrowAction          0 live, 1 test
 *
 *   Not one of them has ever been reached. The whole file is a parallel of a
 *   lifecycle that already exists somewhere else and works.
 *
 *   WHAT ACTUALLY HOLDS AND MOVES THE MONEY
 *   ---------------------------------------
 *     create   _payment_orders.ts, one escrow row per seller at checkout,
 *              with the platform fee split computed from the cart by
 *              platformFeeFor / sellerNetFor (#271)
 *     fund     _payment_verify.ts, after Paystack verification
 *     release  _escrow_actions.ts::releaseEscrowFunds and refundEscrowToBuyer,
 *              reached from /admin/marketplace/escrow and /escrow
 *     auto     api/cron/release-escrow, 24 hours after the buyer confirms
 *              receipt (see escrow-release-copy.ts for that rule stated once)
 *
 *   THE HAZARD IS SPECIFIC, AND IT IS STRANDED MONEY
 *   -------------------------------------------------
 *   Every live path addresses an escrow row by the DETERMINISTIC id
 *   `escrowIdFor(orderId, sellerId, allSellerIds)` — the scheme #104 fixed so
 *   two sellers on one order cannot collide. The order → escrow lookup, the
 *   release, the refund, the dispute resolver and the cron all rebuild that id
 *   from the order.
 *
 *   createEscrowAction does `.add()`. It gets a random id. An escrow created
 *   through this door would hold a buyer's money in a row that NOTHING
 *   downstream can address: not the release, not the refund, not the cron, not
 *   the order screen. The money would sit there with no path out.
 *
 *   It also takes `amount` from the caller, where the live path computes the
 *   split from the cart. #271 exists because two figures for one split is how
 *   sellers get paid the wrong number.
 *
 *   WHY ALL FOUR, AND NOT JUST THE CREATE
 *   --------------------------------------
 *   They are one lifecycle. Arming the create alone strands money; arming the
 *   confirm alone funds rows the create never made; arming the release alone
 *   duplicates releaseEscrowFunds on a row addressed a different way. The
 *   incoherent states are the half-armed ones, so the flag is per module.
 *
 *   WHAT IS NOT CLAIMED HERE
 *   ------------------------
 *   requestEscrowReleaseAction has NO live equivalent — a seller cannot ask for
 *   a release. #390 recorded that already, at the field it writes that nothing
 *   reads. The outcome it was for is reached another way (the buyer confirms
 *   receipt and the cron releases 24 hours later, or an admin releases), but
 *   that is a different mechanism and not the same feature. Saying otherwise
 *   would be the mistake #384 named: retiring is only a fix if what takes its
 *   place carries the same behaviour, and here one of the four is a genuine
 *   subtraction of something that never worked rather than a swap.
 *
 *   RETIRED, NOT DELETED — the #379/#386/#395/#396 pattern
 *   ------------------------------------------------------
 *   Each action refuses as its first statement, before the session lookup. The
 *   implementations stay whole behind MARKETPLACE_ESCROW_LIFECYCLE_ACTIONS, off
 *   unless set to the exact word "enabled". Everything #90, #110, #111, #112,
 *   #113 and #375 repaired in this file is untouched and still asserted, with
 *   the flag armed, by escrow-lifecycle-behaviour.test.ts and
 *   escrow-confirm-authz.test.ts.
 *
 *   This also supersedes the note on releaseEscrowAction, which said it was
 *   kept rather than retired "because removing a 'use server' export is a
 *   decision for the owner". That was written before this codebase had a way to
 *   retire an action without removing it. It does now, and this is it.
 */

/** The environment variable that arms the unreached escrow lifecycle. */
export const MARKETPLACE_ESCROW_LIFECYCLE_ENV = "MARKETPLACE_ESCROW_LIFECYCLE_ACTIONS";

/** The one value that arms it. Anything else, including "1" and "true", does not. */
export const MARKETPLACE_ESCROW_LIFECYCLE_ENABLED_VALUE = "enabled";

/** Is the retired escrow lifecycle switched on? */
export function isMarketplaceEscrowLifecycleEnabled(): boolean {
    return process.env[MARKETPLACE_ESCROW_LIFECYCLE_ENV] === MARKETPLACE_ESCROW_LIFECYCLE_ENABLED_VALUE;
}

/**
 * What a caller is told, and what whoever enables this needs to know.
 *
 * Names the live path for each stage and the id mismatch, so a developer
 * meeting this refusal does not have to rediscover either.
 */
export const MARKETPLACE_ESCROW_LIFECYCLE_REFUSAL =
    "This escrow action is retired. Marketplace escrow is created per seller at "
    + "checkout by the order action and funded after Paystack verification, and "
    + "released or refunded from /admin/marketplace/escrow — or automatically 24 "
    + "hours after the buyer confirms receipt. Those paths address an escrow row "
    + "by the deterministic escrowIdFor(orderId, sellerId, allSellerIds) id, "
    + "while this one creates rows with a random id that no release, refund or "
    + "cron can find, so money moved through it would have no path out.";
