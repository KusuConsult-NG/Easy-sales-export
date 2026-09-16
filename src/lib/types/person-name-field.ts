import { z } from "zod";

/**
 *   #826 A NIGERIAN PLATFORM THAT COULD NOT SPELL NIGERIAN NAMES.
 *
 *   From the production log, over and over:
 *
 *       "Name can only contain letters, spaces, hyphens and apostrophes"
 *
 *   The rule behind it was `/^[a-zA-Z\s\-']+$/` — TWENTY-SIX LETTERS. Yoruba
 *   and Igbo are not written in twenty-six letters. Measured by running the
 *   expression rather than reading it, against names this register holds:
 *
 *       Adéwálé              REJECTED   Yoruba tone marks
 *       Olúwaseun            REJECTED   acute accent
 *       Ngọzị                REJECTED   Igbo dotted vowels
 *       Chinụa               REJECTED   Igbo dotted u
 *       Ṣegun                REJECTED   dot below
 *       O’Brien              REJECTED   the apostrophe iOS SUBSTITUTES
 *       J. Musa              REJECTED   an initial
 *       Dr. Ada              REJECTED   a title
 *       Abdul Rahman Jr.     REJECTED   a generational suffix
 *       Oluwaseunfunmilayo   REJECTED   as a BOT, for being 18 letters long
 *
 *   Ten of sixteen. And the inversion is the part worth sitting with: it
 *   ACCEPTED "  Ada", "Ada " and "Nneka  Obi" — the paste artefacts a validator
 *   exists to clean up — while refusing the people. It was doing the opposite
 *   of its job in both directions at once.
 *
 *   THE APOSTROPHE IS THE QUIETEST OF THESE AND MAYBE THE WORST. iOS
 *   autocorrects a typed `'` to `’` (U+2019) by default. So an O'Brien filling
 *   this form on an iPhone — which is how most applicants reach this platform —
 *   typed the right character, watched the keyboard change it, and was told her
 *   name was invalid. Nothing on the screen could have explained that.
 *
 *   THE "BOT DETECTION" RULE was a cap of 15 characters per word, and the note
 *   beside it said "prevent pentester keyboard smashes". A long name is not a
 *   keyboard smash; a REPEATED one is. The cap only ever caught real people,
 *   because "aaaa" is four characters and "Oluwaseunfunmilayo" is eighteen.
 *
 * ── WHAT THIS ACCEPTS ───────────────────────────────────────────────────────
 *
 *   Any Unicode letter, plus the combining marks that carry tone and the
 *   dot-below Yoruba and Igbo need; spaces, hyphens, apostrophes and the full
 *   stop that initials, titles and suffixes are written with. It must BEGIN
 *   with a letter, which is what finally refuses the leading space and the lone
 *   punctuation the old rule let through.
 *
 * ── AND WHAT IT NORMALISES, WHICH IS NOT COSMETIC ───────────────────────────
 *
 *   The apostrophe spellings collapse to one, the Unicode dashes collapse to
 *   the hyphen-minus, runs of whitespace collapse to a single space, and the
 *   string is NFC-normalised so "é" is one code point rather than two.
 *
 *   That is a SEARCH fix as much as a storage one. The admin search resolves
 *   names by PREFIX RANGE, so a member stored as "O’Brien" is not found by an
 *   administrator typing "O'Brien" — the two strings differ at the second
 *   character, and no prefix range spans them. #814 and #825 are both about an
 *   admin reading a name off a row and being told no such person exists; a
 *   register holding one name three ways is that defect arriving through the
 *   keyboard instead.
 *
 * ── ONE RULE, BECAUSE THERE WERE TWO ────────────────────────────────────────
 *
 *   `lib/schemas.ts` and `lib/types/cooperative.ts` each declared their own
 *   `strictNameSchema`, with the same twenty-six letters and DIFFERENT bounds —
 *   min 2 / max 50 against min 1 / max 100. Two copies of a rule is how one of
 *   them gets fixed, which is the shape this audit has found more than any
 *   other. Both call this now.
 *
 *   IT LIVES UNDER lib/types AND NOT lib/, so that packages/types can carry a
 *   symlink to it the way it carries one for every other file in this folder.
 *   cooperative.ts is consumed both from src/ and through that symlink, and the
 *   `@/` alias does not resolve from the second — which is what its own note
 *   has always said, and why it had a second copy of the rule at all. A
 *   sibling-relative import resolves from both. Measured: `../person-name`
 *   from lib/types FAILED the packages/types typecheck; `./person-name-field`
 *   passes both.
 */

/**
 * Canonicalise what a keyboard produced into what the register should hold.
 *
 * Run BEFORE validation, so a name is judged on its letters and not on which
 * device typed it.
 */
export function normalisePersonName(raw: string): string {
    return raw
        //   Compose first: "é" as e+◌́ and "é" as one code point are the same
        //   name, and only one of them prefix-matches the other.
        .normalize("NFC")
        //   U+2019 is what iOS substitutes for a typed apostrophe; U+2018 and
        //   U+02BC arrive from pasted documents and some Android keyboards.
        .replace(/[‘’ʼ՚]/g, "'")
        //   En dash, em dash, figure dash, minus sign — all pasted, all meant
        //   as the hyphen in a double-barrelled name.
        .replace(/[‐-―−]/g, "-")
        //   Non-breaking and other exotic spaces, then runs of any whitespace.
        .replace(/[  -   　]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * A name's permitted shape.
 *
 *   \p{L}   any letter in any script
 *   \p{M}   the combining marks that carry Yoruba tone and Igbo dot-below
 *
 * It must BEGIN with a letter — a name does not start with a hyphen, a full
 * stop or a space, and the rule this replaces accepted all three.
 */
const NAME_SHAPE = /^\p{L}[\p{L}\p{M}\s'.\-]*$/u;

/**
 * Four or more identical characters in a row.
 *
 * THE anti-abuse signal, replacing a word-length cap that could only ever have
 * caught real people. "aaaaaa" is a smashed key; "Oluwaseunfunmilayo" is a
 * person. Deliberately conservative: a false reject costs a registration and a
 * false accept costs an administrator one click.
 */
const KEY_SMASH = /(.)\1{3,}/u;

/**
 * The single name rule. Both former copies call this.
 *
 * @param min  shortest accepted, after normalisation
 * @param max  longest accepted, after normalisation
 */
export function personNameField(min: number, max: number) {
    return z.preprocess(
        (v) => (typeof v === "string" ? normalisePersonName(v) : v),
        z.string()
            .min(min, min === 1 ? "This field is required" : `Name must be at least ${min} characters`)
            .max(max, `Name cannot exceed ${max} characters`)
            .regex(
                NAME_SHAPE,
                //   The message names what IS allowed rather than what is not,
                //   because the old one listed four things and meant twenty-six.
                "Please enter a name using letters, spaces, hyphens, apostrophes or full stops",
            )
            .refine((val) => !KEY_SMASH.test(val), {
                message: "Name contains a repeated character run and looks like a typing error",
            }),
    );
}
