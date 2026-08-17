/**
 * Escrow status — one vocabulary, and one answer per question about it.
 *
 * TWO VOCABULARIES, DISAGREEING
 * -----------------------------
 * `EscrowTransaction.status` declared five values:
 *
 *     pending | funded | released | refunded | disputed
 *
 * while _escrow_actions.ts validates with a Zod enum of eight:
 *
 *     pending | funded | in_transit | delivered | released | refunded
 *     | disputed | cancelled
 *
 * and _confirmOrderReceiptAction writes "delivered" on every receipt
 * confirmation. So the TYPE asserted that states could not occur which the
 * application writes on its main path — the same defect LandListingStatus had,
 * where a nine-value union sat over fifteen written statuses (#26, #28).
 *
 * WHAT THAT COST
 * --------------
 * Each caller then hand-wrote its own idea of which statuses it would act on,
 * and they did not line up.
 *
 * 1. A DISPUTE AFTER DELIVERY DID NOT FREEZE THE ESCROW
 *
 *    createDisputeAction looked for an active escrow among
 *    `funded | disputed | pending` and froze only from `"funded"`. An escrow at
 *    `in_transit` or `delivered` was not even FOUND, so nothing was frozen and
 *    nothing was recorded.
 *
 *    Meanwhile _escrow_actions.ts:314 treats `funded | in_transit | delivered`
 *    as disputeable, and both release paths (_escrow_actions.ts:389,
 *    order-management.ts:359) release from `"delivered"`.
 *
 *    So: buyer confirms receipt, escrow moves to "delivered", buyer then finds a
 *    problem and disputes — the dispute is created, the escrow is NOT frozen,
 *    and the release path still pays the seller. That is exactly the hole the
 *    dispute-freeze fix was written to close, left open for two of the three
 *    statuses a dispute can be raised from.
 *
 * 2. THE ADMIN COULD NOT RELEASE AFTER A BUYER CONFIRMED RECEIPT
 *
 *    The admin release in _escrow_lifecycle.ts claimed `from: "funded"` alone,
 *    so once the buyer confirmed receipt it failed with "Invalid state
 *    transition: expected 'funded', got 'delivered'". The normal, expected flow
 *    disabled the admin's release button, and the money sat.
 *
 * THE RULE
 * --------
 * The union below is what the application actually writes. Every question about
 * it — can this be disputed, frozen, released, refunded — is answered from one
 * of the sets here, so two callers cannot drift apart again.
 */

export const ESCROW_STATUSES = [
    "pending",
    "funded",
    "in_transit",
    "delivered",
    "disputed",
    "released",
    "refunded",
    "cancelled",
] as const;

export type EscrowStatus = (typeof ESCROW_STATUSES)[number];

/**
 * Money is in escrow and has not been settled.
 *
 * These are the statuses where a dispute must be able to FREEZE the funds,
 * because they are the statuses from which the funds can still be released.
 * The set is deliberately identical to ESCROW_RELEASABLE_FROM minus
 * "disputed" — if a status can be released from, a dispute has to be able to
 * stop that, or the freeze is decorative.
 */
export const ESCROW_FREEZABLE_STATUSES: readonly EscrowStatus[] = [
    "funded",
    "in_transit",
    "delivered",
];

/** What a buyer or seller may raise a dispute from. Matches the freezable set. */
export const ESCROW_DISPUTEABLE_STATUSES: readonly EscrowStatus[] = ESCROW_FREEZABLE_STATUSES;

/**
 * What a release may be claimed from.
 *
 * Includes "disputed" because resolving a dispute in the seller's favour
 * releases from exactly that state.
 */
export const ESCROW_RELEASABLE_FROM: readonly EscrowStatus[] = [
    "funded",
    "in_transit",
    "delivered",
    "disputed",
];

/**
 * What a refund may be claimed from.
 *
 * NOT "pending". A pending escrow was never funded — no money reached the
 * platform — and the refund path credits the buyer's wallet with the escrow
 * amount through creditWalletOnce. Refunding from "pending" would pay a buyer
 * money that was never taken from them, out of the business's balance. An
 * unfunded escrow is cancelled, not refunded.
 *
 * The first draft of this module included "pending" here, on the assumption
 * that the refund set should mirror the release set. Reading the refund body is
 * what showed that it moves real money.
 *
 * "delivered" IS included: it was missing from the hand-written set in
 * _escrow_actions.ts, so once a buyer confirmed receipt their order could no
 * longer be refunded at all — which is precisely when a buyer discovers a
 * problem.
 */
export const ESCROW_REFUNDABLE_FROM: readonly EscrowStatus[] = [
    "funded",
    "in_transit",
    "delivered",
    "disputed",
];

/** Terminal: the money has gone somewhere and nothing further moves it. */
export const ESCROW_SETTLED_STATUSES: readonly EscrowStatus[] = [
    "released",
    "refunded",
    "cancelled",
];

/**
 * Statuses that mean an escrow is still "live" for a given order.
 *
 * Used when locating the escrow attached to an order: a settled one is history,
 * and picking it up instead of the live one is how a dispute ends up attached to
 * the wrong row.
 */
export const ESCROW_ACTIVE_STATUSES: readonly EscrowStatus[] = [
    "pending",
    "funded",
    "in_transit",
    "delivered",
    "disputed",
];

/**
 * What a BUYER or SELLER may move an escrow to, by current status.
 *
 * _updateEscrowStatus carried its own copy of this — a sixth hand-written escrow
 * transition table — and it had two problems.
 *
 * 1. IT LET EITHER PARTY CANCEL A FUNDED ESCROW
 *
 *    Its `funded` row was `["in_transit", "disputed", "cancelled"]`. "cancelled"
 *    is a SETTLED status: it is not in ESCROW_RELEASABLE_FROM, not in
 *    ESCROW_REFUNDABLE_FROM, and not in ESCROW_ACTIVE_STATUSES. So once either
 *    party cancelled a funded escrow, the seller could never be paid, the buyer
 *    could never be refunded, and a dispute could not even find the record to
 *    freeze it. Real money, stranded permanently, by one call from either side.
 *
 *    `cancelled` is reachable from `pending` alone here. A pending escrow holds
 *    nothing, so cancelling it costs nobody anything. A FUNDED one leaves only
 *    by being released, refunded, or disputed — each of which has its own action
 *    that moves the money.
 *
 * 2. HALF OF IT WAS UNREACHABLE
 *
 *    It named `completed` as the target from both `delivered` and `disputed`.
 *    "completed" is not an escrow status — the escrow vocabulary calls that
 *    `released` — so `escrowStatusSchema.parse("completed")` threw before the
 *    table was ever consulted, and both rows were dead. An escrow at `delivered`
 *    could in practice only go to `disputed`, and the settle-the-escrow path a
 *    reader would expect from that table did not exist.
 *
 * `released` and `refunded` are deliberately absent from every row: they move
 * money and belong to releaseEscrowFunds / refundEscrowToBuyer, which claim
 * their own transitions and write the ledger.
 */
export const ESCROW_PARTICIPANT_TRANSITIONS: Readonly<Record<EscrowStatus, readonly EscrowStatus[]>> = {
    pending: ["funded", "cancelled"],
    funded: ["in_transit", "disputed"],
    in_transit: ["delivered", "disputed"],
    delivered: ["disputed"],
    // Admin-resolved, through resolveDisputeAction.
    disputed: [],
    released: [],
    refunded: [],
    cancelled: [],
};

/** The statuses from which a participant may reach `to`. */
export function participantSourcesFor(to: EscrowStatus): EscrowStatus[] {
    return (Object.keys(ESCROW_PARTICIPANT_TRANSITIONS) as EscrowStatus[])
        .filter((from) => ESCROW_PARTICIPANT_TRANSITIONS[from].includes(to));
}

export function isSettledEscrowStatus(status: unknown): boolean {
    return ESCROW_SETTLED_STATUSES.includes(String(status ?? "") as EscrowStatus);
}

export function isFreezableEscrowStatus(status: unknown): boolean {
    return ESCROW_FREEZABLE_STATUSES.includes(String(status ?? "") as EscrowStatus);
}

export function isActiveEscrowStatus(status: unknown): boolean {
    return ESCROW_ACTIVE_STATUSES.includes(String(status ?? "") as EscrowStatus);
}

/**
 * Maps a stored value onto the union, or null if it is not one of ours.
 *
 * "paid" and "completed" appear in order vocabularies for adjacent ideas and
 * have been confused with escrow statuses before; they are mapped rather than
 * silently treated as unknown.
 */
export function normaliseEscrowStatus(status: unknown): EscrowStatus | null {
    const raw = String(status ?? "").trim().toLowerCase();
    if (!raw) return null;
    if (raw === "paid") return "funded";
    if (raw === "completed") return "released";
    if (raw === "shipped") return "in_transit";
    return (ESCROW_STATUSES as readonly string[]).includes(raw) ? (raw as EscrowStatus) : null;
}
