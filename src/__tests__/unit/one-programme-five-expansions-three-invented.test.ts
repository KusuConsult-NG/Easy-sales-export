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
    WAVE_FULL_NAME, WAVE_PROGRAM_NAME, WAVE_NAME_WITH_ACRONYM, WAVE_FORMAL_NAME,
} from '@/lib/wave-program';
import {
    getWards, hasVerifiedWards, NIGERIAN_LOCATIONS,
} from '@/lib/locations';
import { WARDS_BY_STATE_AND_LGA } from '@/lib/nigeria-wards.generated';
import { requiredNationalIdField, requiredVotersCardField, optionalVotersCardField, nationalIdField } from '@/lib/kyc-validators';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
describe('#774(a) — the acronym expands one way', () => {
    it('THE CONSTANT IS THE OWNER\'S WORDING', () => {
        /*
         *   #785 / #788 CORRECTED BY THE OWNER TWICE MORE, and this assertion
         *   moving with them is the constant earning its keep rather than a
         *   regression.
         *
         *   #774 was told "the WAVE acronym is Women Agro-Value Expansion
         *   program". The formal list then said "Ensure that RH-WAVE is
         *   consistently stated as 'Renewed Hope Women Agro Value Expansion'",
         *   and #785 followed that spelling literally, hyphen and all — which
         *   is to say without one. The owner's next message settles it:
         *
         *       "change Women Agro-Value Expansion Program to Renewed Hope
         *        Women Agro-Value Expansion Program"
         *
         *   So the RENEWED HOPE prefix stays and the HYPHEN comes back, and
         *   WAVE_PROGRAM_NAME is that sentence exactly.
         *
         *   One line changed and every screen followed. Before #774 this
         *   correction meant finding strings by hand, which is precisely how
         *   there came to be six spellings.
         */
        expect(WAVE_FULL_NAME).toBe('Renewed Hope Women Agro-Value Expansion');
        expect(WAVE_PROGRAM_NAME).toBe('Renewed Hope Women Agro-Value Expansion Program');
        expect(WAVE_NAME_WITH_ACRONYM).toBe('Renewed Hope Women Agro-Value Expansion (WAVE)');

        //   the RH- prefix is no longer expanding to something the name lacks
        expect(WAVE_FORMAL_NAME).toContain('RH-WAVE');
        expect(WAVE_FORMAL_NAME).toContain('Renewed Hope');
        //   and the word "Program" is NOT baked into the name, or the formal
        //   line reads "...Expansion Program Programme".
        expect(WAVE_FULL_NAME).not.toMatch(/Programme?$/);
    });

    it('#788 AND NOT ONE SCREEN STILL SPELLS IT BY HAND', () => {
        /*
         *   #774 built the constant and wired FIVE screens to it. Twenty-one
         *   more sites went on spelling the name out — the home page, About,
         *   Help, the WAVE landing page six times, the WAVE layout's browser
         *   title, the cooperative landing page, the cooperative's Terms of
         *   Reference, the application-received email and the approval and
         *   rejection emails.
         *
         *   So the owner's correction reached five screens and missed
         *   twenty-one, which is this audit's most repeated finding wearing
         *   the constant that was supposed to prevent it: a correct rule
         *   applied to some of the places it names. A constant only removes
         *   the drift from the files that READ it.
         *
         *   SWEPT, so the next writer cannot add a twenty-second. The two
         *   places the words are allowed to appear literally are the constant
         *   itself and this suite.
         */
        const { execSync } = require('child_process');
        const hits = execSync(
            "grep -rl 'Agro[ -]Value Expansion' src --include=*.ts --include=*.tsx || true",
            { encoding: 'utf8' },
        ).split('\n').filter(Boolean);

        const ALLOWED = [
            'src/lib/wave-program.ts',
            'src/__tests__/unit/one-programme-five-expansions-three-invented.test.ts',
        ];

        expect(hits.filter((f: string) => !ALLOWED.includes(f))).toEqual([]);
        //   Vacuity guard: the sweep must actually be finding the two it is
        //   allowed to find, or an empty result proves nothing.
        expect(hits.sort()).toEqual([...ALLOWED].sort());
    });

    it('AND NO SCREEN ANYWHERE INVENTS ITS OWN', () => {
        /*
         *   #811 THIS TEST WAS ITSELF THE DEFECT IT WAS WRITTEN TO PREVENT.
         *
         *   It used to check a HARD-CODED LIST OF FIVE SCREENS — the ones #774
         *   happened to fix. src/app/dashboard/page.tsx was not on that list,
         *   and it carried "Women Agro-processors Venture Empowerment" on the
         *   WAVE module card of the dashboard every signed-in user lands on.
         *   The owner saw it; this suite could not.
         *
         *   So the assertion that was supposed to stop "a correct rule applied
         *   to some of the places it names" was enumerated rather than swept,
         *   and reproduced exactly that shape. An enumerated list can only ever
         *   be as complete as the day it was written.
         *
         *   IT IS A SWEEP NOW. Every .ts/.tsx file under src, so a sixth
         *   invented expansion fails here by filename rather than by somebody
         *   remembering to extend a list.
         *
         *   Asserted on STRIPPED source, because the comments recording this
         *   finding quote the wrong wordings in order to explain them — the
         *   #741 trap, met once already in #777's first draft.
         */
        const INVENTED: ReadonlyArray<[string, RegExp]> = [
            ['Women Agro-processors Venture Empowerment', /Women Agro-processors Venture Empowerment/],
            ['Women in Agri-Ventures Excellence', /Women in Agri-Ventures Excellence/],
            ['Women in Agriculture Venture Excellence', /Women in Agriculture Venture Excellence/],
            ['Agribusiness Venture Empowerment', /Agribusiness Venture Empowerment/],
            ['Women in Agriculture', /Women in Agriculture(?![ -]Venture)/],
        ];

        /*
         *   The two files allowed to spell the wrong wordings out: the constant
         *   module, whose header records what they were, and this suite.
         *   Everything else is swept — including files that do not exist yet.
         */
        const ALLOWED = new Set([
            //   The constant module, whose header records what the wrong
            //   wordings were so the next reader does not have to reconstruct
            //   them.
            'src/lib/wave-program.ts',
            //   This suite: the regexes above are the literals.
            'src/__tests__/unit/one-programme-five-expansions-three-invented.test.ts',
            //   #777's suite, which asserts the SIXTH expansion is gone from
            //   the application form and must name it to do so. Allowed by
            //   filename rather than by "it is a test", because a test file is
            //   exactly where the wrong wording could hide unnoticed — and
            //   because that suite's own header records the same recurrence:
            //   "#774 found five expansions and corrected four ... was missed
            //   because #774 swept for the four it had already found."
            'src/__tests__/unit/every-application-form-has-a-way-out.test.ts',
        ]);

        const { execSync } = require('child_process');
        const files: string[] = execSync(
            "find src -type f \\( -name '*.ts' -o -name '*.tsx' \\)",
            { encoding: 'utf8' },
        ).split('\n').filter(Boolean).filter((f: string) => !ALLOWED.has(f));

        //   Vacuity guard: a find that returns nothing would pass silently.
        expect(files.length).toBeGreaterThan(500);

        const offenders: string[] = [];
        for (const f of files) {
            const src = stripComments(read(f));
            for (const [label, bad] of INVENTED) {
                if (bad.test(src)) offenders.push(`${f} — "${label}"`);
            }
        }

        expect(offenders).toEqual([]);
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

        /*
         *   #813 THE VACUITY GUARD HAD TO CHANGE, because its premise did.
         *
         *   This line used to be `expect(src).toMatch(/Select all that apply/i)`
         *   — proving the slice above was real by showing the phrase still
         *   existed further down, on the commodity question, "deliberately left
         *   alone".
         *
         *   The owner has since asked for that question to be single-select too
         *   ("ensure you prefered crop/commodity single selection"), so the
         *   phrase is gone from the file and that guard would now fail for the
         *   RIGHT reason — which makes it the wrong guard to keep.
         *
         *   Replaced rather than deleted: the slice still needs proving, so it
         *   is proved against the thing that is actually still true — there IS
         *   a second question below the split point, and it is the commodity
         *   one. A `split` that found nothing would return the whole file and
         *   leave the assertions above passing over text they never read.
         */
        expect(src).toContain('Preferred Crop');
        expect(section.length).toBeGreaterThan(200);
        expect(section.length).toBeLessThan(src.length);
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

    it('nor as a polling unit — and there are 172,000 real ones now', async () => {
        /*
         *   #792 RESTATED. This asked a synchronous getPollingUnits, which read
         *   a hand-written table of TWO wards — and not merely incomplete: four
         *   units for Alausa where INEC's register has eighty-four.
         *
         *   Both the table and the function are gone; the register is five
         *   megabytes and is read on the server, one state at a time. The
         *   property is unchanged: a ward nobody has a list for gets NOTHING,
         *   and the applicant types it.
         */
        const { pollingUnitsFor } = await import('@/lib/polling-units');

        expect(await pollingUnitsFor('Lagos', 'Ikeja', 'NO SUCH WARD')).toEqual([]);
        expect(await pollingUnitsFor('NO SUCH STATE', 'x', 'y')).toEqual([]);
        expect(await pollingUnitsFor('', '', '')).toEqual([]);

        //   CONTROL: a real ward really does answer, or the three above are
        //   satisfied by a lookup that returns nothing to anybody.
        const alausa = await pollingUnitsFor('Lagos', 'Ikeja', 'Alausa/Oregun/Olusosun');
        expect(alausa.length).toBeGreaterThan(50);
        expect(alausa.some(pu => /^\s*(PU\s*)?\d+\s*$/i.test(pu))).toBe(false);
    });

    it('AND NO NUMBERED PLACEHOLDER SURVIVES ANYWHERE IN THE REGISTER', () => {
        /*
         *   #789 RESTATED, AND IT HAD GONE VACUOUS — which is worth saying
         *   plainly, because it PASSED while asserting nothing.
         *
         *   It read the slice of locations.ts between `VERIFIED_WARDS` and
         *   `VERIFIED_PUs`, which is where the two hand-written LGAs used to
         *   live. The real register now lives in a generated module, so that
         *   slice holds 544 characters of declaration and comment and not one
         *   ward name. `not.toMatch(/"Ward \d+"/)` over a string with no wards
         *   in it is true for the same reason it is useless.
         *
         *   So it sweeps the VALUES now — every one of the 8,778 names the
         *   forms can actually offer — and it asks the real question rather
         *   than the 2024 spelling of it. A ward name that is ONLY a number is
         *   not a name, in any of the three ways this register writes one:
         *
         *       "Ward 4"      digits            "PU 001"
         *       "Ward IV"     roman numerals
         *       "Ward One"    words             "One"   ← no prefix at all
         *
         *   The last shape is the one the old assertion could never have
         *   caught: Cross River's Calabar Municipality is written "One … Ten"
         *   with no "Ward" in front of it. Both it and Abia's Ugwunagbo are
         *   excluded by the generator for exactly this, so their applicants
         *   type instead — see scripts/build-wards.ts.
         */
        const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|eigth|nine|ten'
            + '|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';
        const BARE = new RegExp(`^(?:ward|pu)?\\s*(?:\\d+|[ivxlc]+|${NUMBER_WORDS})$`, 'i');

        const offences: string[] = [];
        for (const [composite, wards] of Object.entries(WARDS_BY_STATE_AND_LGA)) {
            for (const w of wards) if (BARE.test(w)) offences.push(`${composite} -> ${w}`);
        }
        expect(offences).toEqual([]);

        //   Vacuity guard for the guard: the sweep must be looking at a real
        //   register, not an empty object.
        const total = Object.values(WARDS_BY_STATE_AND_LGA).reduce((n, w) => n + w.length, 0);
        expect(Object.keys(WARDS_BY_STATE_AND_LGA).length).toBeGreaterThan(750);
        expect(total).toBeGreaterThan(8000);

        //   and the rule itself bites, or the empty result above means nothing
        expect(BARE.test('Ward 4')).toBe(true);
        expect(BARE.test('Ward One')).toBe(true);
        expect(BARE.test('One')).toBe(true);
        expect(BARE.test('Ward IV New Layout')).toBe(false);
        expect(BARE.test('Gwagwalada Centre')).toBe(false);
    });

    it('CONTROL: a real LGA still offers its real wards', () => {
        /*
         *   The vacuity guard. Returning [] for everything would pass every
         *   assertion above and would delete the feature.
         *
         *   #789 It read LGA names out of locations.ts with a regex that
         *   actually matched the STATE keys of NIGERIAN_LOCATIONS — so it was
         *   passing because "Bauchi" happens to be both a state and an LGA.
         *   It asks the list itself now.
         */
        const gwagwalada = getWards('Gwagwalada', 'FCT');
        expect(gwagwalada.length).toBeGreaterThan(0);
        expect(gwagwalada).toContain('Gwagwalada Centre');
        expect(hasVerifiedWards('Gwagwalada', 'FCT')).toBe(true);

        //   Every state has at least one LGA whose wards are known, so no
        //   applicant anywhere opens a form with a list that is empty for her
        //   whole state.
        for (const [state, lgas] of Object.entries(NIGERIAN_LOCATIONS)) {
            expect({ state, any: lgas.some(l => getWards(l, state).length > 0) })
                .toEqual({ state, any: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#774(d) — mandatory, and still nobody is called', () => {
    it('A BLANK NIN OR BVN IS REFUSED', () => {
        expect(requiredNationalIdField('NIN').safeParse('').success).toBe(false);
        expect(requiredNationalIdField('BVN').safeParse('').success).toBe(false);
        //   The STRICT card rule is unchanged and still refuses a blank; what
        //   changed is which paths ask for it. See the next test.
        expect(requiredVotersCardField().safeParse('').success).toBe(false);
    });

    it('#820 BUT THE VOTER\'S CARD IS OPTIONAL NOW — the owner reversed it', () => {
        /*
         *   #774(d) made NIN, BVN and the Voter's Card all mandatory, to a
         *   direct instruction. The owner has since said "make voter's card
         *   optional", which supersedes it for the WAVE application.
         *
         *   RECORDED RATHER THAN QUIETLY DELETED. The requirement was asserted
         *   here for a reason, and a reader finding it gone would not know
         *   whether it lapsed or was decided. It was decided.
         *
         *   OPTIONAL IS NOT UNVALIDATED. A blank passes; a value that cannot be
         *   a card is still refused, so somebody who fills the box in is told
         *   at the form rather than at review.
         */
        expect(optionalVotersCardField().safeParse('').success).toBe(true);
        expect(optionalVotersCardField().safeParse(undefined).success).toBe(true);

        expect(optionalVotersCardField().safeParse('90F5B123456789012345').success).toBe(true);
        //   one character repeated, and too short — the #487 shapes
        expect(optionalVotersCardField().safeParse('0000000000').success).toBe(false);
        expect(optionalVotersCardField().safeParse('AB1').success).toBe(false);
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

        //   #820 The card is optional on the form now, so the message that
        //   matters for it is the one a WRONG value gets, not a blank one.
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
        //   #820 The card is OPTIONAL on this screen now — but it is still
        //   validated, which is the property this line is really about. A step
        //   that dropped the check entirely must still fail here.
        expect(civic).toMatch(/optionalVotersCardField\(\)/);
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
