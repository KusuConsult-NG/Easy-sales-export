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
 *        WHAT IS DONE ABOUT IT, AND WHY IT IS STILL OFF.
 *
 *        The owner's standing instruction is to keep QoreID out for now, and
 *        that is exactly what the bypass was for: verifyNINAction and
 *        verifyBVNAction accept any 11 digits, so sequential and repeated test
 *        values have to keep working. Turning this on today would break the
 *        owner's own testing, so it is NOT on.
 *
 *        Instead the three faults are fixed separately from the decision:
 *
 *          looksLikeFakeId()     the real check, always real, always callable.
 *                                Testable and tested regardless of the switch.
 *          isObviouslyFakeId()   the GATE. Returns looksLikeFakeId(id) when
 *                                KYC_REJECT_FAKE_IDS === "true", and false
 *                                otherwise — today's behaviour, unchanged, and
 *                                now stated instead of hidden in a one-liner.
 *          both callers          now actually call it, so the switch reaches
 *                                something. With the flag unset that is a
 *                                no-op, which is the point: nothing changes
 *                                until somebody decides it should.
 *
 *        OWNER DECISION: set KYC_REJECT_FAKE_IDS=true when QoreID comes back,
 *        or when you are done testing with placeholder identity numbers.
 *
 * Blocked patterns (by looksLikeFakeId, and by isObviouslyFakeId once the flag
 * is set):
 *  - All same digit     : 00000000000, 11111111111 … 99999999999
 *  - Sequential asc/desc: 12345678901, 01234567890, 98765432109 …
 *  - Repeating sequences: 12121212121, 12312312312, 12341234123 …
 *
 * Legitimate NINs / BVNs have no predictable repeating or sequential pattern.
 */

const ASCENDING  = '01234567890123456789'; // doubled so substrings wrap
const DESCENDING = '98765432109876543210';

/** Is the fake-ID check switched on? Off unless explicitly enabled. */
export function fakeIdRejectionEnabled(): boolean {
    return process.env.KYC_REJECT_FAKE_IDS === 'true';
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
 * Answers false while KYC_REJECT_FAKE_IDS is unset, so placeholder identity
 * numbers keep working for testing. See the #357 note at the top of this file.
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

/**
 * ─── Voter's card ────────────────────────────────────────────────────────────
 *
 * THE THIRD IDENTITY PATH NEVER GOT THE CHECK THE OTHER TWO HAVE.
 *
 * actions/kyc.ts verifies three documents. Two of them validate their input:
 *
 *     BVN   if (!/^\d{11}$/.test(...)) return 'A BVN must be 11 digits'
 *     NIN   if (!/^\d{11}$/.test(...)) return 'A NIN must be 11 digits'
 *     VIN   if (!votersCardNumber)     return "Voter's Card number is required"
 *
 * The third accepts any non-empty string. And because the voter's-card path
 * force-marks itself verified — a deliberate relaxation, PVC lookups being
 * unreliable — and updateOverallKYCStatus counts any stored card as a document
 * on file, submitting the single character "x" wrote kyc.status: 'verified' and
 * kycVerified: true on the account. Executed, not argued.
 *
 * The comment on the BVN check names this exact consequence — "that marked an
 * account KYC-verified having submitted no identity document whatsoever" — and
 * the voter's-card path went on doing it.
 *
 * WHAT THIS DOES AND DOES NOT CLAIM
 * ---------------------------------
 * It does not make KYC trustworthy. All three paths are self-asserted while
 * QoreID is out, which is the owner's documented decision and is not this
 * function's business. It makes the three paths AGREE, so that a character
 * typed into a box is no longer an identity document.
 *
 * WHY THE RULE IS LOOSER THAN THE SPEC
 * ------------------------------------
 * An INEC Voter Identification Number is 19 alphanumeric characters. Requiring
 * exactly that would be the strict reading, and it is deliberately not what
 * this does: the whole reason this path force-passes is so a legitimate holder
 * is not stuck, and refusing a real card that was transcribed unusually would
 * reintroduce that in a worse form. 9 to 25 characters refuses junk without
 * that risk. To tighten it to the spec, change the two bounds below — the
 * tests state the bounds rather than restating the regex.
 */
export const VOTERS_CARD_MIN_LENGTH = 9;
export const VOTERS_CARD_MAX_LENGTH = 25;

/**
 * The stored form of a voter's card number: no separators, upper case.
 *
 * VINs are commonly written in space- or hyphen-separated groups, so the same
 * card reaches this action in several shapes. Normalising before storing means
 * the value an admin reviews is the value another submission would produce.
 *
 * NOT hashed, unlike BVN and NIN in the same object. That asymmetry is
 * deliberate: the voter's-card path exists to defer to MANUAL REVIEW, and an
 * admin cannot review a digest. The other two are hashed because nothing reads
 * them back.
 */
export function normaliseVotersCardNumber(value: unknown): string {
    return String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
}

/** Could this plausibly be a voter's card number at all? */
export function isPlausibleVotersCardNumber(value: unknown): boolean {
    const normalised = normaliseVotersCardNumber(value);
    if (normalised.length < VOTERS_CARD_MIN_LENGTH) return false;
    if (normalised.length > VOTERS_CARD_MAX_LENGTH) return false;
    return /^[A-Z0-9]+$/.test(normalised);
}

/** The message shown when it could not. */
export function votersCardErrorMessage(): string {
    return (
        "That does not look like a Voter's Card number. Enter the VIN printed on your card — "
        + `${VOTERS_CARD_MIN_LENGTH}–${VOTERS_CARD_MAX_LENGTH} letters and digits, no other characters.`
    );
}
