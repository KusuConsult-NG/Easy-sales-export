/**
 * What identity an export application must carry before it may be filed.
 *
 *   THE OWNER: "remove voter's card on export window onboarding and mandate
 *   NIN and BVN" — and then, on seeing the flow: "BVN is required 2 times
 *   instead of once."
 *
 * ── NEITHER NUMBER WAS REQUIRED ANYWHERE ────────────────────────────────────
 *
 *   Three doors onto the same application, and all three said "only if you
 *   typed one":
 *
 *     KYCVerificationStep   "Require NIN verification only if NIN is entered"
 *                           — its own comment, and the same for BVN
 *     the submit guard      a refine reading "Identity / BVN verification is
 *                           required if details are entered"
 *     the server schema     nationalIdField(), which is `.optional()` with a
 *                           format check that only applies when a value is
 *                           present
 *
 *   So an export application could be filed, and approved, with no NIN, no BVN
 *   and no verification of either. Export pays people: the settlement account
 *   is re-resolved server-side (#346) precisely because of that. The identity
 *   behind the account was optional.
 *
 *   AND "PROVIDED" WAS NEVER THE QUESTION. Both numbers have a live check
 *   behind them (verifyNINAction, verifyBVNAction) that matches the member's
 *   own name against the record. A number typed and not verified is a string.
 *   So the rule is not "a NIN is present" but "a NIN is present, well-formed,
 *   and verified".
 *
 * ── WHY THIS IS A SHARED MODULE ─────────────────────────────────────────────
 *
 *   The same shape as lib/marketplace-application, for the same reason: the
 *   wizard restores a draft straight to the step it was saved at
 *   (`restoredStepId`), so a step's own Continue button is skippable, and a
 *   client-side guard cannot bind a request that never came through the
 *   client. One rule, three callers, so a caller cannot have one without the
 *   others.
 *
 * ── THE BVN WAS ASKED TWICE ─────────────────────────────────────────────────
 *
 *   Step 2 collected it in KYCForm, marked "(Optional)", verified against the
 *   member's typed name. Step 3 collected it AGAIN in
 *   onboarding/BankAccountVerification, marked with a red asterisk, verified
 *   against the resolved bank account name. The member typed the same eleven
 *   digits twice in one wizard, and neither field knew about the other.
 *
 *   The asterisked one was the weaker of the two despite looking stronger:
 *
 *     ·  IT DID NOT BLOCK. BankAccountStep's Continue guard reads
 *        `!bankData || !bankData.verified` — `verified` is the ACCOUNT's flag,
 *        set by the account resolution. Nothing checked the BVN, so the
 *        asterisk was a claim the form did not keep.
 *     ·  ITS ANSWER WAS THROWN AWAY. `exportOnboardingSchema.bank` declares
 *        accountNumber, bankName, accountName and bankCode. Zod strips what is
 *        not declared — the #349/#773 mechanism, twice recorded on this very
 *        schema — so `bvn`, `bvnVerified` and `bvnCheckedByProvider` never
 *        reached the record. The field a member was told was required was the
 *        one nothing kept.
 *
 *   So the BVN is asked once, on the identity step, beside the NIN, where it
 *   is stored and where this rule can see it. What that gives up is the match
 *   against the resolved ACCOUNT name — which reached no record today, so
 *   nothing stored is lost; re-pointing that check at this BVN is worth doing
 *   and is not this change.
 *
 * ── THE VOTER'S CARD ────────────────────────────────────────────────────────
 *
 *   KYCForm — whose only consumer is this wizard's KYC step — also collected a
 *   Voter's Card number with a Verify button beside it. That verification is
 *   `self_declared`: actions/kyc.ts checks the format and writes
 *   `votersCardVerified: true` with
 *   `votersCardVerificationMethod: 'self_declared'`, because there is no live
 *   VIN database to ask. A third identity field, weaker than the two beside
 *   it, asked of every export applicant.
 *
 *   It is gone from this form. NOTHING IS DELETED FROM ANY RECORD: values
 *   already on `kyc.votersCard` stay exactly where they are, and WAVE collects
 *   its own VIN on its own step (CivicStatusStep), where voter registration is
 *   the actual subject. This module has nothing to say about either.
 */

import { isObviouslyFakeId } from "@/lib/kyc-validators";

/** The identity half of an export application, as any caller holds it. */
export interface ExportIdentity {
    nin?: unknown;
    bvn?: unknown;
    ninVerified?: unknown;
    bvnVerified?: unknown;
}

/**
 * One missing answer.
 *
 * `field` is the key the KYC step already uses, so a caller can map an entry
 * back to the input it belongs to without a translation table.
 */
export interface MissingIdentity {
    field: "nin" | "bvn" | "ninVerified" | "bvnVerified";
    message: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The two documents this module requires, in the order the form asks for them. */
const REQUIRED = [
    { key: "nin", label: "NIN", verifiedKey: "ninVerified" },
    { key: "bvn", label: "BVN", verifiedKey: "bvnVerified" },
] as const;

/**
 * Every identity question an export application has not answered, in the order
 * it is asked.
 *
 *   Returns `[]` for a complete one. The FIRST entry is the earliest
 *   unanswered question, which is the one to put in front of the member.
 */
export function missingExportIdentity(kyc: ExportIdentity): MissingIdentity[] {
    const missing: MissingIdentity[] = [];
    const held = kyc as Record<string, unknown>;

    for (const { key, label, verifiedKey } of REQUIRED) {
        const value = text(held[key]);

        if (!value) {
            missing.push({ field: key, message: `Your ${label} is required.` });
            continue;
        }
        if (!/^\d{11}$/.test(value)) {
            missing.push({ field: key, message: `${label} must be exactly 11 digits.` });
            continue;
        }
        if (isObviouslyFakeId(value)) {
            //   Eleven of one digit, or a straight run. The SHARED check, so
            //   this door cannot disagree with the others about what junk is.
            missing.push({
                field: key,
                message: `That ${label} does not look real. Please enter your own ${label}.`,
            });
            continue;
        }
        //   Strictly true. Typing a number into the box is not a verification —
        //   the Verify button matches the member's name against the record, and
        //   that match is the entire value of asking.
        if (held[verifiedKey] !== true) {
            missing.push({
                field: verifiedKey,
                message: `Please verify your ${label} before continuing.`,
            });
        }
    }

    return missing;
}

/** True when both documents are present, well-formed and verified. */
export function hasExportIdentity(kyc: ExportIdentity): boolean {
    return missingExportIdentity(kyc).length === 0;
}
