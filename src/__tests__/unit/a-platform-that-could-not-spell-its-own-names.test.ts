/**
 * @jest-environment node
 */

/**
 *   #826 A NIGERIAN PLATFORM THAT COULD NOT SPELL NIGERIAN NAMES.
 *
 *   From the owner's production log, repeatedly:
 *
 *       "Name can only contain letters, spaces, hyphens and apostrophes"
 *
 *   The rule was `/^[a-zA-Z\s\-']+$/`. Twenty-six letters, on a platform whose
 *   applicants write Yoruba and Igbo. Measured by EXECUTING the expression
 *   against sixteen names rather than reading it: TEN were rejected.
 *
 *   And the inversion is the part worth sitting with. It ACCEPTED "  Ada",
 *   "Ada " and "Nneka  Obi" — the paste artefacts a validator exists to clean
 *   up — while refusing the people. It was doing the opposite of its job in
 *   both directions at once, which is why nobody caught it from the outside:
 *   the failures looked like a strict validator working.
 *
 * ── THE APOSTROPHE IS THE QUIETEST AND MAYBE THE WORST ──────────────────────
 *
 *   iOS autocorrects a typed `'` into `’` (U+2019) by default. An O'Brien
 *   filling this form on a phone — which is how most applicants reach this
 *   platform — typed the right character, watched the keyboard change it, and
 *   was told her name was invalid. Nothing on the screen could have explained
 *   that, and no amount of retyping would have fixed it.
 *
 * ── WHY EVERY CASE HERE IS A REAL NAME ──────────────────────────────────────
 *
 *   A validator suite written from the validator's own vocabulary proves the
 *   validator agrees with itself. These are names, and the question asked of
 *   each is the only one that matters: could this person register.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the old twenty-six-letter regex restored                        KILLED
 *     the 15-character word cap restored                              KILLED
 *     the keyboard-smash refusal removed                              KILLED
 *     normalisation removed entirely                                  KILLED
 *     the apostrophe collapse removed                                 KILLED
 *     NFC normalisation dropped                                       KILLED
 *     the leading-letter anchor dropped                               KILLED
 *     the two callers given the same bounds                           KILLED
 *     reword a comment                                    SURVIVED, intended
 *
 *   Eight killed, control survived. The bounds mutant is the one worth naming:
 *   the two former copies of this rule differed in their min and max, and
 *   collapsing them onto one implementation is only a fix if that difference
 *   was deliberate. It was — the cooperative form takes a single-character
 *   field — so the suite asserts the two callers agree everywhere EXCEPT there.
 */

import { describe, it, expect } from '@jest/globals';
import { personNameField, normalisePersonName } from '@/lib/types/person-name-field';
import { strictNameSchema } from '@/lib/schemas';

/** The rule as registration applies it. */
const ok = (name: string) => strictNameSchema.safeParse(name).success;
/** What the register would store. */
const stored = (name: string) => strictNameSchema.safeParse(name).data as string;

// ─────────────────────────────────────────────────────────────────────────────
describe('#826 — the names this register actually holds', () => {
    it.each([
        //   Yoruba tone marks and Igbo dotted vowels. These are not decoration;
        //   they are the orthography, and the register is Nigerian.
        ['Adéwálé', 'Yoruba tone marks'],
        ['Olúwaseun', 'an acute accent'],
        ['Ngọzị', 'Igbo dotted vowels'],
        ['Chinụa', 'Igbo dotted u'],
        ['Ṣegun', 'a dot below'],
        ['Olúṣegun Obasanjọ', 'both, and a surname'],

        //   The apostrophe, in every spelling a keyboard produces.
        ["O'Brien", 'a straight apostrophe'],
        ['O’Brien', 'the apostrophe iOS SUBSTITUTES for it'],
        ['OʼBrien', 'the modifier letter apostrophe'],

        //   Punctuation that is part of how people write their names.
        ['J. Musa', 'an initial'],
        ['Dr. Ada', 'a title'],
        ['Abdul Rahman Jr.', 'a generational suffix'],
        ['Mary-Jane', 'a hyphen'],
        ['Mary–Jane', 'an EN DASH, which is what a paste produces'],

        //   Length. "Oluwaseunfunmilayo" was refused as a BOT at 18 characters.
        ['Oluwaseunfunmilayo', 'eighteen letters, and an ordinary name'],
        ['Chukwuemeka Oluwaseunfunmilayo', 'two of them'],

        //   And the plain case, which never broke and is here as the floor.
        ['Aishat Abubakar', 'plain ASCII'],
    ])('ACCEPTS %j — %s', (name, _why) => {
        expect(ok(name)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#826 — and it still refuses what a validator is for', () => {
    /*
     *   The old rule was called "Anti-Abuse" in its own section header and let
     *   through every one of the first three. Widening the letters is only
     *   defensible if the things it was supposed to catch are still caught.
     */
    it.each([
        ['', 'nothing at all'],
        ['   ', 'only whitespace'],
        ['A', 'a single character, under the minimum'],
        ['-Ada', 'a leading hyphen'],
        ['.Ada', 'a leading full stop'],
        ['123', 'digits'],
        ['Ada99', 'a name with digits in it'],
        ['<script>alert(1)</script>', 'markup'],
        ['Ada; DROP TABLE users', 'a semicolon and a payload'],
        ['a@b.com', 'an email address in the name box'],
        ['aaaaaa', 'a smashed key'],
        ['Adaaaaa Obi', 'a smashed key inside a real name'],
        ['A'.repeat(51), 'longer than the field allows'],
    ])('REFUSES %j — %s', (name, _why) => {
        expect(ok(name)).toBe(false);
    });

    it('AND THE MESSAGE NAMES WHAT IS ALLOWED, NOT WHAT IS NOT', () => {
        /*
         *   The old message listed four things and meant twenty-six, so an
         *   applicant reading it had no way to discover that her name was
         *   unacceptable for containing a letter.
         */
        const res = strictNameSchema.safeParse('Ada99');
        expect(res.success).toBe(false);
        expect(res.error?.issues[0]?.message ?? '').toMatch(/letters, spaces, hyphens, apostrophes or full stops/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#826 — normalisation, which is a SEARCH fix and not a cosmetic one', () => {
    /*
     *   The admin search resolves names by PREFIX RANGE (#814, #825). A member
     *   stored as "O’Brien" is not found by an administrator typing "O'Brien":
     *   the strings differ at the second character and no prefix range spans
     *   them. A register that holds one name three ways reproduces the exact
     *   confusion those two findings are about — an admin reading a name off a
     *   row and being told no such person exists — through the keyboard rather
     *   than through the query.
     */
    it('THE THREE APOSTROPHES ARE STORED AS ONE', () => {
        expect(stored("O'Brien")).toBe("O'Brien");
        expect(stored('O’Brien')).toBe("O'Brien");
        expect(stored('OʼBrien')).toBe("O'Brien");
    });

    it('AND THE DASHES ARE STORED AS ONE', () => {
        expect(stored('Mary-Jane')).toBe('Mary-Jane');
        expect(stored('Mary–Jane')).toBe('Mary-Jane');
        expect(stored('Mary—Jane')).toBe('Mary-Jane');
    });

    it('AND "é" IS ONE CODE POINT HOWEVER IT ARRIVED', () => {
        //   Decomposed (e + combining acute) and composed are the same name,
        //   and only one of them prefix-matches the other.
        const decomposed = 'Adéwálé';
        const composed = 'Adéwálé';
        expect(decomposed).not.toBe(composed);          // they differ as strings
        expect(stored(decomposed)).toBe(composed);      // and not once stored
        expect(stored(composed)).toBe(composed);
    });

    it('AND THE PASTE ARTEFACTS THE OLD RULE ACCEPTED ARE CLEANED UP', () => {
        //   It accepted these UNCHANGED, which is how a register ends up with
        //   " Ada" and "Ada" as two different people.
        expect(stored('  Ada  ')).toBe('Ada');
        expect(stored('Nneka  Obi')).toBe('Nneka Obi');
        expect(stored('Nneka Obi')).toBe('Nneka Obi');   // non-breaking space
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#826 — one rule, because there were two', () => {
    /*
     *   lib/schemas and lib/types/cooperative each declared a `strictNameSchema`
     *   with the same twenty-six letters and DIFFERENT bounds — min 2 / max 50
     *   against min 1 / max 100. Two copies of a rule is how one of them gets
     *   fixed, which is the shape this audit has found more often than any
     *   other. This asserts the BEHAVIOUR agrees rather than that the files
     *   mention each other, because "the file mentions the rule" is the weakest
     *   assertion in this codebase's vocabulary.
     */
    const coopName = personNameField(1, 100);

    it.each([
        'Adéwálé', 'Ngọzị', 'O’Brien', 'J. Musa',
        'Oluwaseunfunmilayo', 'Aishat Abubakar',
    ])('BOTH CALLERS ACCEPT %j', (name) => {
        expect(strictNameSchema.safeParse(name).success).toBe(true);
        expect(coopName.safeParse(name).success).toBe(true);
    });

    it.each(['Ada99', '<script>x</script>', 'aaaaaa', '-Ada'])(
        'AND BOTH REFUSE %j', (name) => {
            expect(strictNameSchema.safeParse(name).success).toBe(false);
            expect(coopName.safeParse(name).success).toBe(false);
        });

    it('AND THEY STILL DIFFER ONLY WHERE THEY ARE MEANT TO — THE BOUNDS', () => {
        //   The cooperative form takes a single-character field; registration
        //   requires two. That difference is deliberate and is the only one.
        expect(coopName.safeParse('A').success).toBe(true);
        expect(strictNameSchema.safeParse('A').success).toBe(false);

        //   A 60-character name, spelled without a repeated run — the first
        //   draft of this line was `'A' + 'b'.repeat(59)`, which is a keyboard
        //   smash, and the smash rule refused it. The suite caught its own test
        //   asking the wrong question, which is the right outcome and is
        //   recorded rather than quietly corrected.
        const sixty = 'Ab'.repeat(30);
        expect(sixty).toHaveLength(60);
        expect(coopName.safeParse(sixty).success).toBe(true);
        expect(strictNameSchema.safeParse(sixty).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#826 — normalisePersonName on its own', () => {
    it('IS IDEMPOTENT', () => {
        //   It runs on every write. A normaliser that changes its own output is
        //   a register that drifts every time a row is touched.
        for (const n of ['O’Brien', '  Ada  ', 'Mary—Jane', 'Adéwálé']) {
            const once = normalisePersonName(n);
            expect(normalisePersonName(once)).toBe(once);
        }
    });

    it('AND LEAVES AN ALREADY-CLEAN NAME EXACTLY ALONE', () => {
        for (const n of ['Aishat Abubakar', "O'Brien", 'Mary-Jane', 'Ngọzị']) {
            expect(normalisePersonName(n)).toBe(n);
        }
    });
});
