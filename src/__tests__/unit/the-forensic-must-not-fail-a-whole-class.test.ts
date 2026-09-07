/**
 * @jest-environment node
 */

/**
 *   #464 THE FIRST REAL FORENSIC SCAN REPORTED 83 OF 100 USERS AS GHOSTS AND
 *   194 OF 200 WAVE PARTICIPANTS AS INELIGIBLE. BOTH WERE THE CHECK, NOT THE
 *   DATA.
 *
 *   From the production run, verbatim:
 *
 *       Ghost Users (Auth exists, No Profile)
 *         Scanned recent 100 Auth users. Found 83 ghosts.
 *
 *       Eligibility Paradox (Gender/Age)
 *         Scanned 200 participants. Found 194 ineligible.
 *           013353e7-...   (Gender: Female)     <- flagged, in a FEMALE-ONLY programme
 *           0avEMgtAcJ...  (Gender: male)       <- correctly flagged
 *           ...~180 more   (Gender: other)      <- gender NOT RECORDED
 *
 *   A check that fails for a whole class of record is a check nobody reads —
 *   which is the cost this codebase has already paid twice and written down
 *   both times. forensics.ts's own cooperative note says it, about the fixed
 *   savings debit: "A check that always fails for a whole class of member is a
 *   check nobody reads, which is the real cost: it hides the mismatches that
 *   matter." Two checks in the same file were doing exactly that.
 *
 *   THE GHOSTS ARE MIGRATED USERS
 *
 *   user-migration.ts writes `supabaseAuthId: supabaseUid` onto the EXISTING
 *   profile and leaves it under its original Firebase-era id. The join from an
 *   auth user to their profile therefore goes through that field, not the
 *   document id — which is why lib/user-identity.ts exists at all, and why #449
 *   had to fix six readers that each walked the pointer their own way. The ghost
 *   check was a seventh and walked none of it.
 *
 *   The ids in the report are the tell: the "ghosts" are UUIDs, while the WAVE
 *   participants listed in the same scan are 28-character Firebase ids. Two
 *   populations, one join, and the check only knew one side.
 *
 *   THE ELIGIBILITY CHECK REFUSED THE SPELLING ITS OWN FORM DEMANDS
 *
 *     schemas.ts registration   z.enum(["Male", "Female", "male", "female"])
 *     schemas.ts WAVE form      z.literal("Female")   <- capitalised, required
 *     forensics.ts              gender !== "female"   <- lower case only
 *
 *   So every participant who applied through the proper WAVE form was reported
 *   ineligible by the forensic meant to police that form. And the normaliser
 *   already existed — validations/user.ts had `toLowerCase().trim()` in a zod
 *   preprocess the whole time, unused by the check that needed it.
 *
 *   AND "other" IS NOT "male". ~180 of the 194 stored "other", which is what the
 *   migration wrote when it had no gender to carry over. Reporting them
 *   INELIGIBLE asserts something the row does not say. The comment directly
 *   above that check had already drawn this line for the date of birth — "'no
 *   finding' and 'could not look' are different answers" — and the gender line
 *   one statement below kept conflating them.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the gender comparison back to `!== "female"`   KILLED
 *     unknown gender counted as ineligible           KILLED
 *     the supabaseAuthId lookup removed              KILLED
 *     a genuinely male participant no longer flagged KILLED
 *     status "fail" when only gaps were found        KILLED
 *
 *   #465 AND THE FIX ABOVE TIMED THE SCAN OUT IN PRODUCTION.
 *
 *       Fail  Auth  Ghost User Scan
 *       [supabase-db] query users: canceling statement due to statement timeout
 *
 *   `supabaseAuthId` lives inside raw_data with no index, so matching on it is a
 *   sequential scan of the users table, three chunks at once. A correct join
 *   that never completes reports nothing at all.
 *
 *   `email` is a NATIVE column on users — and the key user-migration.ts itself
 *   matches a legacy record on, so it is the join that already existed. It is a
 *   WEAKER link, worth saying: a profile whose email no longer matches its auth
 *   account is still reported. That is the honest trade against a query that
 *   cannot finish.
 *
 *   AND THE TIMEOUT ARRIVED WEARING THE WORD "Fail". All eight catches in the
 *   file reported a failure to RUN as a finding, which is the same conflation
 *   #464 had just fixed one statement lower for an unrecorded gender. Every one
 *   of them says "inconclusive" now, and still prints what went wrong.
 *
 *     back to the unindexed pointer query            KILLED
 *     case sensitivity reintroduced on the match     KILLED
 *     one catch reverts to "fail"                    KILLED
 *     a real ghost finding reports inconclusive      KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { normaliseGender, isDefinitelyNot, genderOutcome } from '@/lib/gender';
import { stripComments } from '@/lib/testing/strip-comments';
import { NATIVE_COLUMNS, FIELD_TO_COLUMN } from '@/lib/supabase-table-map';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────────────
describe('#464 — a stored gender is read the same way everywhere', () => {
    it('EVERY SPELLING REGISTRATION ACCEPTS READS AS THE SAME GENDER', () => {
        // schemas.ts stores any of these four. The forensic accepted one.
        for (const spelling of ['Female', 'female', ' Female ', 'FEMALE']) {
            expect({ spelling, read: normaliseGender(spelling) })
                .toEqual({ spelling, read: 'female' });
        }
        for (const spelling of ['Male', 'male', ' male ']) {
            expect({ spelling, read: normaliseGender(spelling) })
                .toEqual({ spelling, read: 'male' });
        }
    });

    it('AND "Female" IS THE SPELLING THE WAVE APPLICATION REQUIRES', () => {
        // The exact contradiction: the programme's own schema demands the
        // capitalised form, and the forensic refused it.
        expect(source('src/lib/schemas.ts')).toContain('gender: z.literal("Female")');
        expect(normaliseGender('Female')).toBe('female');
        expect(isDefinitelyNot('Female', 'female')).toBe(false);
    });

    it('AND "other" IS UNKNOWN, NOT MALE — what the migration wrote for "no gender"', () => {
        for (const value of ['other', 'Other', '', '   ', null, undefined, 0, {}]) {
            expect({ value, read: normaliseGender(value) })
                .toEqual({ value, read: undefined });
        }

        // The consequence that matters: unknown is not evidence of ineligibility.
        expect(isDefinitelyNot('other', 'female')).toBe(false);
        expect(isDefinitelyNot(undefined, 'female')).toBe(false);
    });

    it('POSITIVE CONTROL: a genuinely male participant IS still ineligible', () => {
        // Without this, a normaliser that answered "eligible" to everything
        // would satisfy every assertion above and quietly retire the check.
        expect(isDefinitelyNot('male', 'female')).toBe(true);
        expect(isDefinitelyNot('Male', 'female')).toBe(true);
    });

    it('and the schema uses the shared rule rather than a second copy', () => {
        const validations = source('src/lib/validations/user.ts');

        expect(validations).toContain('normaliseGender');
        expect(validations).not.toContain('val.toLowerCase().trim()');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#464 — the forensic separates a finding from a gap', () => {
    const forensics = () => source('src/app/actions/forensics.ts');

    it('THE GENDER CHECK GOES THROUGH THE SHARED RULE', () => {
        const code = forensics();

        expect(code).toContain('genderOutcome(gender, "female")');
        expect(code).not.toMatch(/gender\s*!==\s*"female"/);
    });

    it('AND AN UNRECORDED GENDER IS ITS OWN ANSWER, NOT INELIGIBLE', () => {
        //   ~180 of the 194 were this. Asserted on the FUNCTION, not on the
        //   source: the first version of this test scanned for the words
        //   `unknownGenderIds` and "gender not recorded", and a mutant that
        //   pushed an unknown gender onto ineligibleIds while leaving both
        //   strings in place SURVIVED. The scan said the words and did the
        //   opposite.
        expect(genderOutcome('other', 'female')).toBe('unknown');
        expect(genderOutcome(undefined, 'female')).toBe('unknown');
        expect(genderOutcome('', 'female')).toBe('unknown');

        expect(genderOutcome('male', 'female')).toBe('ineligible');
        expect(genderOutcome('Male', 'female')).toBe('ineligible');

        expect(genderOutcome('Female', 'female')).toBe('eligible');
        expect(genderOutcome('female', 'female')).toBe('eligible');
    });

    it('and the scan reports that third answer to a human', () => {
        const code = forensics();

        expect(code).toContain('unknownGenderIds');
        expect(code).toContain('a gap in the records, not a finding about them');
    });

    it('AND A SCAN THAT ONLY FOUND GAPS IS "inconclusive", NOT "fail"', () => {
        // ScanResult already had the word and this check was not using it.
        const code = forensics();
        const block = code.slice(code.indexOf('Eligibility Paradox (Gender/Age)'));

        expect(block.slice(0, 700)).toContain('"inconclusive"');
    });

    it('POSITIVE CONTROL: a real ineligibility still fails the check', () => {
        const code = forensics();
        const block = code.slice(code.indexOf('Eligibility Paradox (Gender/Age)'));

        expect(block.slice(0, 700)).toMatch(/ineligibleIds\.length > 0\s*\n?\s*\?\s*"fail"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#464 — a migrated user is not a ghost', () => {
    const forensics = () => source('src/app/actions/forensics.ts');

    it('THE GHOST CHECK ASKS THE SHARED RESOLUTION', () => {
        //   83 of 100. user-migration.ts leaves a migrated profile under its
        //   Firebase-era id, so a document-id lookup alone can never find one.
        //
        //   #466 MOVED THE LOOKUP OUT OF THIS FILE. orphaned-user-repair.ts had
        //   the same narrow rule and never got the fix — and its half WRITES,
        //   so it would have created a duplicate profile for every migrated
        //   user it mislabelled. One resolution, three callers; the behaviour is
        //   asserted in the-repair-must-not-create-a-second-profile.test.ts.
        const code = forensics();

        expect(code).toContain('authAccountsWithProfiles(');
    });

    it('AND KEEPS NO COPY OF ITS OWN', () => {
        // A second implementation beside the shared one is how #466 happened.
        const code = forensics();

        expect(code).not.toContain('.where("email", "in", chunk)');
        expect(code).not.toContain('.where("supabaseAuthId", "in", chunk)');
    });

    it('AND user-migration REALLY DOES WRITE THAT POINTER — the premise', () => {
        // The reason a migrated profile is findable at all. If this stops being
        // true, the ghost count climbs back with nothing to explain it.
        expect(source('src/lib/user-migration.ts')).toContain('supabaseAuthId: supabaseUid');
    });

    it('AND email REALLY IS A NATIVE COLUMN — why the join uses it', () => {
        // #465: matching on supabaseAuthId is a seq scan and timed the whole
        // scan out. email is indexed, and is what user-migration matches on.
        expect(NATIVE_COLUMNS['users']).toContain('email');
        expect(FIELD_TO_COLUMN['users']?.supabaseAuthId).toBeUndefined();
    });

    it('POSITIVE CONTROL: a user found by NEITHER route is still a ghost', () => {
        // The check must not be softened into never reporting anything.
        const code = forensics();

        expect(code).toContain('if (!existingIds.has(user.uid)) ghostUserIds.push(user.uid)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#465 — a scan that could not run is not a scan that found something', () => {
    const forensics = () => source('src/app/actions/forensics.ts');

    it('EVERY CHECK REPORTS A FAILURE TO RUN AS "inconclusive"', () => {
        //   All eight catches said `status: "fail"`, so a statement timeout
        //   reached the screen looking exactly like a detected integrity
        //   problem:
        //
        //       Fail  Auth  Ghost User Scan
        //       [supabase-db] query users: canceling statement due to
        //       statement timeout
        //
        //   Same conflation #464 fixed one statement lower for an unrecorded
        //   gender, left on the error path of every check in the file.
        const code = forensics();

        const stillFailing = (code.match(/catch \(e: any\) \{ results\.push\(\{[^}]*status: "fail"/g) ?? []);
        expect({ stillFailing }).toEqual({ stillFailing: [] });
    });

    it('AND EVERY ONE OF THEM DOES — not the one that was noticed', () => {
        //   THIS COUNTED TO EIGHT, AND THAT WAS THE WRONG SHAPE. #479 added a
        //   ninth check — profiles with no email — whose catch reports
        //   "inconclusive" exactly as the rule requires, and this failed on the
        //   NUMBER while the rule was being followed perfectly.
        //
        //   Seventh time in this audit that a test pinned to an incidental
        //   detail stood in the way of correct work. So it now asserts the rule
        //   instead: every catch in this file reports inconclusive, however many
        //   checks there are.
        const code = forensics();

        const catches = (code.match(/\} catch \(e: any\) \{ results\.push\(/g) ?? []);
        const inconclusive = (code.match(/status: "inconclusive", details: `Could not complete this scan/g) ?? []);

        expect(catches.length).toBeGreaterThanOrEqual(8);
        expect({ catches: catches.length, inconclusive: inconclusive.length })
            .toEqual({ catches: catches.length, inconclusive: catches.length });
    });

    it('and still says what went wrong, rather than swallowing it', () => {
        const code = forensics();

        expect(code).toContain('Could not complete this scan: ${e.message}');
    });

    it('POSITIVE CONTROL: a real finding still reports "fail"', () => {
        // Without this, turning every status into "inconclusive" would pass
        // everything above and retire the whole screen.
        const code = forensics();

        expect(code).toMatch(/ghostUserIds\.length > 0 \? "fail" : "pass"/);
    });
});
