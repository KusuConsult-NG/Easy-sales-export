/**
 * Where a stored bank account's holder name came from — and why money will not
 * move without an answer.
 *
 *   #208 (from #284) THE ACCOUNTS ALREADY ON FILE CANNOT BE TOLD APART FROM
 *        THE VERIFIED ONES.
 *
 *        #284 found that both onboarding flows SIMULATED bank verification:
 *
 *            // SIMULATED VERIFICATION (Requested for demo/testing)
 *            const simulatedName = "SIMULATED ACCOUNT NAME";
 *            ...
 *            const newAccountName = accountName || "SIMULATED ACCOUNT NAME";
 *
 *        The second form is the worse one — whatever the applicant typed into
 *        the account-name box was stored as the confirmed holder name. Either
 *        way the record written was:
 *
 *            { bankName, accountNumber, accountName, verified: true }
 *
 *        #284 fixed the flow: the account is resolved against the bank, server
 *        side, and the BANK'S answer is what gets stored. But the record it
 *        writes has THE SAME SHAPE AS THE SIMULATED ONE. Both say
 *        `verified: true`. Neither says how.
 *
 *        THAT IS WHY THE FOLLOW-UP DECISION COULD NOT BE IMPLEMENTED. "Re-verify
 *        the affected rows", "freeze their payouts", "ask those members to
 *        re-enter their details" all begin with knowing WHICH rows, and nothing
 *        in the data distinguishes them. The population was not identifiable,
 *        so it was recorded and left.
 *
 *   WHAT IS ACTUALLY AT RISK, MEASURED RATHER THAN ASSUMED
 *
 *        The account NUMBER plus the bank code is what routes the money, and
 *        Paystack refuses a number that does not resolve — so a made-up number
 *        fails loudly at payout. The account NAME was never the routing key;
 *        paystackPayout passes it as a label.
 *
 *        The exposure is narrower than "money goes anywhere" and worse than it
 *        sounds: the simulated flow let somebody enter a REAL, RESOLVABLE
 *        account number belonging to SOMEBODY ELSE and be marked verified,
 *        because nothing ever compared the bank's answer with the applicant.
 *        That payout succeeds. It just pays the wrong person.
 *
 *   THE DECISION
 *
 *        1. RECORD THE PROVENANCE WHERE THE RESOLUTION HAPPENS. Every server
 *           side resolve stamps the record. A record without the stamp is, by
 *           construction, one this code did not resolve.
 *
 *        2. MONEY DOES NOT MOVE TO AN UNSTAMPED ACCOUNT. The check lives inside
 *           paystackPayout — the single chokepoint all five payout paths already
 *           go through — rather than at the five call sites, because "N doors
 *           and the hardened one is not the wired one" is the defect this
 *           codebase keeps producing (#276, #277, #297).
 *
 *        3. THERE IS A WAY OUT THAT NEEDS NO OPERATOR PER MEMBER. The member
 *           re-verifies through the control that is now real; the stamp is
 *           written; the payout proceeds. Nothing is deleted and no stored
 *           account is overwritten — the standing rule for this codebase.
 *
 *   WHAT THIS DELIBERATELY DOES NOT CLAIM
 *
 *        The set it holds is EVERY record written before the stamp existed, not
 *        "the records written before #284". Those two differ: a seller onboarded
 *        between #284 and this change was resolved properly and still has no
 *        stamp, so their payout is held until they re-verify. That is not
 *        collateral damage to be tidied away — it is the honest consequence of
 *        the finding. The two populations are not distinguishable from the data,
 *        and inventing a cut-off date would be asserting a distinction that
 *        cannot be checked. Holding a payout is recoverable in one click.
 *        Paying the wrong account is not.
 *
 * This module is pure and imports nothing, so a suite that mocks the database
 * layer cannot break it — #381's lesson.
 */

/** The only value that means "the bank told us this name". */
export const BANK_NAME_SOURCE_RESOLVED = "bank_resolve";

/**
 * The shape a stored bank account carries once it has been resolved.
 *
 * It carries the index signature so a freshly minted stamp is itself a
 * MaybeResolvedBankAccount — the thing isResolvedBankAccount and paystackPayout
 * take. Without it the writer's output could not be handed to the reader, which
 * is a type saying the two halves of one rule are different things.
 */
export interface BankAccountResolutionStamp {
    /** How the holder name was obtained. */
    accountNameSource: typeof BANK_NAME_SOURCE_RESOLVED;
    /** When, as an ISO string. */
    accountResolvedAt: string;
    [key: string]: unknown;
}

/**
 * Anything that might carry the stamp — a stored bank block, a user row, or the
 * account object a payout is built from.
 */
export interface MaybeResolvedBankAccount {
    accountNameSource?: unknown;
    accountResolvedAt?: unknown;
    [key: string]: unknown;
}

/** What a server-side resolve writes onto the record it just confirmed. */
export function bankAccountResolutionStamp(now: Date = new Date()): BankAccountResolutionStamp {
    return {
        accountNameSource: BANK_NAME_SOURCE_RESOLVED,
        accountResolvedAt: now.toISOString(),
    };
}

/**
 * Did THIS codebase resolve the holder name against the bank?
 *
 * THE TEST IS THE STAMP, NOT `verified`. `verified: true` is exactly what the
 * simulated flow wrote, so reading it would be reading the defect's own output
 * and calling it evidence.
 *
 * A timestamp is required alongside the marker. A record carrying the source
 * with no date is a half-written one, and a half-written stamp is not a
 * verification — the same reasoning as a hold with no `pendingSince` in #140.
 */
export function isResolvedBankAccount(
    record: MaybeResolvedBankAccount | null | undefined,
): boolean {
    if (!record) return false;
    if (record.accountNameSource !== BANK_NAME_SOURCE_RESOLVED) return false;

    const at = record.accountResolvedAt;
    if (typeof at !== "string" || at.trim() === "") return false;
    return !Number.isNaN(new Date(at).getTime());
}

/**
 * What an admin, or a log, is told when a payout is held.
 *
 * It names the reason AND the way out, because a refusal that says only "not
 * allowed" turns into a support ticket and then into somebody paying by hand,
 * which is the control being routed around rather than enforced.
 */
export const UNRESOLVED_ACCOUNT_REFUSAL =
    "This bank account has not been confirmed against the bank, so the payout is on hold. "
    + "Ask the member to re-verify their bank account from their profile — it takes one step, "
    + "and the payout can be retried immediately afterwards.";
