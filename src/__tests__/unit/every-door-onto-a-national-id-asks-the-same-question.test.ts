/**
 * @jest-environment node
 */

/**
 *   #501 THE OWNER'S KYC RULE REACHED ONE SUBMISSION PATH OUT OF FIVE.
 *
 *   #487 built lib/kyc-validators.ts to a direct instruction — "pass all BVN and
 *   NIN input as true without QoreID", then "do not accept this: 11111111111 or
 *   similar combination but a number that looks like a real NIN or BVN" — and
 *   wired it into actions/kyc.ts and the onboarding KYCForm. Auditing
 *   _coop_registration.ts found what that had left behind:
 *
 *     actions/kyc.ts                       isObviouslyFakeId       ✓
 *     onboarding/KYCForm.tsx               isObviouslyFakeId       ✓ (client)
 *     cooperative registration + resubmit  `length !== 11` only
 *     marketplace seller verification      nothing
 *     export onboarding                    nothing
 *     WAVE application                     nothing
 *
 *   EVERY Zod declaration of the two fields in this repository read
 *   `z.string().optional()`. No length, no shape, no placeholder check. So
 *   11111111111 — the value the owner named — was refused at the KYC form and
 *   accepted by four other doors onto the same two fields, one of which asked
 *   only that it be eleven characters long.
 *
 *   THE FIXTURES PROVED IT BEFORE THE CODE DID. Five existing suites seeded
 *   `nin: '12345678901'` and `bvn: '22222222222'` — an ascending run and an
 *   all-one-digit block, both squarely inside looksLikeFakeId — and passed.
 *   Those numbers could stand in for an ordinary member only because no door
 *   they went through was looking. They are ordinary-looking numbers now.
 *
 * ── THE FIELD IS THE UNIT, NOT THE CHECK ────────────────────────────────────
 *
 *   #487 exported a predicate, and every caller had to remember to call it. Four
 *   did not. `nationalIdField()` is a schema fragment, so the field cannot be
 *   DECLARED without the rule — a new form gets it by writing the field, and
 *   forgetting is no longer a thing that can silently happen.
 *
 *   That is the difference between a rule and an omission, and it is the repair
 *   this audit keeps arriving at: #486 (three land-listing doors), #491 (two
 *   dead buttons the checker could not see), #497 (five writers of one status),
 *   #499 (the bulk button and the row editor).
 *
 *   OPTIONAL STAYS OPTIONAL. None of these forms requires a BVN or NIN, and this
 *   does not make them required. An empty submission is as valid as it ever was;
 *   a value that IS supplied has to be eleven digits and not a placeholder.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the placeholder refusal dropped from the field   KILLED
 *     the length rule dropped from the field           KILLED
 *     the field made required                          KILLED
 *     a schema reverted to z.string().optional()       KILLED
 *     the cooperative door reverted to length-only     KILLED
 *     reword this header                               SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { nationalIdField, looksLikeFakeId } from '@/lib/kyc-validators';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

/** The value the owner named, and three of its family. */
const PLACEHOLDERS = ['11111111111', '12345678901', '22222222222', '12121212121'];

/** Numbers with none of those shapes — what a real NIN or BVN looks like. */
const ORDINARY = ['22107458391', '30845172906', '19834762015'];

// ─────────────────────────────────────────────────────────────────────────────
describe('#501 — the shared field carries the owner\'s rule', () => {
    it.each(PLACEHOLDERS)('REFUSES %s', (value) => {
        //   THE test, and the owner's instruction verbatim: "do not accept this:
        //   11111111111 or similar combination".
        expect(nationalIdField('NIN').safeParse(value).success).toBe(false);
        expect(nationalIdField('BVN').safeParse(value).success).toBe(false);
    });

    it.each(ORDINARY)('AND ACCEPTS %s WITH NO EXTERNAL CHECK', (value) => {
        //   The other half of the instruction: "pass all BVN and NIN input as
        //   true without QoreID". Nothing here contacts a provider.
        expect(nationalIdField('NIN').safeParse(value).success).toBe(true);
        expect(nationalIdField('BVN').safeParse(value).success).toBe(true);
    });

    it('AND STAYS OPTIONAL', () => {
        //   The vacuity guard that matters most: a field that refused empty
        //   input would pass every assertion above and lock every member out of
        //   forms that never required a number.
        expect(nationalIdField('NIN').safeParse(undefined).success).toBe(true);
        expect(nationalIdField('BVN').safeParse('').success).toBe(true);
    });

    it('and a wrong length is refused with a length message, not a placeholder one', () => {
        //   Two different complaints. Telling somebody who typed ten digits that
        //   their number "appears to be a placeholder" sends them looking for
        //   the wrong mistake.
        const short = nationalIdField('BVN').safeParse('1234567890');

        expect(short.success).toBe(false);
        expect(short.error!.issues[0].message).toContain('exactly 11 digits');
    });

    it('and the fixtures the old suites used really were placeholders', () => {
        //   Recorded because it is the evidence: five suites seeded these and
        //   passed, which was only possible because no door they went through
        //   was looking.
        expect(looksLikeFakeId('12345678901')).toBe(true);
        expect(looksLikeFakeId('22222222222')).toBe(true);
        expect(looksLikeFakeId('22107458391')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#501 — every door declares the field through the shared rule', () => {
    /**
     * The population ratchet. Pinned on the DECLARATION rather than on a
     * behaviour per door, because the point of the repair is that the field
     * cannot be declared without the rule — and because a new form added next
     * year should fail this the moment it writes `z.string().optional()`.
     */
    const DOORS = [
        'src/lib/schemas.ts',
        'src/lib/validations/marketplace.ts',
        'src/lib/validations/cooperative.ts',
        'src/lib/types/export-actions.ts',
        'src/app/actions/wave/_wv_applications.ts',
    ];

    it.each(DOORS)('%s uses nationalIdField', (rel) => {
        expect(code(rel)).toContain('nationalIdField');
    });

    it('AND NO DOOR STILL DECLARES A BARE OPTIONAL STRING', () => {
        //   The assertion that would have caught this in the first place.
        const offenders: string[] = [];
        for (const rel of DOORS) {
            const body = code(rel);
            for (const field of ['nin', 'bvn']) {
                if (new RegExp(`${field}:\\s*z\\.string\\(\\)`).test(body)) {
                    offenders.push(`${rel}:${field}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('AND THE COOPERATIVE DOORS NO LONGER MEASURE LENGTH BY HAND', () => {
        //   Both of them — register and resubmit. #486's lesson: a repair that
        //   reaches one of two doors in the same file is not a repair.
        const body = code('src/app/actions/cooperative/_coop_registration.ts');

        expect(body).not.toMatch(/bvn\.length !== 11/);
        expect(body).not.toMatch(/nin\.length !== 11/);
        expect(body.match(/nationalIdField\('BVN'\)/g)?.length).toBe(2);
        expect(body.match(/nationalIdField\('NIN'\)/g)?.length).toBe(2);
    });
});
