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
 *   THE THIRD PATH IS NOT A PATH. processEscrowTransactions releases a "funded"
 *   escrow seven days after `releaseRequestedAt`, and the only writer of that
 *   field is requestEscrowReleaseAction, which has NO CALLER anywhere in the
 *   app. So that loop has never fired, and confirming receipt really is the
 *   only thing a buyer can do that starts a release.
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
 *   TWO STATEMENTS WERE ALREADY TRUE AND ARE LEFT ALONE
 *   ---------------------------------------------------
 *   "Funds are locked and will only release to the seller once you confirm
 *   receipt" and "All payments are held in Escrow until you confirm receipt"
 *   both survive the measurement above: with the seven-day loop unreachable,
 *   confirming really is the buyer-side trigger. Correcting text that is right
 *   is how a fix introduces a defect, so they stay.
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
