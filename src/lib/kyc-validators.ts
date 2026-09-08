import { z } from 'zod';

/**
 * kyc-validators.ts
 *
 * Shared validation utilities for NIN and BVN numbers.
 *
 *   #357 EVERY PART OF THIS FILE WAS INERT, AND ITS HEADER DESCRIBED AN ACTIVE
 *        BLOCKLIST.
 *
 *        Three separate things were wrong, and each one alone would have been
 *        enough to make the control do nothing:
 *
 *        (a) isObviouslyFakeId was `return false;` with a one-line
 *            `[BYPASSED]` comment, under a header listing four families of
 *            pattern it "blocks". It blocked none of them. #245's shape — a
 *            control that reads as present and is none — in the file whose
 *            whole job is to be that control.
 *
 *        (b) The patterns were never written. ASCENDING and DESCENDING sat
 *            here as unused constants: the doubled digit strings the check
 *            would have used, and no check.
 *
 *        (c) NEITHER CALLER CALLED IT. actions/kyc.ts imports
 *            isObviouslyFakeId AND fakeIdErrorMessage; KYCForm.tsx imports
 *            isObviouslyFakeId. Not one of the three names appears anywhere
 *            below its import line in either file. So even un-bypassing (a)
 *            would have changed nothing — the wire was never run.
 *
 *        WHAT WAS DONE ABOUT IT, AND WHAT #485 CHANGED.
 *
 *        The three faults were fixed separately from the decision to run the
 *        gate:
 *
 *          looksLikeFakeId()     the real check, always real, always callable.
 *                                Testable and tested regardless of the switch.
 *          isObviouslyFakeId()   the GATE, which consults the switch.
 *          both callers          now actually call it, so the switch reaches
 *                                something.
 *
 *        AND THE GATE IS ON (#485, confirmed by the owner in #487): a number
 *        that looks like a real NIN or BVN is accepted with no external check
 *        of any kind, and 11111111111 is not. See fakeIdRejectionEnabled below
 *        for the owner's two instructions and why they are not opposed.
 *
 * Blocked patterns:
 *  - All same digit     : 00000000000, 11111111111 … 99999999999
 *  - Sequential asc/desc: 12345678901, 01234567890, 98765432109 …
 *  - Repeating sequences: 12121212121, 12312312312, 12341234123 …
 *
 * Legitimate NINs / BVNs have no predictable repeating or sequential pattern.
 */

const ASCENDING  = '01234567890123456789'; // doubled so substrings wrap
const DESCENDING = '98765432109876543210';

/**
 *   #487 THE OWNER'S RULE, IN TWO INSTRUCTIONS THAT LOOK OPPOSED AND ARE NOT.
 *
 *        "pass all BVN and NIN input as true without QoreID", and then
 *        "do not accept this: 11111111111 or similar combination but a number
 *        that looks like a real NIN or BVN".
 *
 *        Together they say exactly what this file already does, once the two
 *        halves #357 separated are kept apart:
 *
 *          PASS means do not require an external check. Nothing here contacts
 *          any provider; a well-formed number is accepted and recorded as
 *          `self_declared` (#485), and no member is blocked waiting on a
 *          verification that cannot happen.
 *
 *          NOT 11111111111 means refuse a value that is obviously not an
 *          identity at all. looksLikeFakeId names three families — all-same-
 *          digit, a run up or down the keypad, and a short block repeated to
 *          fill the field — and a real NIN or BVN has none of those shapes.
 *
 *        So the gate is ON by default. A deployment that sets nothing gets the
 *        format check, which is the direction a KYC control should fail, and
 *        the only submissions it costs are ones nobody could have meant.
 *
 *        KYC_REJECT_FAKE_IDS=false turns it off for a testing window. It is
 *        kept because the owner's original need for placeholder numbers was
 *        real, and one variable is a cheaper way back than a code change.
 */
export function fakeIdRejectionEnabled(): boolean {
    return process.env.KYC_REJECT_FAKE_IDS !== 'false';
}

/**
 * The real pattern check, independent of the switch above.
 *
 * Separated so it can be tested — and read — without the flag getting in the
 * way. isObviouslyFakeId is the thing callers gate on; this is the thing that
 * knows what a placeholder looks like.
 */
export function looksLikeFakeId(id: string): boolean {
    const digits = String(id ?? '').trim();

    // Not an 11-digit string at all. That is a different complaint, made by
    // the callers' own length checks — this function only answers "is this a
    // recognisable placeholder", so anything malformed is not its business.
    if (!/^\d{11}$/.test(digits)) return false;

    // All the same digit: 00000000000 … 99999999999.
    //
    // REDUNDANT, AND KEPT ON PURPOSE. Mutation testing this file showed that
    // removing this line changes no answer: the repeating-block loop below
    // catches every one of the ten with a block of "dd". It stays because it is
    // the rule a reader looks for first, and because it says plainly what the
    // block loop only implies. The test file records the redundancy so that
    // nobody deletes the block loop believing this line covers the rest.
    if (/^(\d)\1{10}$/.test(digits)) return true;

    // A run up or down the keypad, wrapping at 9→0 and 0→9. The constants are
    // doubled so that a sequence crossing the wrap (…890123…) is a plain
    // substring test rather than a modular one.
    if (ASCENDING.includes(digits) || DESCENDING.includes(digits)) return true;

    // A short block repeated to fill the field: 12121212121, 12312312312,
    // 12341234123. Blocks of 1 are already covered above; blocks of 6 or more
    // cannot repeat inside 11 digits.
    for (let size = 2; size <= 5; size++) {
        const block = digits.slice(0, size);
        if (block.repeat(Math.ceil(11 / size)).slice(0, 11) === digits) return true;
    }

    return false;
}

/**
 * Returns true if the ID looks obviously fake / is a known test pattern.
 * Both NIN and BVN are 11-digit strings — call this for either.
 *
 * #487 — answers TRUE for a placeholder unless KYC_REJECT_FAKE_IDS is
 * explicitly "false". A number that looks like a real NIN or BVN is accepted
 * with no external check of any kind; 11111111111 is not.
 */
export function isObviouslyFakeId(id: string): boolean {
    if (!fakeIdRejectionEnabled()) return false;
    return looksLikeFakeId(id);
}

/**
 *   #525 THE THIRD IDENTITY DOCUMENT HAD NO RULE AT ALL.
 *
 *   looksLikeFakeId answers FALSE for anything that is not exactly eleven
 *   digits — deliberately, it only recognises NIN/BVN placeholders — so the
 *   voter's card was outside every check this module makes. Client and server
 *   both asked only `if (!votersCardNumber)`, and the server then wrote
 *   `kyc.votersCardVerified: true`. A single character was a verified identity
 *   document.
 *
 *   THERE IS NO UPPER BOUND, AND THAT IS A DECISION WITH EVIDENCE BEHIND IT.
 *
 *   I set one at nineteen first, from CivicStatusStep's `maxLength={19}` — the
 *   only place this platform states a length. Writing the test found that the
 *   SAME COMPONENT'S placeholder is
 *
 *       90F5B123456789012345
 *
 *   which is TWENTY characters. The form truncates its own example. So the
 *   platform does not agree with itself about how long a voter's card is, there
 *   is no live database to settle it against, and #485's standing constraint is
 *   that onboarding must not stop — a rule that refuses a real member is worse
 *   than the defect it fixes.
 *
 *   What is certain is the defect: a single character was a verified identity
 *   document. A floor of nine, an alphanumeric requirement, and refusing one
 *   character repeated removes that without gambling an application on a length
 *   nothing here can confirm. If the owner establishes the true length, adding
 *   the ceiling is one line and this is where to add it.
 */
export const VOTERS_CARD_MIN_LENGTH = 9;

/** The card number as it is compared: no spaces, upper case. */
export function normaliseVotersCard(value: string): string {
    return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

/** True when the value cannot be a real voter's card number. */
export function looksLikeFakeVotersCard(value: string): boolean {
    const v = normaliseVotersCard(value);
    if (v.length < VOTERS_CARD_MIN_LENGTH) return true;
    if (!/^[A-Z0-9]+$/.test(v)) return true;
    // One character repeated to fill the field — 0000000000, AAAAAAAAA.
    if (/^(.)\1+$/.test(v)) return true;
    return false;
}

export const VOTERS_CARD_ERROR_MESSAGE =
    "Enter your Voter's Card Number as printed on the card — letters and digits, no spaces.";

/** The zod field, for callers that parse. */
export function votersCardField() {
    return z.string().trim()
        .refine((v) => !looksLikeFakeVotersCard(v), { message: VOTERS_CARD_ERROR_MESSAGE });
}

/**
 *   #501 THE OWNER'S RULE REACHED ONE SUBMISSION PATH OUT OF FIVE.
 *
 *   #487 built this file to a direct instruction — "pass all BVN and NIN input
 *   as true without QoreID", then "do not accept this: 11111111111 or similar
 *   combination but a number that looks like a real NIN or BVN" — and wired it
 *   into actions/kyc.ts and the onboarding KYCForm. Auditing
 *   _coop_registration.ts found what that left:
 *
 *     actions/kyc.ts                       isObviouslyFakeId       ✓
 *     onboarding/KYCForm.tsx               isObviouslyFakeId       ✓ (client)
 *     cooperative registration + resubmit  `length !== 11` only
 *     marketplace seller verification      nothing
 *     export onboarding                    nothing
 *     WAVE application                     nothing
 *
 *   EVERY Zod definition of the two fields in this repository read
 *   `z.string().optional()` — no length, no shape, no placeholder check. So
 *   11111111111 was refused at the KYC form and accepted by four other doors
 *   onto the same two fields, one of which only asked that it be eleven
 *   characters long.
 *
 *   THE FIELD, NOT THE CHECK, IS THE UNIT. #487 exported a predicate and each
 *   caller had to remember to call it; four did not. A schema fragment cannot be
 *   forgotten in the same way, because the field cannot be declared without it.
 *   That is the difference between a rule and an omission, and it is the repair
 *   this audit keeps arriving at.
 *
 *   OPTIONAL STAYS OPTIONAL. None of these forms requires a BVN or a NIN and
 *   this does not make them required — an empty submission is as valid as it
 *   ever was. What changes is that a value which IS supplied has to be eleven
 *   digits and not a placeholder.
 */
export function nationalIdField(field: 'NIN' | 'BVN') {
    return z
        .string()
        .trim()
        .optional()
        .refine((v) => !v || /^\d{11}$/.test(v), {
            message: `${field} must be exactly 11 digits`,
        })
        .refine((v) => !v || !isObviouslyFakeId(v), {
            message: fakeIdErrorMessage(field),
        });
}

/**
 * Human-readable label for error messages.
 */
export function fakeIdErrorMessage(field: 'NIN' | 'BVN'): string {
    return (
        `The ${field} you entered appears to be invalid or a placeholder (e.g. all same digits or sequential numbers). ` +
        `Please double-check and enter your real ${field} as issued by ${field === 'NIN' ? 'NIMC (dial *346#)' : 'your bank (dial *565*0#)'}.`
    );
}
