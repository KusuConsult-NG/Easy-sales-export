/**
 *   #390 SIX SCREENS TOLD A BUYER OR A SELLER SOMETHING THE RELEASE PATHS DO
 *        NOT DO, AND NO TWO OF THEM SAID THE SAME WRONG THING.
 *
 *   WHAT ACTUALLY HAPPENS, MEASURED
 *   -------------------------------
 *   Confirming receipt (confirmOrderReceiptAction) claims the ORDER to
 *   "delivered" and each still-live ESCROW row from funded/in_transit to
 *   "delivered".
 *
 *   From there exactly TWO things can release the money:
 *
 *     1. api/cron/release-escrow's processDeliveredEscrowTransactions takes
 *        every escrow row that has been "delivered" for longer than
 *        ESCROW_DELIVERED_AUTO_RELEASE_HOURS and pays the seller. Nobody
 *        presses anything.
 *     2. An admin releasing early from one of the admin escrow pages
 *        (releaseEscrowFunds).
 *
 *   A dispute stops both: it moves the escrow off "delivered", and the cron's
 *   release is a compare-and-swap from that exact status, so it refuses.
 *
 *   THE THIRD PATH USED NOT TO BE A PATH, AND NOW IS — #968.
 *
 *   processEscrowTransactions used to release a "funded" escrow seven days
 *   after `releaseRequestedAt`. The only writer of that field was
 *   requestEscrowReleaseAction, which had NO CALLER anywhere in the app, so the
 *   loop had never fired once. What that MEANT, though, is worse than a dead
 *   loop: a buyer who simply never came back left the seller's money in escrow
 *   FOR EVER. Nothing else would ever move it. The seller had shipped real goods
 *   and had no path to payment that did not depend on the buyer choosing to act.
 *
 *   THE OWNER'S RULE, stated 2026-09-28: "on confirmation of the delivery,
 *   payout should be effected after 24hrs but if no confirmation and goods were
 *   sent out, payment should be done after 5days when goods were sent out."
 *
 *   So the loop is re-pointed, from a request nobody could make to the one
 *   event that already happens: DISPATCH. `shippedAt` is stamped on the order by
 *   _updateOrderStatusAction when the seller marks it shipped, and is now
 *   denormalised onto each live escrow row at the same moment, because the cron
 *   queries escrow rows and cannot join to the order.
 *
 *   WHY CONFIRMING STILL WINS, AND WHY THE TWO CLOCKS DO NOT RACE
 *   ------------------------------------------------------------
 *   The 5-day loop claims from `funded` / `in_transit` ONLY. Confirming receipt
 *   moves the row to "delivered", which takes it out of that loop's reach and
 *   hands it to the 24-hour one. So a buyer who confirms on day 4 is paid out on
 *   day 5, and a buyer who confirms on day 4 hour 23 is paid out on day 5 hour
 *   23 — LATER than the bare 5-day deadline, not sooner.
 *
 *   That is deliberate and it is the buyer-favouring direction: the 24 hours
 *   this module promises them after confirming is a dispute window, and a second
 *   clock allowed to cut it short would make CONFIRM_RECEIPT_PROMPT a lie in
 *   exactly the last hours it matters. A dispute freezes both loops, as before,
 *   because both are compare-and-swaps from a status a dispute moves off.
 *
 *   THE BACKLOG IS NOT PAID. An escrow written before this shipped carries no
 *   `shippedAt`, and a `where` on a missing field does not match it — so the
 *   loop structurally cannot reach the rows that were already sitting there when
 *   the rule changed. That is the owner's decision, not an accident of the
 *   query, and the cron reports how many such rows it is declining to pay so the
 *   number is visible rather than inferred. scripts/escrow-unconfirmed-backlog.ts
 *   classifies them properly, against the orders, for a human to release by hand.
 *
 *   WHAT THE SCREENS SAID
 *   ---------------------
 *   buyer/orders/[id]   "Escrow will be marked ready for admin release."
 *                       "Order confirmed! Escrow pending admin release."
 *
 *                       Both describe a queue an admin works through. There is
 *                       no such queue in the path: 24 hours after confirming,
 *                       the money moves on its own. A buyer who noticed
 *                       something wrong the next morning would have believed
 *                       they still had time because a person had not acted yet.
 *
 *   buyer/orders        "This will release funds to the seller."
 *
 *                       The opposite error, in the confirm dialog of the same
 *                       operation on the other screen: it says the release is
 *                       immediate. It is not, and the gap between confirming
 *                       and releasing is exactly when a dispute still works —
 *                       which is the one thing a buyer needs to know here and
 *                       neither screen told them.
 *
 *   seller/orders/[id]  "Awaiting buyer confirmation to release payment."
 *
 *                       Rendered for an order whose status is "delivered" —
 *                       which is set BY the buyer confirming. So the seller was
 *                       told they were waiting for the thing that had already
 *                       happened, on every order that had reached that state.
 *
 *   seller/orders       "Completed - Payment released to your account", with no
 *                       reference to escrowReleased, which the same list
 *                       already carries. An order can be completed with the
 *                       escrow not yet released; the seller was told the money
 *                       had arrived.
 *
 *   lib/marketplace-notifications  notifyOrderDelivered tells the seller
 *                       "Awaiting buyer confirmation to release funds" and the
 *                       buyer that confirming is what releases payment. It has
 *                       NO CALLER — no order-delivered notification is sent by
 *                       anything — so this is not live text. It is corrected
 *                       anyway rather than left as a trap for whoever wires it,
 *                       and the fact that it is unreachable is recorded at the
 *                       function itself.
 *
 *   TWO STATEMENTS WERE TRUE UNTIL #968 AND ARE NOW CORRECTED
 *   ---------------------------------------------------------
 *   "Funds are locked and will only release to the seller once you confirm
 *   receipt" and "All payments are held in Escrow until you confirm receipt"
 *   both survived #390's measurement, for one reason: with the seven-day loop
 *   unreachable, confirming really WAS the only buyer-side trigger. #390 left
 *   them alone and said so, because correcting text that is right is how a fix
 *   introduces a defect.
 *
 *   Re-pointing that loop at dispatch is exactly the change that makes them
 *   false. "ONLY once you confirm" and "UNTIL you confirm" both promise that
 *   inaction holds the money, and after #968 inaction releases it on day five.
 *   A buyer reading either sentence would have believed that not confirming was
 *   a way to keep their money where it was.
 *
 *   So they are replaced, from here, by ESCROW_HELD_UNTIL_RELEASE. This is the
 *   half of the change that is easy to skip: the loop is the feature and the
 *   sentences are what the buyer actually has. Shipping the first without the
 *   second is #390 all over again, one release path later.
 *
 *   WHY THE COPY LIVES HERE
 *   -----------------------
 *   #330 — six statements of one password rule — and #26, #38 and #312 are the
 *   same shape: a rule written out wherever it was needed, drifting a phrase at
 *   a time until the copies disagree. Six screens stated this one and no two
 *   agreed. They now read it from here, and the window is a NUMBER shared with
 *   the cron rather than a "24" typed into a sentence, so the text cannot drift
 *   from the timer it describes.
 *
 *   Pure module: no session, no database, no next/*. Both the client screens
 *   and the cron route import it.
 */

/**
 * How long an escrow row sits in "delivered" before the cron releases it.
 *
 * api/cron/release-escrow reads this. It was a bare `24 * 60 * 60 * 1000` in
 * the route and a bare "24" in nothing at all, because no screen mentioned the
 * window — which is how six screens managed to describe a release that waits
 * for a person.
 */
export const ESCROW_DELIVERED_AUTO_RELEASE_HOURS = 24;

/** The same window in milliseconds, for the cron's threshold. */
export const ESCROW_DELIVERED_AUTO_RELEASE_MS =
    ESCROW_DELIVERED_AUTO_RELEASE_HOURS * 60 * 60 * 1000;

/**
 * How long after DISPATCH an unconfirmed escrow is released to the seller.
 *
 * The other half of the owner's rule (see the header): a buyer who confirms
 * starts the 24-hour clock above, and a buyer who never comes back no longer
 * strands the seller's money for ever.
 *
 * This is a deadline that runs while the buyer does NOTHING, which makes it the
 * one number on this module that a buyer MUST be told at dispatch rather than
 * at confirmation — by then it is already running. DISPATCH_NOTICE_FOR_BUYER is
 * that disclosure and api/cron/release-escrow reads the same constant, so the
 * sentence and the timer cannot drift.
 */
export const ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS = 5;

/** The same window in milliseconds, for the cron's threshold. */
export const ESCROW_UNCONFIRMED_AUTO_RELEASE_MS =
    ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000;

/**
 * The confirm dialog a buyer sees before confirming receipt.
 *
 * States the consequence and the deadline, because this is the last moment
 * before a clock the buyer cannot stop by inaction starts running.
 */
export const CONFIRM_RECEIPT_PROMPT =
    `Confirm you received this order?\n\n`
    + `Payment is released to the seller ${ESCROW_DELIVERED_AUTO_RELEASE_HOURS} hours `
    + `after you confirm. If anything is wrong with the order, open a dispute `
    + `before then rather than confirming.`;

/** What a buyer is told once the confirmation has landed. */
export const CONFIRM_RECEIPT_SUCCESS =
    `Receipt confirmed. Payment is released to the seller in `
    + `${ESCROW_DELIVERED_AUTO_RELEASE_HOURS} hours — open a dispute before then if `
    + `something is wrong.`;

/** What a SELLER is told about an order the buyer has confirmed, not yet paid out. */
export const SELLER_AWAITING_AUTO_RELEASE =
    `The buyer has confirmed receipt. Payment is released to your wallet `
    + `${ESCROW_DELIVERED_AUTO_RELEASE_HOURS} hours after confirmation, unless a dispute `
    + `is opened.`;

/**
 * What a SELLER is told about a completed order whose escrow has not been
 * released.
 *
 * This state is reachable — the order and the escrow are separate rows and
 * only one of them is claimed per path — and the screens used to assert the
 * money had arrived regardless.
 */
export const SELLER_COMPLETED_NOT_RELEASED =
    `Payment has not reached your wallet yet. It is released automatically, or `
    + `sooner if an admin releases it.`;

/**
 * What a BUYER is told once the seller has dispatched — #968.
 *
 * The deadline in this sentence runs whether or not the buyer ever opens the
 * app again, which is what makes it different from every other string in this
 * module. CONFIRM_RECEIPT_PROMPT can wait to be read, because nothing moves
 * until the buyer presses the button it sits behind. This cannot: by the time a
 * buyer who ignored their email comes looking, the five days may be spent.
 *
 * It states the alternative rather than only the deadline, because "confirm and
 * you get 24 hours" is the action available to a buyer who wants the shorter,
 * clearer window and the dispute right that goes with it.
 */
export const DISPATCH_NOTICE_FOR_BUYER =
    `The seller has dispatched this order. Payment is released to them `
    + `${ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS} days after dispatch. If you confirm receipt `
    + `before then, payment is released ${ESCROW_DELIVERED_AUTO_RELEASE_HOURS} hours after you `
    + `confirm instead. Open a dispute before whichever deadline applies if something `
    + `is wrong.`;

/** What a SELLER is told about an order they have dispatched and the buyer has not confirmed. */
export const DISPATCH_NOTICE_FOR_SELLER =
    `Dispatched. Payment reaches your wallet `
    + `${ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS} days after dispatch, or `
    + `${ESCROW_DELIVERED_AUTO_RELEASE_HOURS} hours after the buyer confirms receipt if they `
    + `confirm first, unless a dispute is opened.`;

/**
 * The standing statement of what escrow does, for the buyer's order screens.
 *
 * REPLACES "All payments are held in Escrow until you confirm receipt" and
 * "Funds are locked and will only release to the seller once you confirm
 * receipt". Both were true before #968 and are false after it — see the header.
 * Each promised, in the words a buyer would rely on, that the money stays put
 * while they do nothing.
 *
 * Deliberately names BOTH deadlines rather than saying "held in escrow" and
 * stopping: a buyer's whole exposure here is a clock they did not know about.
 */
export const ESCROW_HELD_UNTIL_RELEASE =
    `Payments are held in Escrow, not paid to the seller at checkout. Once an order `
    + `is dispatched, payment is released ${ESCROW_UNCONFIRMED_AUTO_RELEASE_DAYS} days later, `
    + `or ${ESCROW_DELIVERED_AUTO_RELEASE_HOURS} hours after you confirm receipt if you `
    + `confirm first. Open a dispute before then if something is wrong.`;
