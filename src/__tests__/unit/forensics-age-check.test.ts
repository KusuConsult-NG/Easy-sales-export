/**
 * @jest-environment node
 */

/**
 * Checking whether dateOfBirth had the gender defect. It does not — and the
 * check that reads it never ran.
 *
 * THE QUESTION
 * ------------
 * #155 fixed `gender`: a user could rewrite it through their own profile, and
 * WAVE's female-only enrolment gate read that stored field, so a refused
 * applicant could edit the answer and re-apply. profile.ts's security note names
 * `dateOfBirth` in the same breath, so the same shape was worth looking for.
 *
 * THE ANSWER: NO, AND FOR A REASON WORTH RECORDING
 * ------------------------------------------------
 * dateOfBirth is not in updateUserProfileAction's schema at all, so that door
 * does not exist. More importantly, WAVE's age gate does not read stored state:
 *
 *     const dob = new Date(validatedData.dateOfBirth);   // the SUBMITTED value
 *     if (calculatedAge < 18) return "You must be at least 18 years old..."
 *     if (Math.abs(calculatedAge - validatedData.age) > 1)
 *         return "Date of Birth does not match the declared age"
 *
 * The applicant declares a date on the form and it is checked against a
 * separately declared age. There is nothing stored to pre-edit, which is exactly
 * what made gender different — that gate read a field a different endpoint could
 * write.
 *
 * WHAT THE SEARCH TURNED UP INSTEAD
 * ---------------------------------
 * forensics.ts sweeps WAVE participants for an "Eligibility Paradox (Gender/Age)"
 * and did the age half like this:
 *
 *     const dob = data.dateOfBirth;   // on the USER document
 *     if (dob) { ...age check... }
 *
 * The only thing that writes top-level `dateOfBirth` on a user document is the
 * admin create-user flow in admin.ts. Registration does not write it. Nothing
 * anywhere writes a top-level `dob` either — verification-canonical.ts reads
 * `uData.dob || uData.kyc?.dateOfBirth` and the first operand is dead.
 *
 * So for every user who signed up normally the value was undefined, `if (dob)`
 * was false, and they passed. The forensic reported on gender and quietly
 * checked nobody's age, while its own summary said "Found 0 ineligible" — which
 * reads as an answer.
 *
 * The date does exist: _saveKYCProfileAction writes `kyc.dateOfBirth` and
 * `verificationProfile.dob`. All three are consulted now, in the order
 * verification-canonical.ts resolves an identity.
 *
 * AND "COULD NOT LOOK" IS NOT "NO FINDING"
 * ----------------------------------------
 * A participant with no readable date is now listed separately rather than
 * passed. They are NOT counted as ineligible — an absent date is a gap in the
 * records, not evidence about a person. The cooperative reconciliation further
 * down the same file already made this distinction with `unreadableMembers`; the
 * WAVE check did not.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

describe('dateOfBirth is not the gender defect', () => {
    it('the profile action cannot write it at all', () => {
        // The door gender came through does not exist for this field.
        const profile = codeOnly(source('src/app/actions/profile.ts'));

        expect(profile).not.toContain('dateOfBirth');
    });

    it('WAVE checks the SUBMITTED date, not a stored one', () => {
        // This is the whole difference. A stored field can be edited by another
        // endpoint before the gate runs; a submitted one cannot.
        const wave = source('src/app/actions/wave/_actions.ts');

        expect(wave).toContain('const dob = new Date(validatedData.dateOfBirth)');
        expect(wave).toContain('You must be at least 18 years old to apply');
    });

    it('and cross-checks it against the declared age', () => {
        // A second reason the submitted value is hard to game: two independently
        // declared fields have to agree.
        const wave = source('src/app/actions/wave/_actions.ts');

        expect(wave).toContain('Math.abs(calculatedAge - validatedData.age) > 1');
        expect(wave).toContain('does not match the declared age');
    });
});

describe('the forensic age check reads where the date lives', () => {
    const forensics = source('src/app/actions/forensics.ts');

    it('no longer reads only the field registration never writes', () => {
        // THE finding. Only admin.ts's create-user flow writes top-level
        // dateOfBirth, so for normally-registered users this was undefined.
        expect(forensics).toContain('data.kyc?.dateOfBirth');
        expect(forensics).toContain('data.verificationProfile?.dob');
    });

    it('still prefers the top-level field when it exists', () => {
        // Admin-created users do have it, and it should win — same order
        // verification-canonical.ts resolves an identity in.
        const resolution = forensics.slice(forensics.indexOf('const dob = data.dateOfBirth'));

        expect(resolution.slice(0, 200)).toMatch(
            /data\.dateOfBirth\s*\|\|\s*data\.kyc\?\.dateOfBirth\s*\|\|\s*data\.verificationProfile\?\.dob/
        );
    });

    it('reports participants it could not age-check instead of passing them', () => {
        // "Could not look" and "no finding" are different answers, and it gave
        // the first for the second.
        expect(forensics).toContain('undatedIds');
        expect(forensics).toContain('no date of birth on record');
        expect(forensics).toContain('could not be age-checked');
    });

    it('does not count an absent date as ineligibility', () => {
        // A gap in the records is not evidence about a participant, and marking
        // them ineligible would turn a data problem into an accusation.
        const push = forensics.slice(forensics.indexOf('check: "Eligibility Paradox'));

        expect(push.slice(0, 900)).toContain('ineligibleIds.length > 0 ? "fail" : "pass"');
        expect(push.slice(0, 900)).toContain('[...ineligibleIds, ...undatedIds]');
    });

    it('handles an unreadable date rather than computing from NaN', () => {
        // `new Date("not a date")` yields NaN, and every comparison against it
        // is false — so a malformed date would have passed the under-18 test the
        // same way a missing one did.
        expect(forensics).toContain('Number.isNaN(birthDate.getTime())');
        expect(forensics).toContain('unreadable date of birth');
    });

    it('matches the idiom the same file already used', () => {
        // The cooperative reconciliation below separates "mismatched" from
        // "unreadable". This check now does the same, rather than inventing a
        // second convention.
        expect(forensics).toContain('unreadableMembers');
    });
});

describe('the field-name drift behind it', () => {
    it('nothing writes a top-level dob', () => {
        // verification-canonical.ts reads `uData.dob || uData.kyc?.dateOfBirth`.
        // The first operand has no writer anywhere, so that expression has
        // always resolved through its fallback.
        const { execSync } = require('child_process') as typeof import('child_process');
        const writes = execSync(
            `grep -rn "^\\s*dob:" src/app || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        )
            .split('\n')
            .filter((l) => l.trim() && !l.includes('__tests__'))
            // Assembling a response object is not writing a user record.
            .filter((l) => !/mergedData|canonical|uData|normalized|app\./.test(l));

        expect(writes).toEqual([]);
    });

    it('the KYC profile save is what actually records a date', () => {
        // Vacuity guard for the assertion above: if nothing wrote a date
        // anywhere, the forensic fix would be pointless rather than correct.
        const kyc = source('src/app/actions/kyc.ts');

        expect(kyc).toContain("'kyc.dateOfBirth': payload.dateOfBirth");
        expect(kyc).toContain("'verificationProfile.dob': payload.dateOfBirth");
    });
});
