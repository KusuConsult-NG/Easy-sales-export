/**
 * @jest-environment node
 */

/**
 *   #792 THE POLLING-UNIT FIELD KNEW TWO WARDS OUT OF 8,780.
 *
 *   #774 removed the "PU 001 … PU 010" placeholder — a number that matches
 *   nothing on a voter's card is not an answer — and left real names for Alausa
 *   and Garki, saying the rest had to be added one verified ward at a time.
 *   #789 did that for wards; this does it for the level below, at the owner's
 *   instruction to finish it.
 *
 *   AND THE TWO IT KNEW WERE WRONG, not merely few. It held FOUR polling units
 *   for Alausa where INEC's register has EIGHTY-FOUR, and seven for Garki
 *   against a hundred and sixty-nine. A dropdown offering four of eighty-four is
 *   a claim that those are the choices — which is the same defect as the
 *   numbered placeholder, wearing real names.
 *
 * ── THE SOURCE, AND THE ONE THAT WAS REJECTED ───────────────────────────────
 *
 *   sadiqsalau/inec-ng-data — 37 states, 774 LGAs, 8,809 wards, 176,595 polling
 *   units against INEC's published 176,846, which is 99.86% of the register. Its
 *   ward count matches INEC's own figure AND the independently packaged source
 *   #789 used, which is what makes it the register rather than an export.
 *
 *   afeibukun/nigerian-state-lgas-wards-polling-units was measured and rejected:
 *   118,532 units — a third of the register missing — and slugified names.
 *
 * ── WHAT THE JOIN REFUSES TO DO ─────────────────────────────────────────────
 *
 *   Ward names come from #789's source and polling units from this one, so they
 *   have to be joined on free text — exactly where a wrong answer gets attached
 *   to a real-looking record. The rules are deductions, not similarity scores;
 *   the generator's header sets them out. 8,687 of 8,780 wards matched, 0 LGAs
 *   unmatched, and the 93 that did not get NOTHING, which is what all 8,780 had
 *   before.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     pollingUnitsFor returning the whole shard for any ward       KILLED
 *     the shard lookup ignoring the state                          KILLED
 *     the catch returning a list instead of logging and emptying   KILLED
 *     the form's datalist unhooked from the fetch                  KILLED
 *     a bare "PU 001" admitted to the register                     KILLED
 *     the generated index reverted to a template-literal import    KILLED
 *     reword this header                                SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { WARDS_BY_STATE_AND_LGA } from '@/lib/nigeria-wards.generated';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const DIR = 'src/data/polling-units';
const lookup = () => import('@/lib/polling-units');

// ─────────────────────────────────────────────────────────────────────────────
describe('#792 — the register is there, and it is the real one', () => {
    it('EVERY STATE HAS A SHARD, and an index that names them all', () => {
        const files = readdirSync(join(process.cwd(), DIR)).filter(f => f.endsWith('.json'));
        expect(files.length).toBe(37);

        const index = read(`${DIR}/index.ts`);
        expect(index).toMatch(/GENERATED — DO NOT EDIT BY HAND/);
        expect((index.match(/\(\) => import\("\.\//g) ?? []).length).toBe(37);
    });

    it('A STATIC IMPORT MAP, not a template-literal import', () => {
        /*
         *   `import(`./${slug}.json`)` is invisible to the bundler, so the
         *   shards would not be traced into the deployment: every lookup would
         *   return nothing IN PRODUCTION while working perfectly here. That is
         *   the worst shape a defect can take, so it is pinned.
         */
        const index = stripComments(read(`${DIR}/index.ts`));
        expect(index).not.toMatch(/import\(`/);
        expect(index).toMatch(/"Lagos": \(\) => import\("\.\/lagos\.json"\)/);
    });

    it('AND IT COVERS ESSENTIALLY THE WHOLE COUNTRY', () => {
        let wards = 0;
        let units = 0;
        for (const f of readdirSync(join(process.cwd(), DIR)).filter(x => x.endsWith('.json'))) {
            const shard = JSON.parse(read(`${DIR}/${f}`)) as Record<string, string[]>;
            wards += Object.keys(shard).length;
            units += Object.values(shard).reduce((n, u) => n + u.length, 0);
        }
        const totalWards = Object.values(WARDS_BY_STATE_AND_LGA).reduce((n, w) => n + w.length, 0);

        expect(wards).toBeGreaterThanOrEqual(8600);
        expect(wards / totalWards).toBeGreaterThan(0.98);
        expect(units).toBeGreaterThan(170_000);
    });

    it('AND NOT ONE POLLING UNIT IS A BARE NUMBER', () => {
        /*
         *   #774's rule, one level down and swept over all 172,000: "PU 001" is
         *   not a place, and a number that matches nothing on a voter's card is
         *   not an answer. A single survivor would be the defect.
         */
        const BARE = /^(?:ward|pu|unit)?\s*(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)$/i;
        const offences: string[] = [];
        for (const f of readdirSync(join(process.cwd(), DIR)).filter(x => x.endsWith('.json'))) {
            const shard = JSON.parse(read(`${DIR}/${f}`)) as Record<string, string[]>;
            for (const [k, units] of Object.entries(shard)) {
                for (const u of units) if (BARE.test(u)) offences.push(`${f} ${k} -> ${u}`);
            }
        }
        expect(offences.slice(0, 5)).toEqual([]);

        //   the rule bites, or the empty list above proves nothing
        expect(BARE.test('PU 001')).toBe(true);
        expect(BARE.test('Secretariat Gate 1')).toBe(false);
    });

    it('and no shard lists the same unit twice in one ward', () => {
        const dupes: string[] = [];
        for (const f of readdirSync(join(process.cwd(), DIR)).filter(x => x.endsWith('.json'))) {
            const shard = JSON.parse(read(`${DIR}/${f}`)) as Record<string, string[]>;
            for (const [k, units] of Object.entries(shard)) {
                if (new Set(units.map(u => u.toLowerCase())).size !== units.length) dupes.push(`${f} ${k}`);
            }
        }
        expect(dupes).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#792 — the lookup answers for the right ward and nobody else', () => {
    it('THE TWO WARDS THE PLATFORM USED TO KNOW ARE NOW COMPLETE', async () => {
        /*
         *   THE measurement. The hand-written table had four units for Alausa
         *   and seven for Garki; both were presented in a dropdown as the
         *   choices.
         */
        const { pollingUnitsFor } = await lookup();

        const alausa = await pollingUnitsFor('Lagos', 'Ikeja', 'Alausa/Oregun/Olusosun');
        const garki = await pollingUnitsFor('FCT', 'Municipal Area Council', 'Garki');

        expect(alausa.length).toBeGreaterThan(50);
        expect(garki.length).toBeGreaterThan(100);
    });

    it('AND THE STATE IS PART OF THE QUESTION', async () => {
        //   Six LGA names belong to two states each (#789), and ward names
        //   repeat far more often than that. A lookup that ignored the state
        //   would hand a woman another state's polling units.
        const { pollingUnitsFor } = await lookup();

        expect(await pollingUnitsFor('Kano', 'Ikeja', 'Alausa/Oregun/Olusosun')).toEqual([]);
        expect(await pollingUnitsFor('NO SUCH STATE', 'Ikeja', 'Alausa/Oregun/Olusosun')).toEqual([]);
    });

    it('AND AN UNKNOWN WARD GETS NOTHING, not somebody else\'s list', async () => {
        const { pollingUnitsFor } = await lookup();

        expect(await pollingUnitsFor('Lagos', 'Ikeja', 'NO SUCH WARD')).toEqual([]);
        expect(await pollingUnitsFor('Lagos', 'NO SUCH LGA', 'Alausa/Oregun/Olusosun')).toEqual([]);
        expect(await pollingUnitsFor('', '', '')).toEqual([]);
    });

    it('is case- and punctuation-insensitive, because a form spells it its own way', async () => {
        const { pollingUnitsFor } = await lookup();
        const exact = await pollingUnitsFor('Lagos', 'Ikeja', 'Alausa/Oregun/Olusosun');
        const loose = await pollingUnitsFor('lagos', 'IKEJA', 'alausa / oregun / olusosun');
        expect(loose).toEqual(exact);
    });

    it('A FAILED SHARD IS LOGGED, not returned as "no polling units"', () => {
        //   #786's class: a failure that looks exactly like a legitimate empty
        //   answer. The form still degrades to a typed entry, which is safe;
        //   the log is what makes the difference visible.
        const src = stripComments(read('src/lib/polling-units.ts'));
        const CATCH = src.slice(src.indexOf('} catch'));

        expect(CATCH).toMatch(/logger\.error/);
        expect(CATCH).toMatch(/return \[\];/);
    });

    it('AND IT IS SERVER-ONLY — five megabytes must not reach a browser', () => {
        const src = read('src/lib/polling-units.ts');
        expect(src).toMatch(/^import "server-only";/m);

        //   and nothing under src/app imports the shards directly
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
                const p = `${dir}/${e.name}`;
                if (e.isDirectory()) walk(p);
                else if (/\.tsx?$/.test(e.name) && read(p).includes('@/data/polling-units')) offenders.push(p);
            }
        };
        walk('src/app');
        expect(offenders).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#792 — the form asks for one ward at a time', () => {
    const STEP = 'src/app/wave/application/steps/CivicStatusStep.tsx';

    it('IT FETCHES ON THE WARD, and offers what comes back', () => {
        const src = stripComments(read(STEP));

        expect(src).toMatch(/\/api\/locations\/polling-units\?/);
        /*
         *   #823 The units reach a ComboBox now, not a <datalist>. That control
         *   drew nothing at all on iOS Safari — no element, so nothing to
         *   style — and filtered itself to the value already in the field, so
         *   an applicant coming back to correct her answer saw an empty list.
         *
         *   The property here is unchanged and is what is asserted: the units
         *   that come back from the route are OFFERED to her.
         */
        expect(src).toMatch(/options=\{pollingUnits\}/);
        //   re-asked when the ward changes, or it shows the previous ward's units
        expect(src).toMatch(/\[data\?\.stateOfResidence, data\?\.lgaOfResidence, data\?\.ward\]/);
    });

    it('AND A TYPED ANSWER IS STILL ACCEPTED', () => {
        /*
         *   93 wards have no list, and a unit can be missing from one that does.
         *   A required dropdown on an incomplete list is #789's cooperative
         *   blocker waiting to happen again.
         */
        const src = stripComments(read(STEP));
        expect(src).not.toMatch(/<select[^>]*pollingUnit/);
        expect(src).toMatch(/Type your polling unit/);
    });

    it('AND THE ROUTE REFUSES AN ANONYMOUS CALLER', () => {
        /*
         *   #792 THIS ASSERTION USED TO SAY THE OPPOSITE, and the end-to-end
         *   auth contract was right to fail it.
         *
         *   The route shipped public on the argument that INEC publishes this
         *   register and prints it on every voter's card — true, and not the
         *   question. api-auth-contract discovers every route under src/app/api
         *   and requires each to refuse an anonymous caller unless listed there
         *   as well; being told twice by the platform's own rules was the cue to
         *   re-examine the decision rather than add a second exemption.
         *
         *   It does not survive re-examination: the only caller is the WAVE
         *   application form, which is BEHIND A LOGIN. A session check costs a
         *   member nothing, and public access left 172,000 records free to
         *   enumerate for callers who have no use for them.
         */
        const p = 'src/app/api/locations/polling-units/route.ts';
        expect(existsSync(join(process.cwd(), p))).toBe(true);

        const src = stripComments(read(p));
        expect(src).toMatch(/pollingUnitsFor\(/);
        expect(src).toMatch(/requireSession\(\)/);
        expect(src).toMatch(/status: 401/);
    });
});
