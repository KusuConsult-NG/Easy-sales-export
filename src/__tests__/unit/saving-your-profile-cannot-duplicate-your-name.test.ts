/**
 * @jest-environment node
 */

/**
 *   #452 OPENING YOUR PROFILE AND PRESSING SAVE DUPLICATED YOUR MIDDLE NAME,
 *   ONCE PER SAVE, WITHOUT EDITING ANYTHING.
 *
 *   Demonstrated before any change, with the three expressions copied verbatim
 *   out of the source, on a name stored exactly as registration writes it:
 *
 *       stored at registration : "Ada Ngozi Obi"
 *       after save 1           : "Ada Ngozi Ngozi Obi"
 *       after save 2           : "Ada Ngozi Ngozi Ngozi Obi"
 *       after save 3           : "Ada Ngozi Ngozi Ngozi Ngozi Obi"
 *
 *   THREE STATEMENTS OF ONE RULE, AND THEY DISAGREED
 *
 *     actions/auth.ts, registration       THREE parts — first, the middle
 *                                         words, last. Correct, and it stores
 *                                         all three.
 *
 *     getUserProfileAction                TWO parts — first = parts[0],
 *                                         last = parts.slice(1).join(" ") —
 *                                         applied UNCONDITIONALLY, so it threw
 *                                         away the three the row had stored.
 *
 *     updateUserProfileAction             rebuilt fullName as
 *                                         [first, other, last], with the
 *                                         two-part split again as its fallback.
 *
 *   So the screen showed last = "Ngozi Obi" while otherName was still "Ngozi",
 *   the form sent both back untouched, and the writer joined them into
 *   "Ada Ngozi Ngozi Obi". The next load split THAT, and the copy count grew.
 *
 *   A middle name is ordinary in Nigeria, so this reached most people who ever
 *   opened their profile — and it looked like the platform mangling their name
 *   rather than anything they had done.
 *
 *   ONE RULE NOW, in lib/person-name.ts. splitFullName is registration's — the
 *   one that was right — and joinFullName is its exact inverse, so the round
 *   trip that corrupted a name is the round trip that cannot.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     splitFullName back to the two-part rule    KILLED
 *     namePartsOf derives over stored parts      KILLED
 *     joinFullName drops `other`                 KILLED
 *     the profile action stops using namePartsOf KILLED
 *     reword this header                         SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { splitFullName, joinFullName, namePartsOf } from '@/lib/person-name';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

/**
 * The round trip a profile save performs, using the SHARED rule at each step —
 * exactly as getUserProfileAction and updateUserProfileAction now do.
 */
function saveWithoutEditing(row: Record<string, unknown>): Record<string, unknown> {
    const shown = namePartsOf(row);                                   // the read
    const form = { firstName: shown.first, lastName: shown.last, otherName: shown.other };
    const stored = namePartsOf(row);                                  // the write
    return {
        ...row,
        ...form,
        fullName: joinFullName({
            first: form.firstName ?? stored.first,
            other: form.otherName ?? stored.other,
            last: form.lastName ?? stored.last,
        }),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#452 — a profile save leaves the name exactly as it was', () => {
    it('THE NAME FROM THE DEMONSTRATION SURVIVES THREE SAVES UNCHANGED', () => {
        // Was: "Ada Ngozi Ngozi Ngozi Ngozi Obi" by this point.
        let row: Record<string, unknown> = {
            fullName: 'Ada Ngozi Obi', firstName: 'Ada', otherName: 'Ngozi', lastName: 'Obi',
        };

        for (let n = 0; n < 3; n += 1) row = saveWithoutEditing(row);

        expect(row.fullName).toBe('Ada Ngozi Obi');
        expect(row.otherName).toBe('Ngozi');
    });

    it('and so does a TWO-middle-name name', () => {
        let row: Record<string, unknown> = {
            fullName: 'Ada Ngozi Chi Obi', firstName: 'Ada', otherName: 'Ngozi Chi', lastName: 'Obi',
        };

        for (let n = 0; n < 3; n += 1) row = saveWithoutEditing(row);

        expect(row.fullName).toBe('Ada Ngozi Chi Obi');
    });

    it('and a name with no middle at all — the case that always worked', () => {
        // Control: the defect only bit names with a middle part, so a suite that
        // only tested two-word names would have reported everything fine.
        let row: Record<string, unknown> = {
            fullName: 'Ada Obi', firstName: 'Ada', otherName: '', lastName: 'Obi',
        };

        for (let n = 0; n < 3; n += 1) row = saveWithoutEditing(row);

        expect(row.fullName).toBe('Ada Obi');
    });

    it('and a single-word name stays a FIRST name, not a surname', () => {
        // Somebody who gives one name is greeted by it. Putting it in `last`
        // would leave every "Hi {firstName}" blank.
        let row: Record<string, unknown> = { fullName: 'Ada', firstName: 'Ada', otherName: '', lastName: '' };

        for (let n = 0; n < 3; n += 1) row = saveWithoutEditing(row);

        expect(row.fullName).toBe('Ada');
        expect(row.firstName).toBe('Ada');
    });

    it('A GENUINE EDIT STILL TAKES EFFECT — the control that stops "never change it"', () => {
        // Without this, freezing the name entirely would pass everything above.
        const row = { fullName: 'Ada Ngozi Obi', firstName: 'Ada', otherName: 'Ngozi', lastName: 'Obi' };
        const stored = namePartsOf(row);

        expect(joinFullName({ first: 'Adaeze', other: stored.other, last: stored.last }))
            .toBe('Adaeze Ngozi Obi');
        expect(joinFullName({ first: stored.first, other: '', last: stored.last }))
            .toBe('Ada Obi');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#452 — split and join are exact inverses', () => {
    const NAMES = [
        'Ada', 'Ada Obi', 'Ada Ngozi Obi', 'Ada Ngozi Chi Obi',
        'Mary-Jane Obi', "Ngozi O'Brien", 'Ada  Ngozi   Obi',
    ];

    it('joinFullName(splitFullName(name)) IS the name, for every one', () => {
        // The property the whole finding rests on. A round trip that is not the
        // identity is a round trip that eventually corrupts.
        for (const name of NAMES) {
            const normalised = name.trim().split(/\s+/).filter(Boolean).join(' ');
            expect({ name, out: joinFullName(splitFullName(name)) })
                .toEqual({ name, out: normalised });
        }
    });

    it('and splitting is STABLE — splitting twice changes nothing', () => {
        for (const name of NAMES) {
            const once = splitFullName(name);
            expect(splitFullName(joinFullName(once))).toEqual(once);
        }
    });

    it('THE MIDDLE PART IS THE MIDDLE, not everything after the first word', () => {
        // The exact difference between the two rules that disagreed.
        expect(splitFullName('Ada Ngozi Obi')).toEqual({ first: 'Ada', other: 'Ngozi', last: 'Obi' });
        expect(splitFullName('Ada Ngozi Chi Obi')).toEqual({ first: 'Ada', other: 'Ngozi Chi', last: 'Obi' });
    });

    it('and an empty or absent name yields empty parts, not undefined', () => {
        for (const value of ['', '   ', null, undefined]) {
            expect(splitFullName(value as string)).toEqual({ first: '', other: '', last: '' });
        }
        expect(joinFullName(null)).toBe('');
        expect(joinFullName({})).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#452 — stored parts beat a derivation', () => {
    it('namePartsOf RETURNS WHAT THE ROW STORED', () => {
        // The half that caused the duplication: the read derived over the
        // stored answer instead of preferring it.
        expect(namePartsOf({
            fullName: 'Ada Ngozi Obi', firstName: 'Ada', otherName: 'Ngozi', lastName: 'Obi',
        })).toEqual({ first: 'Ada', other: 'Ngozi', last: 'Obi' });
    });

    it('and DOES NOT put back a surname somebody removed', () => {
        // A stored `last` of "" is a decision. Deriving from fullName here would
        // reinstate it on the next load.
        expect(namePartsOf({ fullName: 'Ada Obi', firstName: 'Ada', lastName: '' }))
            .toEqual({ first: 'Ada', other: '', last: '' });
    });

    it('and derives ONLY for a legacy row with no parts stored at all', () => {
        expect(namePartsOf({ fullName: 'Ada Ngozi Obi' }))
            .toEqual({ first: 'Ada', other: 'Ngozi', last: 'Obi' });
        expect(namePartsOf({})).toEqual({ first: '', other: '', last: '' });
        expect(namePartsOf(null)).toEqual({ first: '', other: '', last: '' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#452 — the rule is stated once', () => {
    const READERS = [
        'src/app/actions/profile.ts',
        'src/app/actions/auth.ts',
    ];

    it('EVERY NAME SPLITTER GOES THROUGH lib/person-name.ts', () => {
        for (const rel of READERS) {
            expect({ rel, shared: /person-name/.test(source(rel)) }).toEqual({ rel, shared: true });
        }
    });

    it('AND NONE OF THEM SPLITS A NAME BY HAND', () => {
        // The ratchet. Three hand-rolled splits is what this finding was; a
        // fourth must not arrive quietly.
        const BY_HAND = /(fullName|full_name)[^\n]{0,40}\.split\(/;

        const offenders = READERS.filter((rel) => BY_HAND.test(source(rel)));
        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('POSITIVE CONTROL: the pattern matches the code that was there', () => {
        const BY_HAND = /(fullName|full_name)[^\n]{0,40}\.split\(/;

        expect(BY_HAND.test('const parts = fullName.trim().split(/\\s+/).filter(Boolean);')).toBe(true);
        expect(BY_HAND.test("existing.fullName?.split(' ').slice(1).join(' ')")).toBe(true);
        expect(BY_HAND.test('const nameSplit = namePartsOf(userData);')).toBe(false);
    });

    it('and the profile read surfaces otherName, so the form can round-trip it', () => {
        // It returned firstName and lastName only. The form then held a stale
        // otherName from the raw document while the other two were derived —
        // which is precisely the mismatch that duplicated the middle name.
        const profile = source('src/app/actions/profile.ts');

        expect(profile).toContain('otherName: nameSplit.other');
    });
});
