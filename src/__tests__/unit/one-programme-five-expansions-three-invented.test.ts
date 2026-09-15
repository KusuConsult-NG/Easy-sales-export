/**
 * @jest-environment node
 */

/**
 *   #774 THE OWNER'S WAVE CORRECTIONS, EACH ONE MEASURED.
 *
 *   Five separate reports in one message, and each is a different defect that
 *   happens to live in the same module:
 *
 *     "The WAVE acronym is Women Agro-Value Expansion program."
 *     "Section D on wave application (which area would you like to
 *      participate) should have single option not multiple."
 *     "ward should be names of wards not ward 1 ward 2 etc."
 *     "NIN, BVN and voter's cards are mandatory but shouldn't be checked by
 *      QoreID."
 *     "after submitting WAVE application and the activate my button was clicked,
 *      the button took the user to the user's account and then nothing showed
 *      just the sidebar and a blank page."
 *
 * ── (a) ONE PROGRAMME, FIVE EXPANSIONS, THREE OF THEM INVENTED ──────────────
 *
 *   Swept across the repository, the letters were being expanded as:
 *
 *       Women Agro-Value Expansion                   the real one
 *       Women Agro-processors Venture Empowerment    /auth/get-started
 *       Women in Agriculture                         /admin/wave
 *       Women in Agri-Ventures Excellence            /wave/access-denied
 *       Women in Agriculture Venture Excellence      the admin report export
 *
 *   Three of those are not abbreviations of anything — they are different
 *   programmes, written by somebody guessing from the letters. Two of the four
 *   screens carrying them are the ones an applicant meets FIRST: get-started,
 *   where she chooses a programme, and access-denied, which is all an
 *   ineligible applicant ever sees of it.
 *
 *   (A SIXTH turned up later on the application form itself — see #777.)
 *
 * ── (b) "SELECT ALL THAT APPLY" ON A SINGLE-CHOICE QUESTION ─────────────────
 *
 *   Section D rendered checkboxes and stored an array. The owner says it is one
 *   answer, so it is a radio group storing `[area]` — a one-element array, so
 *   the stored shape, the schema and every reader downstream are unchanged.
 *
 * ── (c) A DROPDOWN IS A CLAIM THAT THESE ARE THE CHOICES ────────────────────
 *
 *   getWards fell back to "Ward 1 … Ward 10" for 772 of Nigeria's 774 LGAs, and
 *   getPollingUnits to "PU 001 …". Those are not places. An applicant picking
 *   "Ward 3" recorded something that means nothing, and a reviewer reading it
 *   could not tell it from a real answer.
 *
 *   The invented rows are gone and the lists return empty where the real names
 *   are not known; the step renders a TEXT INPUT there instead, so the
 *   applicant types the ward she actually lives in. A dropdown appears only
 *   where the data is real.
 *
 * ── (d) MANDATORY, WITH NO EXTERNAL CHECK ───────────────────────────────────
 *
 *   The owner's two instructions look opposed and are not, and #487 already
 *   settled the reading: PASS means do not require an outside provider;
 *   MANDATORY means the field may not be blank. Nothing in kyc-validators
 *   contacts anybody, and `requiredNationalIdField` is `nationalIdField` plus
 *   "not blank".
 *
 *   The client had to move WITH the schema. It did not, at first: the step that
 *   owns identity validated only the NIN, and the voter's card input had no
 *   `error` prop at all — so a message written for it would have been invisible
 *   and the applicant stopped by nothing she could see. Both are fixed, and the
 *   BVN is checked on the step that DRAWS it rather than the step that owns
 *   identity, for the same reason.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     a numbered "Ward 5" restored to the ward list              KILLED
 *     hasVerifiedWards made to answer true always                KILLED
 *     the required rule's .min(1) dropped                SURVIVED → KILLED
 *     the value-chain setter made additive again                 KILLED
 *     an invented expansion put back on a screen                 KILLED
 *     reword this header                               SURVIVED, intended
 *
 *   THE .min(1) MUTANT SURVIVED THE FIRST RUN and deserved to: an empty string
 *   also fails the eleven-digit rule, so REFUSAL is unchanged and every
 *   blank-is-refused assertion still held. What the mutant changed was the
 *   MESSAGE — an applicant who left the box empty was told her NIN "must be
 *   exactly 11 digits", which asks her to correct something she never typed.
 *   The suite now asserts the message, and the mutant dies on it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    WAVE_FULL_NAME, WAVE_PROGRAM_NAME, WAVE_NAME_WITH_ACRONYM,
} from '@/lib/wave-program';
import {
    getWards, getPollingUnits, hasVerifiedWards, hasVerifiedPollingUnits,
} from '@/lib/locations';
import { requiredNationalIdField, requiredVotersCardField, nationalIdField } from '@/lib/kyc-validators';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
describe('#774(a) — the acronym expands one way', () => {
    it('THE CONSTANT IS THE OWNER\'S WORDING', () => {
        expect(WAVE_FULL_NAME).toBe('Women Agro-Value Expansion');
        expect(WAVE_PROGRAM_NAME).toContain(WAVE_FULL_NAME);
        expect(WAVE_NAME_WITH_ACRONYM).toBe('Women Agro-Value Expansion (WAVE)');
    });

    it('AND NO SCREEN INVENTS ITS OWN', () => {
        /*
         *   The four screens that each carried a different expansion. Asserted
         *   on the STRIPPED source, because the comments recording this finding
         *   quote the wrong wordings in order to explain them — the #741 trap,
         *   met once already in #777's first draft.
         */
        const SCREENS = [
            'src/app/auth/get-started/page.tsx',
            'src/app/wave/access-denied/page.tsx',
            'src/app/admin/wave/page.tsx',
            'src/app/api/admin/wave/reports/export/route.ts',
            'src/app/wave/application/WaveApplicationClient.tsx',
        ];
        const INVENTED = [
            /Women Agro-processors Venture Empowerment/,
            /Women in Agri-Ventures Excellence/,
            /Women in Agriculture Venture Excellence/,
            /Agribusiness Venture Empowerment/,
        ];

        expect(SCREENS.length).toBe(5);
        for (const s of SCREENS) {
            const src = stripComments(read(s));
            for (const bad of INVENTED) expect(src).not.toMatch(bad);
        }
    });

    it('and each of those screens reads the constant instead', () => {
        //   The vacuity guard for the assertion above: deleting the sentence
        //   entirely would also satisfy "does not match", and would lose the
        //   programme's name from the screen.
        for (const s of [
            'src/app/auth/get-started/page.tsx',
            'src/app/wave/access-denied/page.tsx',
            'src/app/admin/wave/page.tsx',
            'src/app/api/admin/wave/reports/export/route.ts',
        ]) {
            expect(read(s)).toMatch(/WAVE_(FULL_NAME|NAME_WITH_ACRONYM|PROGRAM_NAME|FORMAL_NAME)/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#774(b) — Section D takes one answer', () => {
    const step = () => stripComments(read('src/app/wave/application/steps/AgriInterestStep.tsx'));

    it('THE VALUE-CHAIN CONTROL IS A RADIO GROUP, NOT CHECKBOXES', () => {
        const src = step();
        expect(src).toMatch(/type="radio"/);
        expect(src).toMatch(/name="waveValueChainArea"/);
    });

    it('AND SELECTING REPLACES RATHER THAN ACCUMULATES', () => {
        //   The property, not the spelling: the setter must write a
        //   ONE-ELEMENT array. An additive setter with radio inputs would
        //   still look right on screen and still store two answers.
        const src = step();
        expect(src).toMatch(/valueChainAreas:\s*\[\s*area\s*\]/);
        //   and the old additive path is gone
        expect(src).not.toMatch(/valueChainAreas:\s*\[\s*\.\.\./);
    });

    it('and the prompt no longer invites several', () => {
        /*
         *   SCOPED TO THE VALUE-CHAIN QUESTION, and the first draft was not —
         *   it swept the whole file and failed on "Preferred Crop / Commodity",
         *   which is a DIFFERENT question, genuinely multi-select, and not one
         *   the owner asked to change. That is the recurring trap in this
         *   audit: an assertion satisfied, or broken, by the wrong occurrence.
         *   The remedy is the slice.
         */
        const src = step();
        const section = src.split('Preferred Crop')[0];

        expect(section).toMatch(/\(Select one\)/);
        expect(section).not.toMatch(/Select all that apply/i);
        //   and the commodity question is deliberately left alone
        expect(src).toMatch(/Select all that apply/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#774(c) — a ward list names wards', () => {
    it('NO NUMBERED PLACEHOLDER IS OFFERED AS A WARD', () => {
        //   THE test. getWards used to answer "Ward 1 … Ward 10" for any LGA
        //   it did not know, which is 772 of 774.
        const unknown = getWards('AN LGA THAT DOES NOT EXIST');

        expect(unknown).toEqual([]);
        expect(hasVerifiedWards('AN LGA THAT DOES NOT EXIST')).toBe(false);
    });

    it('nor as a polling unit', () => {
        expect(getPollingUnits('NO SUCH WARD')).toEqual([]);
        expect(hasVerifiedPollingUnits('NO SUCH WARD')).toBe(false);
    });

    it('AND NO VERIFIED LIST ANYWHERE CONTAINS A NUMBERED PLACEHOLDER', () => {
        /*
         *   The sweep, not a specimen. A single leftover "Ward 4" in a real
         *   LGA's list would be exactly the defect, and testing one unknown LGA
         *   cannot see it.
         */
        const src = read('src/lib/locations.ts');
        const verified = src.split('VERIFIED_WARDS')[1].split('VERIFIED_PUs')[0];

        expect(verified).not.toMatch(/["']Ward \d+["']/);
        expect(verified).not.toMatch(/["']PU \d+["']/);
    });

    it('CONTROL: a real LGA still offers its real wards', () => {
        //   The vacuity guard. Returning [] for everything would pass every
        //   assertion above and would delete the feature.
        const src = read('src/lib/locations.ts');
        const known = [...src.matchAll(/^\s*["']([^"']+)["']:\s*\[/gm)].map(m => m[1]);
        const withWards = known.find(k => getWards(k).length > 0);

        expect(withWards).toBeDefined();
        expect(getWards(withWards as string).length).toBeGreaterThan(0);
        expect(hasVerifiedWards(withWards as string)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#774(d) — mandatory, and still nobody is called', () => {
    it('A BLANK NIN, BVN OR VOTER\'S CARD IS REFUSED', () => {
        expect(requiredNationalIdField('NIN').safeParse('').success).toBe(false);
        expect(requiredNationalIdField('BVN').safeParse('').success).toBe(false);
        expect(requiredVotersCardField().safeParse('').success).toBe(false);
    });

    it('AND A BLANK FIELD IS TOLD IT IS REQUIRED, not that it is the wrong length', () => {
        /*
         *   Dropping `.min(1)` from requiredNationalIdField SURVIVED the first
         *   mutation run, and it deserved to on the assertion above: an empty
         *   string also fails the eleven-digit rule, so refusal is unchanged.
         *   What changes is what the applicant READS — "NIN must be exactly 11
         *   digits" for a box she has not filled in, which tells her to correct
         *   something she never entered.
         *
         *   The message is the property, so the message is asserted.
         */
        const blankNin = requiredNationalIdField('NIN').safeParse('');
        expect(blankNin.success).toBe(false);
        expect(blankNin.error!.issues[0]?.message).toMatch(/required/i);

        const blankCard = requiredVotersCardField().safeParse('');
        expect(blankCard.error!.issues[0]?.message).toMatch(/required/i);

        //   and a number of the WRONG LENGTH still gets the length message
        const short = requiredNationalIdField('NIN').safeParse('123');
        expect(short.error!.issues[0]?.message).toMatch(/11 digits/i);
    });

    it('AND THE OWNER\'S OWN EXAMPLE IS STILL REFUSED', () => {
        //   "do not accept this: 11111111111 or similar combination"
        expect(requiredNationalIdField('NIN').safeParse('11111111111').success).toBe(false);
        expect(requiredNationalIdField('BVN').safeParse('12345678901').success).toBe(false);
    });

    it('AND A REAL-LOOKING NUMBER PASSES WITH NO EXTERNAL CHECK', () => {
        //   "pass all BVN and NIN input as true without QoreID"
        expect(requiredNationalIdField('NIN').safeParse('22107458391').success).toBe(true);
        expect(requiredNationalIdField('BVN').safeParse('22107458391').success).toBe(true);
    });

    it('the required rule is the optional rule plus "not blank", not a second copy', () => {
        //   Two hand-maintained copies of one contract is the defect class this
        //   audit keeps finding. Anything the optional rule refuses, the
        //   required one must refuse too.
        for (const bad of ['1', '123', '11111111111', 'abcdefghijk', '1234567890123']) {
            if (nationalIdField('NIN').safeParse(bad).success) continue;
            expect(requiredNationalIdField('NIN').safeParse(bad).success).toBe(false);
        }
    });

    it('NOTHING IN THE VALIDATORS CONTACTS A PROVIDER', () => {
        //   The half of the owner's instruction that is easy to lose while
        //   satisfying the other half.
        //   Stripped, because the owner's instruction — "without QoreID" — is
        //   quoted in this file's own header, where naming the provider is the
        //   point. What matters is that no CODE calls one.
        const src = stripComments(read('src/lib/kyc-validators.ts'));

        expect(src).not.toMatch(/fetch\(|axios|qoreid/i);
    });

    it('AND THE STEPS ENFORCE ALL THREE, EACH ON THE SCREEN THAT DRAWS IT', () => {
        const civic = stripComments(read('src/app/wave/application/steps/CivicStatusStep.tsx'));
        const financial = stripComments(read('src/app/wave/application/steps/FinancialStep.tsx'));

        expect(civic).toMatch(/requiredNationalIdField\('NIN'\)/);
        expect(civic).toMatch(/requiredVotersCardField\(\)/);
        //   the BVN is collected in Section E, so it is checked there
        expect(financial).toMatch(/requiredNationalIdField\('BVN'\)/);
    });

    it('AND EVERY FIELD WITH A RULE CAN SHOW ITS MESSAGE', () => {
        /*
         *   The voter's-card input had NO `error` prop. A validation message
         *   written for it would have been invisible, and the applicant would
         *   have been held on a step that looked complete with nothing marked.
         *   That is worse than no validation, which is why it is asserted.
         */
        const civic = stripComments(read('src/app/wave/application/steps/CivicStatusStep.tsx'));

        expect(civic).toMatch(/error=\{errors\.nin\}/);
        expect(civic).toMatch(/error=\{errors\.votersCardNumber\}/);
    });

    it('and no screen still calls these fields optional', () => {
        //   A form that says "optional" and a server that refuses blank is the
        //   #773 shape: the applicant fills seven steps and is turned away by a
        //   message naming no field.
        const civic = stripComments(read('src/app/wave/application/steps/CivicStatusStep.tsx'));
        const financial = stripComments(read('src/app/wave/application/steps/FinancialStep.tsx'));

        expect(civic).not.toMatch(/NIN is optional/i);
        expect(civic).not.toMatch(/not enforced/i);
        //   the BVN label carried "(Optional)" directly beside a comment that
        //   said "REQUIRED on WAVE"
        const bvnLabel = financial.split('Bank Verification Number (BVN)')[1]?.slice(0, 200) ?? '';
        expect(bvnLabel).not.toMatch(/\(Optional\)/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#774(e) — the activate button goes where the membership is', () => {
    it('IT NO LONGER SENDS A PENDING APPLICANT TO THE WAVE DASHBOARD', () => {
        /*
         *   The applicant's registration is `pending` seconds after she submits,
         *   so checkModuleAccess refuses /wave/dashboard and the member layout
         *   bounces her back to the form she has just completed. The membership
         *   the page is selling is the cooperative's, in its own words.
         */
        const src = stripComments(read('src/app/wave/application/success/page.tsx'));

        expect(src).toMatch(/\/cooperatives\/onboarding/);
        expect(src).not.toMatch(/["'`]\/wave\/dashboard["'`]/);
    });
});
