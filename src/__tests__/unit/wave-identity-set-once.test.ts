/**
 * @jest-environment node
 */

/**
 * The date of birth WAVE validated, now written down — and the gender it was
 * overwriting, now left alone.
 *
 * THE DATE
 * --------
 * _submitMultiStepWaveApplicationAction computes an age from the declared date
 * of birth and refuses anyone under 18:
 *
 *     const dob = new Date(validatedData.dateOfBirth);
 *     if (calculatedAge < 18) return "You must be at least 18 years old to apply."
 *     if (Math.abs(calculatedAge - validatedData.age) > 1)
 *         return "Date of Birth does not match the declared age"
 *
 * That date went onto the WAVE_APPLICATIONS row and nowhere else. The user
 * document — which is what forensics.ts sweeps for under-age participants — got
 * firstName, lastName, phone, gender, state, address, BVN and NIN from the same
 * form, and no date. Registration writes none either, so #156 found that the
 * age half of that sweep silently checked nobody.
 *
 * It is written now, so the sweep has something to read.
 *
 * SET ONCE, AND THE GENDER IT WAS OVERWRITING
 * -------------------------------------------
 * Both fields are written only where the user record has no value yet. An
 * application is a declaration, not a correction: letting one overwrite a stored
 * identity field would reopen for date of birth the door #155 closed for gender
 * on the profile screen. admin.ts has the audited route for a record that is
 * genuinely wrong.
 *
 * `gender: "Female"` was written unconditionally, and that matters more than it
 * looks. Reaching that line does not prove the applicant is female — the
 * eligibility check exempts admins, Academy Elite members, and anyone holding a
 * pre-existing WAVE role or registration:
 *
 *     if (isMale && !isUserAdmin && !isAcademyElite && !hasWaveRole && !hasWaveReg)
 *         return "Only female applicants are eligible..."
 *
 * So a male applicant in any of those categories passed the gate and then had
 * his user record rewritten to Female. After #155 he could not correct it
 * himself.
 *
 * THE RESUBMISSION PATH MATTERS MORE
 * ----------------------------------
 * _resubmitWaveApplicationAction had the identical two-line write and runs NO
 * eligibility check at all — it only requires the application to be pending or
 * revision_required. Both paths share one helper now, because two copies of the
 * same write is the shape this audit keeps finding drifted apart.
 *
 * A MISMATCH IS REPORTED, NOT RESOLVED
 * ------------------------------------
 * When a declared date differs from the stored one, the stored value stays, the
 * declared value stays on the application row, and a warning is logged. Two
 * identity records disagreeing is exactly what the forensic sweep exists to
 * surface; silently picking a winner would erase the signal.
 */

import { describe, it, expect } from '@jest/globals';
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

const wave = source('src/app/actions/wave/_actions.ts');

describe('the validated date is written to the user', () => {
    it('records dateOfBirth on the user document', () => {
        // THE ask. The age gate had a date and the user record did not.
        expect(wave).toContain('fields.dateOfBirth = declaredDateOfBirth');
    });

    it('writes it only when the record has none', () => {
        // Set-once, matching #155. An application declares; it does not correct.
        const helper = wave.slice(wave.indexOf('function identityFieldsToSetOnce'));

        expect(helper).toContain('if (!storedDob) {');
        expect(helper.slice(0, 1400)).toContain('fields.dateOfBirth = declaredDateOfBirth');
    });

    it('keeps the stored date when a declared one disagrees, and says so', () => {
        // Reported rather than resolved: both values survive and the sweep can
        // see the disagreement.
        const helper = wave.slice(wave.indexOf('function identityFieldsToSetOnce'));

        expect(helper.slice(0, 1600)).toMatch(/logger\.warn\([^)]*differs from the stored one/);
        expect(helper.slice(0, 1600)).not.toMatch(/else\s*\{\s*fields\.dateOfBirth/);
    });

    it('the age gate it comes from is still there', () => {
        // If the validation goes, persisting the value is no longer meaningful.
        expect(wave).toContain('You must be at least 18 years old to apply');
        expect(wave).toContain('Math.abs(calculatedAge - validatedData.age) > 1');
    });
});

describe('gender is no longer overwritten', () => {
    it('never writes a literal gender in either application path', () => {
        // THE second finding. Reaching the write does not prove the applicant is
        // female, because the eligibility check has exemptions.
        expect(codeOnly(wave)).not.toContain('gender: "Female",');
    });

    it('sets it only where the record has none', () => {
        const helper = wave.slice(wave.indexOf('function identityFieldsToSetOnce'));

        expect(helper.slice(0, 1600)).toContain('if (!storedGender) {');
        expect(helper.slice(0, 1600)).toContain('fields.gender = "Female"');
    });

    it('the exemptions that make this reachable are still there', () => {
        // Pinning WHY the unconditional write was wrong. If the exemptions ever
        // go, the reasoning changes and whoever changes it should see this.
        expect(wave).toMatch(
            /isMale && !isUserAdmin && !isAcademyElite && !hasWaveRole && !hasWaveReg/
        );
    });
});

describe('both application paths share one rule', () => {
    it('enrolment and resubmission call the same helper', () => {
        // Two copies of the same two-line write is how they drift. The
        // resubmission path is the one that runs no eligibility check at all.
        const calls = wave.match(/identityFieldsToSetOnce\(/g) ?? [];

        // One declaration plus two call sites.
        expect(calls.length).toBe(3);
    });

    it('the resubmission path reads the user inside its transaction', () => {
        // It had no user document in scope, so the set-once decision needs a
        // read — and it must be a transactional one, since the update that
        // follows is in the same transaction.
        const resubmit = wave.slice(wave.indexOf('async function _resubmitWaveApplicationAction'));

        expect(resubmit).toContain('await transaction.get(userRef)');
        expect(resubmit.indexOf('await transaction.get(userRef)'))
            .toBeLessThan(resubmit.indexOf('transaction.update(userRef'));
    });

    it('both still spread the fields into their user update', () => {
        // Vacuity guard: computing the object and not using it would satisfy
        // every assertion above while writing nothing.
        expect((wave.match(/\.\.\.identityFieldsToSet,/g) ?? []).length).toBe(2);
    });
});

describe('what the forensic will now be able to read', () => {
    it('the sweep looks at the field this writes', () => {
        // Closing the loop with #156: that fix taught the sweep where to look,
        // and this one gives it something to find for new applicants.
        const forensics = source('src/app/actions/forensics.ts');

        expect(forensics).toContain('data.dateOfBirth');
        expect(forensics).toContain('data.kyc?.dateOfBirth');
    });

    it('existing participants are still reported as unchecked, not as eligible', () => {
        // This change only helps from now on. Anyone who enrolled before it has
        // no date on record, and #156 makes the sweep say so rather than pass
        // them — which is the honest state of those records.
        const forensics = source('src/app/actions/forensics.ts');

        expect(forensics).toContain('could not be age-checked');
        expect(forensics).toContain('no date of birth on record');
    });
});
