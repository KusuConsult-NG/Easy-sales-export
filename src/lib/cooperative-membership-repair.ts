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

import { COOPERATIVE_TIERS as TIER_SYSTEM } from "@/lib/cooperative-tiers";

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
/**
 * The values `membershipTier` may hold — derived, never spelled again here.
 *
 *   #803 THIS MODULE MINTED A SECOND `COOPERATIVE_TIERS`, AND THE TWO NAMES
 *        DISAGREED ABOUT HOW MANY TIERS THE COOPERATIVE HAS.
 *
 *        lib/cooperative-tiers.ts    { Member: { minContribution: 5000,
 *                                                maxLoanMultiplier: 0.5, … } }
 *        here, until now            ["tier1", "tier2"]
 *
 *        The first is the live system: `calculateUserTier` returns "Member" at
 *        every savings level, the membership schema is `z.enum(["Member"])`,
 *        and every writer of the field defaults to `|| "Member"` — provisioning,
 *        the registration action, the dashboard, the payment router. firestore.ts
 *        says so in the field's own comment: "Unified single tier (legacy:
 *        'basic' | 'premium' migrated)".
 *
 *        The second is the retired two-tier vocabulary, kept alive only by this
 *        constant, and it fed the repair screen's radio buttons. Eighteen
 *        members sat under "Need a tier chosen" being asked to pick between
 *        tier1 and tier2 — neither of which this cooperative offers — while the
 *        two rows that DID carry a recorded tier showed what the real
 *        vocabulary looks like: "Member" and "member".
 *
 *        Whichever radio an admin picked, `membershipRowFor` wrote it straight
 *        into `membershipTier`, so the repair would have created rows carrying
 *        a value the membership schema rejects and no other row on the platform
 *        holds. (Loans were never at risk: that path derives the tier from
 *        savings via `calculateUserTier` rather than reading the row.)
 *
 *        Two exports under one name is how they drifted, so this one is renamed
 *        AND derived. There is no second list to fall out of date.
 *
 * ── AND WITH ONE TIER THERE IS NOTHING TO CHOOSE ────────────────────────────
 *
 *   The header below says a tier "IS a decision, because a tier sets what the
 *   member may borrow against". That was true of tier1/tier2. It is not true
 *   now: one tier sets the same terms for everybody, so an absent tier is not a
 *   question for a person — it is the platform's only answer, the same one
 *   `|| "Member"` supplies on every other path.
 *
 *   The machinery stays rather than being deleted, because it is the guard as
 *   much as the question: should the cooperative ever price a second tier
 *   again, `MEMBERSHIP_TIERS.length > 1` makes the choice reappear and
 *   `checkRepair` refuses anything outside the list either way.
 */
export const MEMBERSHIP_TIERS: readonly string[] = Object.keys(TIER_SYSTEM);

/** What a member with no recorded tier is written as. */
export const DEFAULT_MEMBERSHIP_TIER: string = MEMBERSHIP_TIERS[0];

/**
 * Is an absent tier a question for a person, or just the platform's one answer?
 *
 * A FUNCTION RATHER THAN AN EXPRESSION AT THE CALL SITE, so the rule can be
 * exercised without a database. It lived inline in the listing action, where
 * the only way to reach it was to stand up a fake store and read a report —
 * which is how a rule ends up with no test at all.
 */
export function tierIsADecision(knownTier: string | null): boolean {
    return knownTier === null && MEMBERSHIP_TIERS.length > 1;
}

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
        //   #803 — `knownTier` is null when nothing was recorded AND the
        //   cooperative offers a single tier, so the platform's only answer
        //   stands in. Without this the arm returned null and the repair wrote
        //   a membership row with no tier at all.
        const tier = known.knownTier ?? DEFAULT_MEMBERSHIP_TIER;

        if (chosenTier && chosenTier !== tier) {
            return {
                ok: false,
                reason: known.knownTier
                    ? `This member's registration already records "${known.knownTier}". `
                        + `Correcting a tier is a different act from creating the missing row.`
                    : `This cooperative has one tier, "${tier}". There is nothing to choose.`,
            };
        }
        return { ok: true, tier };
    }

    if (!chosenTier) {
        return { ok: false, reason: "This member has no recorded tier — choose one." };
    }
    if (!MEMBERSHIP_TIERS.includes(chosenTier)) {
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
