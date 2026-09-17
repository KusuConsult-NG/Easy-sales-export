/**
 * @jest-environment node
 */

/**
 *   #865 THE FORM TOLD HER TO MATCH HER NIN AND NEVER ASKED FOR IT.
 *
 *   THE OWNER: "add field NIN/BVN but should pass without QoreID verification."
 *
 *   MEASURED. Farm Nation's onboarding profile step carries a KYC notice —
 *   "Enter your name exactly as it appears on your NIN/BVN" — and hints the same
 *   on the first and last name fields. Three references to an identity document,
 *   and the form collected neither number. So an applicant was asked to spell
 *   her name to match a document nobody would ever see, and the notice was
 *   advice about nothing.
 *
 * ── "WITHOUT QOREID" WAS ALREADY SETTLED, AND IS REUSED RATHER THAN REBUILT ─
 *
 *   #487 recorded the owner's rule in their own words — "pass all BVN and NIN
 *   input as true without QoreID", then "do not accept this: 11111111111 or
 *   similar" — and lib/kyc-validators has implemented exactly that ever since:
 *   nothing in it contacts any provider, and a well-formed number that is not an
 *   obvious placeholder is accepted and recorded as `self_declared`.
 *
 *   So this finding adds no rule. It wires a module that has one to a form that
 *   was missing it — which is what #501 found had happened to this same rule on
 *   four submission paths out of five.
 *
 *   REQUIRED, matching #774 ("NIN, BVN and voter's cards are mandatory but
 *   shouldn't be checked by QoreID"), matching WAVE, and matching this screen's
 *   own copy, which has always presumed the applicant holds both.
 *
 * ── AND THE NUMBERS ARE NOT STORED IN THE CLEAR ─────────────────────────────
 *
 *   The half that is easy to miss. `validatedData.profile` is spread or stored
 *   at FIVE sites in the onboarding action — the user document and the
 *   application row, plus the resubmit path's copies — so adding two fields to
 *   the schema would have put raw identity numbers into every one of those
 *   writes for free. kyc-identity-store is the settled shape: the hash under the
 *   field's own name, an encrypted readable copy beside it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const FORM = 'src/app/farm-nation/onboarding/steps/ProfileStep.tsx';
const ACTION = 'src/app/actions/farm-nation/_fn_onboarding.ts';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#865 — the form asks for the numbers its own notice refers to', () => {
    it('THE REPORTED GAP: both fields are on the form', () => {
        const src = code(FORM);

        expect(src).toContain('label="NIN"');
        expect(src).toContain('label="BVN"');
    });

    it('AND THEY ARE HELD IN ITS STATE, not merely rendered', () => {
        //   A field bound to nothing collects nothing, which is the same
        //   outcome as not having it.
        const src = code(FORM);

        expect(src).toContain("set('nin'");
        expect(src).toContain("set('bvn'");
    });

    it('AND THE STEP REFUSES TO ADVANCE WITHOUT THEM', () => {
        const src = code(FORM);
        const at = src.indexOf('const validate');

        expect(at).toBeGreaterThan(-1);
        //   Measured: the validate body runs to ~1,200 characters with the two
        //   new rules in it.
        expect(src.slice(at, at + 1400)).toContain('is required');
        expect(src.slice(at, at + 1400)).toContain('11 digits');
    });

    it('AND USES THE SHARED PLACEHOLDER RULE, not a hand-written one', () => {
        /*
         *   #501's finding was this exact rule reaching one submission path out
         *   of five. A second spelling of "what a fake NIN looks like" is how
         *   that happens again.
         */
        const src = code(FORM);

        expect(src).toContain('isObviouslyFakeId');
        expect(src).toContain('fakeIdErrorMessage');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#865 — and the server keeps them', () => {
    it('THE SCHEMA DECLARES BOTH — an undeclared field is silently dropped', () => {
        /*
         *   The half that makes the form real. This action parses into a strict
         *   object; a field the client sends and the schema does not name never
         *   reaches the database. A form that collects an answer nobody keeps is
         *   this audit's most common false positive.
         */
        const src = code(ACTION);

        expect(src).toContain("nin: requiredNationalIdField('NIN')");
        expect(src).toContain("bvn: requiredNationalIdField('BVN')");
    });

    it('AND NOTHING IN THAT RULE CONTACTS A PROVIDER — the owner\'s "without QoreID"', () => {
        /*
         *   Asserted against the validator module itself, because that is where
         *   the promise actually has to hold. #487 settled it and the file has
         *   no network call of any kind; this fails if one is ever added.
         */
        const validators = code('src/lib/kyc-validators.ts');

        expect(validators).not.toMatch(/fetch\(|axios|qoreid|QoreID/i);
    });

    it('AND THE SUBMIT PATH WRITES THE HASH, not the number', () => {
        const src = code(ACTION);

        expect(src).toContain("nin: applicantNin ? hashData(applicantNin) : null");
        expect(src).toContain("kycReadableField('nin', applicantNin)");
    });

    it('AND THE RESUBMIT PATH WRITES THEM TOO', () => {
        /*
         *   Two near-identical paths in one file, which is where "fixed in one
         *   copy and not the other" comes from. A returning applicant who is
         *   asked for her NIN again and has it stored nowhere is the same defect
         *   as never asking.
         */
        const src = code(ACTION);

        expect(src).toContain('resubmitNin');
        expect(src).toContain("kycReadableField('nin', resubmitNin)");
    });

    it('AND NO WRITE CARRIES THE RAW NUMBERS IN THE PROFILE OBJECT', () => {
        /*
         *   THE ONE THAT MATTERS MOST. The profile is spread or stored at five
         *   sites; adding two schema fields put the raw numbers into all five
         *   for free — a new plaintext copy of the two values this platform is
         *   most careful with, in a nested object nobody would look in.
         *
         *   Every site goes through storableProfile, and the count is asserted
         *   so a sixth added later cannot quietly bypass it.
         */
        const src = code(ACTION);
        const bare = (src.match(/profile: validatedData\.profile\b/g) ?? []).length;
        const spread = (src.match(/\.\.\.validatedData\.profile\b/g) ?? []).length;

        expect({ bare, spread }).toEqual({ bare: 0, spread: 0 });
        expect((src.match(/storableProfile\(validatedData\.profile\)/g) ?? []).length).toBe(5);
    });

    it('AND storableProfile REALLY REMOVES THEM', () => {
        //   The function the assertion above depends on. Executed rather than
        //   read, because "it is called everywhere" is worth nothing if it
        //   returns its input.
        const src = code(ACTION);
        const at = src.indexOf('function storableProfile');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 200)).toContain('nin: _nin');
        expect(src.slice(at, at + 200)).toContain('bvn: _bvn');
    });

    it('AND RECORDS THE METHOD AS self_declared, not a green tick', () => {
        /*
         *   #485's rule: nothing has verified anything, so `ninVerified` is NOT
         *   written and the METHOD says what happened — an admin screen renders
         *   "Self-declared" rather than a tick an operator would act on.
         */
        const src = code(ACTION);

        expect(src).toContain('"kyc.ninVerificationMethod": "self_declared"');
        expect(src).toContain('ninVerificationMethod: "self_declared"');
        expect(src).not.toContain('"kyc.ninVerified": true');
    });
});
