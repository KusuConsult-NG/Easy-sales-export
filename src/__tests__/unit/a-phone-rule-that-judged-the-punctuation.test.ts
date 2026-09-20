/**
 * @jest-environment node
 */

/**
 *   THE PHONE RULE REFUSED PEOPLE FOR PUTTING SPACES IN.
 *
 *   From the owner's production log:
 *
 *       [WARN] [register] the submission failed validation and was refused
 *         {"fields":["phone"],"reasons":["Phone number is too long",
 *          "Invalid phone number format. Please include your country code"]}
 *
 *   Two rules at once. Measured by RUNNING the old expressions rather than
 *   reading them — the same method #826 used on the name rule, and for the
 *   same reason: both looked reasonable:
 *
 *       +234 803 000 1111        17 chars   passed schemas, REFUSED by the
 *                                           cooperative form (max 15)
 *       +234 (0) 803 000 1111    21 chars   REFUSED by both, "too long"
 *       +234 (0) 803-000-1111    21 chars   REFUSED by both, "too long"
 *       +234 803–000–1111        en dash    REFUSED, "invalid format"
 *
 *   Every one of those is the same fourteen-digit number, and `+2348030001111`
 *   — fourteen characters, same number — sailed through. A cap on CHARACTERS
 *   is a cap on punctuation.
 *
 *   The en-dash case is #826's curly apostrophe exactly: a phone keyboard or a
 *   paste from WhatsApp substitutes it, the person typed the right character,
 *   and the form told them their number was invalid with nothing on screen able
 *   to explain why.
 *
 * ── SO THE BOUND IS DIGITS, AND IT IS NOT ARBITRARY ─────────────────────────
 *
 *   E.164 permits at most FIFTEEN digits. That is the real limit, it does not
 *   move, and no amount of spacing can reach it.
 *
 * ── AND THERE WERE TWO COPIES, DRIFTED ──────────────────────────────────────
 *
 *   lib/schemas.ts (min 7 / max 20, `+` anchored) and lib/types/cooperative.ts
 *   (min 10 / max 15, `+` anywhere). The stricter copy was on the cooperative
 *   onboarding form, so the platform's strictest door was strict about the
 *   wrong thing. Both call one rule now — #826's fix, one field over.
 */

import { describe, it, expect } from '@jest/globals';
import {
    normalisePhoneInput, countPhoneDigits, phoneNumberField,
} from '@/lib/types/phone-number-field';
import { strictPhoneSchema } from '@/lib/schemas';
import { cooperativeMembershipSchema } from '@/lib/types/cooperative';

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: string) =>
    schema.safeParse(v).success;

const errorFor = (v: string): string => {
    const r = strictPhoneSchema.safeParse(v);
    return r.success ? '' : r.error.issues.map((i) => i.message).join(' | ');
};

describe('the numbers the production log was refusing', () => {
    /** THE table. Every one of these is the same Nigerian number. */
    const SAME_NUMBER = [
        '+2348030001111',
        '+234 803 000 1111',
        '+234 (0) 803 000 1111',
        '+234 (0) 803-000-1111',
        '+234 803–000–1111',   // en dash, from a keyboard or a paste
        '+234 803 000 1111', // non-breaking spaces, from a paste
        '0803 000 1111',
        '0803-000-1111',
    ];

    it.each(SAME_NUMBER)('accepts %s', (value) => {
        expect(accepts(strictPhoneSchema, value)).toBe(true);
    });

    it('and the cooperative form accepts them too — it was the stricter door', () => {
        //   max 15 CHARACTERS refused `+234 803 000 1111` outright, on the one
        //   form a member has to complete to join the cooperative.
        for (const value of SAME_NUMBER) {
            expect({ value, ok: accepts(phoneNumberField(10), value) })
                .toEqual({ value, ok: true });
        }
    });

    it('and the stored value is canonical, whichever way it was typed', () => {
        //   A dedup fix as much as an acceptance one: lib/phone.ts calls the
        //   phone check "the one thing standing between the platform and two
        //   accounts on one phone number", and several writers store what was
        //   typed. One number held under two dash spellings defeats that.
        const parsed = strictPhoneSchema.parse('+234 803–000–1111');
        expect(parsed).toBe('+234 803-000-1111');
    });
});

describe('and what it still refuses', () => {
    it('A NAME TYPED INTO THE PHONE BOX', () => {
        expect(accepts(strictPhoneSchema, 'Musa Abdullahi')).toBe(false);
    });

    it('two numbers pasted into one field — more than E.164 permits', () => {
        expect(accepts(strictPhoneSchema, '+234 803 000 1111 +234 805 111 2222')).toBe(false);
        expect(errorFor('+234 803 000 1111 +234 805 111 2222')).toMatch(/more than 15 digits/);
    });

    it('a number too short to be one', () => {
        expect(accepts(strictPhoneSchema, '12345')).toBe(false);
        expect(errorFor('12345')).toMatch(/at least 7 digits/);
    });

    it('a plus in the middle, which one of the two old rules allowed', () => {
        //   cooperative.ts's regex was /^[\+\d\s\-\(\)]+$/ — unanchored, so
        //   `0803+000+1111` passed it.
        expect(accepts(strictPhoneSchema, '0803+000+1111')).toBe(false);
    });

    it('letters mixed into digits', () => {
        expect(accepts(strictPhoneSchema, '+234 803 000 111X')).toBe(false);
    });

    it('and nothing at all', () => {
        expect(accepts(strictPhoneSchema, '')).toBe(false);
        expect(accepts(strictPhoneSchema, '   ')).toBe(false);
        expect(accepts(strictPhoneSchema, '+')).toBe(false);
        expect(accepts(strictPhoneSchema, '()- ')).toBe(false);
    });

    it('VACUITY CONTROL: the rule is not simply accepting everything', () => {
        //   Eight acceptances above would pass just as well against a schema
        //   that never refused anything.
        const refusals = ['Musa Abdullahi', '12345', '0803+000+1111', '+234 803 000 111X', '', '+'];
        expect(refusals.filter((v) => accepts(strictPhoneSchema, v))).toEqual([]);
    });
});

describe('the message tells a person what to do', () => {
    it('names the real limit instead of "too long"', () => {
        //   "Phone number is too long" against a CHARACTER count was
        //   unactionable: the number was the right length and the spaces were
        //   not, and nothing on screen said so.
        expect(errorFor('1234567890123456789')).toMatch(/more than 15 digits/);
        expect(errorFor('1234567890123456789')).not.toMatch(/too long/);
    });

    it('and shows the shape rather than demanding a country code', () => {
        //   The old message said "Please include your country code" even when
        //   the country code was present and the spacing was the problem.
        expect(errorFor('Musa Abdullahi')).toMatch(/\+234 803 000 1111/);
    });
});

describe('the primitives, exercised directly', () => {
    it('counts digits and not characters', () => {
        expect(countPhoneDigits('+234 (0) 803-000-1111')).toBe(14);
        expect(countPhoneDigits('no digits here')).toBe(0);
    });

    it('collapses the dashes and spaces a keyboard substitutes', () => {
        expect(normalisePhoneInput('+234 803–000—1111'))
            .toBe('+234 803-000-1111');
        expect(normalisePhoneInput('  0803   000   1111  ')).toBe('0803 000 1111');
    });

    it('and leaves an already-clean number alone', () => {
        expect(normalisePhoneInput('+2348030001111')).toBe('+2348030001111');
    });
});

describe('both former copies now answer the same way', () => {
    it('THE test — one rule, so they cannot drift apart again', () => {
        //   Two copies of a rule is how one of them gets fixed. This is the
        //   assertion that stops it happening a third time.
        const general = phoneNumberField(7);
        const coop = phoneNumberField(10);

        for (const value of ['+234 (0) 803 000 1111', '+234 803–000–1111', '0803 000 1111']) {
            expect({ value, general: accepts(general, value), coop: accepts(coop, value) })
                .toEqual({ value, general: true, coop: true });
        }
    });

    it('and the cooperative schema really uses it', () => {
        //   Reached through the real member schema, not the primitive — so a
        //   copy reintroduced in cooperative.ts fails here.
        //   Only the phone issues are read, so the other required fields on
        //   this form are not this test's business.
        const member: any = {
            phone: '+234 (0) 803 000 1111',
            nextOfKinPhone: '+234 (0) 805 111 2222',
        };
        const issues = cooperativeMembershipSchema.safeParse(member);
        const phoneIssues = issues.success ? [] : issues.error.issues
            .filter((i) => String(i.path[0]).toLowerCase().includes('phone'));

        expect(phoneIssues).toEqual([]);
    });
});
