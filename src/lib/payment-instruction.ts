/**
 * Payment instructions — what the rows in `paymentInstructions` mean.
 *
 *   #421 EVERY ESCROW RELEASE AND REFUND WROTE A ROW SAYING AN ADMIN STILL HAD
 *   TO PAY SOMEBODY. THE MONEY HAD ALREADY MOVED.
 *
 *   The collection has exactly two writers and NO readers — counted across all
 *   of src: `_escrow_actions.ts` writes one on release and one on refund, and
 *   nothing anywhere reads the collection. Both wrote
 *
 *        status: "pending_admin_action"
 *
 *   while the money moved on the line above, through credit_wallet_once, with a
 *   wallet_transactions history row keyed on the escrow so a retry cannot
 *   double it. The recipient is paid before the instruction is written.
 *
 *   WHY THAT IS WORTH FIXING RATHER THAN IGNORING. A collection nobody reads is
 *   usually harmless. This one is a loaded gun: the day somebody builds the
 *   admin queue the field name invites — "show me the pending_admin_action
 *   rows" — they get every escrow release and refund the platform has ever
 *   made, each labelled as an unpaid disbursement, and paying them would pay
 *   every seller and every refunded buyer a second time. That is #249–#251's
 *   class (a payout that can run twice) waiting on a screen nobody has written
 *   yet, and #140's shape (a field written and never read, describing a state
 *   that is not true).
 *
 *   THE ROW IS KEPT. It is a genuine record of a disbursement and this codebase
 *   does not delete records. What changes is that it tells the truth: the
 *   status says the money settled automatically, and names how.
 *
 *   ROWS WRITTEN BEFORE THIS CHANGE STILL SAY "pending_admin_action", AND THEY
 *   WERE EQUALLY ALREADY PAID. There is no backfill here — the audit has no
 *   live database — so the rule has to be carried in code rather than in the
 *   data: `isPaymentInstructionOutstanding` answers FALSE for that legacy value
 *   too, and anything that ever lists this collection must ask it rather than
 *   compare the string.
 */

/** Statuses a payment instruction row can carry. */
export const PAYMENT_INSTRUCTION_STATUSES = [
    /**
     * Written by the escrow release and refund paths. The money moved through
     * credit_wallet_once in the same operation; this row records that it did.
     */
    "settled_automatically",
    /**
     * LEGACY. Every row written before #421 carries this, and every one of them
     * was already settled the same way — the value was inaccurate from the
     * first write, not a state the platform ever left work in.
     */
    "pending_admin_action",
] as const;

export type PaymentInstructionStatus = (typeof PAYMENT_INSTRUCTION_STATUSES)[number];

/** The status the escrow paths write. The money is already with the recipient. */
export const PAYMENT_INSTRUCTION_SETTLED: PaymentInstructionStatus = "settled_automatically";

/** How it settled — recorded so a reader never has to guess. */
export const PAYMENT_INSTRUCTION_SETTLED_VIA = "wallet_credit" as const;

/**
 * Whether an instruction row represents work somebody still has to do.
 *
 * Always false today, and deliberately so: BOTH statuses mean the money has
 * already reached the recipient's wallet. It exists as a function rather than a
 * constant `false` so that a future instruction type which genuinely is
 * outstanding has one place to say so — and so that nothing hand-writes
 * `status === "pending_admin_action"` and treats a settled row as a payment to
 * make.
 */
export function isPaymentInstructionOutstanding(
    status: string | null | undefined,
): boolean {
    void status;
    return false;
}
