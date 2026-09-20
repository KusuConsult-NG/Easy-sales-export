import { z } from "zod";

/**
 *   THE PHONE RULE JUDGED THE TYPOGRAPHY AND NOT THE NUMBER.
 *
 *   From the production log:
 *
 *       [WARN] [register] the submission failed validation and was refused
 *         {"fields":["phone"],"reasons":["Phone number is too long",
 *          "Invalid phone number format. Please include your country code"]}
 *
 *   Both rules at once, which is the tell: the value was over the length cap
 *   AND held a character outside the permitted set. Measured by running the
 *   two expressions rather than reading them:
 *
 *       +234 803 000 1111        17 chars   accepted by schemas, REFUSED by
 *                                           cooperative (max 15)
 *       +234 (0) 803 000 1111    21 chars   REFUSED by both — "too long"
 *       +234 (0) 803-000-1111    21 chars   REFUSED by both — "too long"
 *       +234 803–000–1111        en dash    REFUSED — "invalid format"
 *
 *   Every one of those is the same fourteen-digit number. The first is how a
 *   Nigerian number is ordinarily written; the second and third are how it is
 *   written on a business card; the fourth is what a phone keyboard or a paste
 *   from WhatsApp produces, because en dashes arrive by autocorrect exactly as
 *   the curly apostrophe does in #826.
 *
 *   A CAP ON CHARACTERS IS A CAP ON PUNCTUATION. `+2348030001111` is fourteen
 *   characters and `+234 (0) 803 000 1111` is twenty-one, and they are the
 *   same number — so the old rule refused people for putting spaces in.
 *
 * ── SO IT COUNTS DIGITS, AND THE BOUND IS NOT ARBITRARY ─────────────────────
 *
 *   E.164 — the ITU standard every phone number on earth conforms to — permits
 *   at most FIFTEEN digits. That is the real limit, it does not move, and it
 *   cannot be reached by formatting. Below it, the separators are the caller's
 *   business and not the platform's.
 *
 *   What this still refuses, and must: a name typed into the phone box (no
 *   digits), two numbers pasted into one field (more than fifteen digits), and
 *   anything carrying a character that is not a digit or a separator.
 *
 * ── ONE RULE, BECAUSE THERE WERE TWO — AND THEY HAD DRIFTED ─────────────────
 *
 *   `lib/schemas.ts` and `lib/types/cooperative.ts` each declared their own
 *   `strictPhoneSchema`, with different bounds (min 7 / max 20 against min 10 /
 *   max 15) and different expressions — one anchored the `+` to the front, the
 *   other allowed it anywhere. Two copies of a rule is how one of them gets
 *   fixed, and here the stricter copy was the one on the cooperative
 *   onboarding form, refusing ordinary numbers outright.
 *
 *   This is #826 one field over, so it is solved the way #826 was solved: one
 *   rule, parameterised on the bounds its callers actually want, living under
 *   lib/types so packages/types can carry a symlink to it, imported
 *   sibling-relatively from cooperative.ts because the `@/` alias does not
 *   resolve through that symlink.
 *
 * ── NORMALISING IS A DEDUP FIX TOO, NOT ONLY AN ACCEPTANCE ONE ──────────────
 *
 *   lib/phone.ts already says what is at stake: the phone check "is the one
 *   thing standing between the platform and two accounts on one phone number",
 *   and several writers store what was typed. A register holding one number as
 *   `0803–123–4567` and `0803-123-4567` has two spellings that no exact match
 *   spans. Collapsing the dashes and spaces before storage removes one way for
 *   that to happen, the same way #826 collapsed the apostrophes.
 */

/**
 * Canonicalise what a keyboard produced into what the register should hold.
 *
 * Run BEFORE validation, so a number is judged on its digits and not on which
 * device typed it.
 */
export function normalisePhoneInput(raw: string): string {
    return raw
        .normalize("NFC")
        //   En dash, em dash, figure dash, minus sign, non-breaking hyphen —
        //   pasted or autocorrected, all meant as the separator.
        .replace(/[‐-―−⁃]/g, "-")
        //   Non-breaking and other exotic spaces, then runs of any whitespace.
        .replace(/[   -   　]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * The permitted shape, once normalised.
 *
 * A leading `+` only — a plus in the middle of a number means nothing, and one
 * of the two rules this replaces allowed it anywhere. After that: digits and
 * the separators people actually write numbers with.
 */
const PHONE_SHAPE = /^\+?[\d\s().-]*\d$/;

/** Just the digits, which is the only part that is the number. */
export function countPhoneDigits(value: string): number {
    return (value.match(/\d/g) ?? []).length;
}

/**
 * The single phone rule. Both former copies call this.
 *
 * @param minDigits  shortest accepted, counting DIGITS and not characters
 * @param maxDigits  longest accepted; E.164 permits no more than 15
 */
export function phoneNumberField(minDigits: number, maxDigits = 15) {
    return z.preprocess(
        (v) => (typeof v === "string" ? normalisePhoneInput(v) : v),
        z.string()
            //   Shape first, so somebody who typed their name into the phone
            //   box is told that rather than being told it is too short.
            .regex(
                PHONE_SHAPE,
                "Please enter a phone number using digits, and if you like spaces, "
                + "brackets or dashes — for example +234 803 000 1111",
            )
            .refine((val) => countPhoneDigits(val) >= minDigits, {
                message: `Phone number must have at least ${minDigits} digits`,
            })
            .refine((val) => countPhoneDigits(val) <= maxDigits, {
                //   Names the real limit. "Too long" against a character count
                //   was unactionable: the number was the right length and the
                //   spaces were not.
                message: `Phone number cannot have more than ${maxDigits} digits`,
            }),
    );
}
