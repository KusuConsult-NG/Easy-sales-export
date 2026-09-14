/**
 * A member whose membership row was never written, and what may be done for
 * them.
 *
 *   #726 THE LAST OF THE THREE FINDINGS THE FORENSIC REPORT COULD ONLY
 *   DESCRIBE.
 *
 *   The reconciliation check is unambiguous about what this is, and it is worth
 *   quoting because it decides the whole shape of the repair:
 *
 *       "unlike an unrecorded gender, this is not a fact nobody collected. The
 *        role was granted. The row should exist. Somebody has to make it
 *        exist."
 *
 *   So this is NOT the Farm Nation case. There, writing the missing application
 *   would lie about a form nobody submitted, and the tool refuses to. Here the
 *   missing row is derived bookkeeping the platform owes the member — creating
 *   it is the correct repair, and the only question is with what values.
 *
 * ── AND THE VALUES ARE MOSTLY NOT A DECISION AT ALL ─────────────────────────
 *
 *   The reason this was deferred, recorded in the backfill cron, reads:
 *
 *       "2 COOPERATIVE MEMBERS WITH NO MEMBERSHIP ROW would need a tier and
 *        balances invented to satisfy the check."
 *
 *   That overstates it, and the overstatement is what kept the repair
 *   unbuilt.
 *
 *     THE BALANCE IS NEVER INVENTED. Every completed cooperative transaction
 *     for the member is already recorded and their sum IS the balance — the
 *     reconciliation check computes exactly that to verify every other member.
 *     A member with no transactions has ₦0, which is a fact. Inventing a
 *     savings figure would be inventing money, which no repair here may do.
 *
 *     THE TIER IS USUALLY KNOWN. The user's own record carries
 *     `serviceRegistrations.cooperatives.membershipTier`, written by the
 *     registration payment. When it is there it is a fact to copy, not a
 *     choice to make.
 *
 *   What is left for a person is the case where the tier is genuinely absent —
 *   and then it IS a decision, because a tier sets what the member may borrow
 *   against. That case is presented as one, and the rest are presented as what
 *   they are: a row the platform owes somebody, with every value already known.
 */

/** What the platform already knows about a member with no membership row. */
export interface MissingMembershipCase {
    userId: string;
    fullName: string;
    maskedEmail: string;
    /** From serviceRegistrations.cooperatives.membershipTier, when the user has one. */
    knownTier: string | null;
    /** From the completed cooperative ledger. Never typed in. */
    ledgerBalance: number;
    /** How many completed transactions that balance came from. */
    ledgerRows: number;
    /** The registration's payment reference, carried onto the new row when present. */
    paymentReference: string | null;
    /** True when the tier is absent and a person has to choose one. */
    needsATier: boolean;
}

/** Tiers the cooperative actually offers. A row may not carry anything else. */
export const COOPERATIVE_TIERS: readonly string[] = ["tier1", "tier2"];

export interface RepairCheck {
    /** What the platform knows; re-read by the server, never taken from the caller. */
    known: Pick<MissingMembershipCase, "knownTier" | "needsATier">;
    /** The tier the admin chose, when one was needed. */
    chosenTier?: string;
    reason: string;
}

/**
 * May this membership row be created?
 *
 * Separated from the I/O so the rule is testable without a database — the same
 * reasoning backfillDecision and checkResolution are split out under.
 */
export function checkRepair(input: RepairCheck): { ok: true; tier: string } | { ok: false; reason: string } {
    const { known, chosenTier, reason } = input;

    if (reason.trim().length < 8) {
        //   Lower stakes than #725's confirm — the row is owed either way — but
        //   an admin creating a membership record should still say on what
        //   basis, because the next person to read it will want to know whether
        //   it came from a payment, a paper file, or a conversation.
        return { ok: false, reason: "Say why this membership is owed, in a sentence." };
    }

    if (!known.needsATier) {
        /*
         *   THE TIER IS ALREADY KNOWN, so the caller does not get to override
         *   it. A form that let an admin type a tier over one the registration
         *   already records would turn a copy into a decision, and the value
         *   written would no longer match what the member paid for.
         */
        if (chosenTier && chosenTier !== known.knownTier) {
            return {
                ok: false,
                reason: `This member's registration already records "${known.knownTier}". `
                    + `Correcting a tier is a different act from creating the missing row.`,
            };
        }
        return { ok: true, tier: known.knownTier! };
    }

    if (!chosenTier) {
        return { ok: false, reason: "This member has no recorded tier — choose one." };
    }
    if (!COOPERATIVE_TIERS.includes(chosenTier)) {
        return { ok: false, reason: `"${chosenTier}" is not a tier this cooperative offers.` };
    }

    return { ok: true, tier: chosenTier };
}

/**
 * The membership row to write.
 *
 * RETURNED AS A SHAPE RATHER THAN WRITTEN, so what it contains can be asserted
 * without a database.
 *
 * The balance is the caller's DERIVED figure. It is a parameter rather than
 * something computed here so that the one place it can come from is the shared
 * ledger function the reconciliation check also uses — passing it in makes the
 * dependency visible instead of letting this module grow a second opinion.
 */
export function membershipRowFor(args: {
    userId: string;
    tier: string;
    ledgerBalance: number;
    paymentReference: string | null;
    adminId: string;
    reason: string;
}): Record<string, unknown> {
    const { userId, tier, ledgerBalance, paymentReference, adminId, reason } = args;

    return {
        userId,
        membershipTier: tier,
        /*
         *   `pending`, NOT `active`.
         *
         *   Creating the row the platform owes somebody is a bookkeeping
         *   repair. Activating a membership is a grant, and it is not this
         *   tool's to make: the member may have been suspended, may never have
         *   completed onboarding, or may have had a decision taken against
         *   them. The existing activation paths know all of that and this does
         *   not, so the row is created in the state that lets those paths
         *   decide rather than one that pre-empts them.
         */
        membershipStatus: "pending",
        //   DERIVED, never typed. See lib/cooperative-ledger-balance.
        savingsBalance: ledgerBalance,
        ...(paymentReference ? { paymentReference } : {}),
        //   Says what this row is and where it came from, because a membership
        //   record with no history is exactly the thing being repaired.
        createdByRepair: true,
        createdByRepairAdmin: adminId,
        createdByRepairReason: reason,
    };
}
