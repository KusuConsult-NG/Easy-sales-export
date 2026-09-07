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
 *        AND THE GATE IS NOW ON. It was off by default because the owner needed
 *        placeholder identity numbers to keep working while the external
 *        provider was out of service. #485 parked that provider permanently,
 *        which means this pattern test is the only check any identity number in
 *        this platform receives — and an only check must not be opt-in. See
 *        fakeIdRejectionEnabled below for the full reasoning and the cost.
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
 *   #485 THIS IS ON NOW, AND THE FLAG ONLY TURNS IT OFF.
 *
 *        It was off unless KYC_REJECT_FAKE_IDS was explicitly "true", and the
 *        reason was recorded plainly: the owner needed placeholder identity
 *        numbers to keep working while the external provider was out, so
 *        switching it on "would break the owner's own flow".
 *
 *        THAT REASONING INVERTS ONCE THE PROVIDER IS PARKED FOR GOOD. With no
 *        automated check anywhere in the platform, this pattern test is the ONLY
 *        thing standing between the database and 11111111111 recorded as a
 *        member's BVN. Leaving it off made the last remaining check optional at
 *        the exact moment it became the only one.
 *
 *        WHAT IT COSTS, STATED PLAINLY: a member cannot enrol with a
 *        placeholder number any more, and neither can a tester. That is the
 *        intended effect. looksLikeFakeId rejects only all-same-digit,
 *        sequential and short-block-repeated values — patterns a real NIN or
 *        BVN does not have — so no genuine identity is refused by it.
 *
 *        The switch is kept, and reversed: set KYC_REJECT_FAKE_IDS=false to
 *        turn it off for a testing window. A deployment that sets nothing gets
 *        the check, which is the direction a KYC control should fail.
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
 * #485 — answers TRUE for a placeholder unless KYC_REJECT_FAKE_IDS is
 * explicitly "false". With no automated identity provider in service this is
 * the platform's only check on an identity number.
 */
export function isObviouslyFakeId(id: string): boolean {
    if (!fakeIdRejectionEnabled()) return false;
    return looksLikeFakeId(id);
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
