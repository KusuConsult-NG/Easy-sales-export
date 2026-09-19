/**
 * @jest-environment node
 */

/**
 *   #842 THREE HUNDRED AND THIRTY-FOUR FARMERS WERE REPORTED AS TWO HUNDRED AND
 *   SIX — and #841 PROVED TO REACH EVERY MODULE, not just WAVE.
 *
 *   The owner, of the compliance report's "Business Types" panel, from
 *   production:
 *
 *       Farmer 206 · Farmer 112 · FARMER 11 · farmer 4 · Farmers 1
 *       Trader 60  · Trader 13  · TRADER 3
 *       Business 39 · Business 16 · BUSINESS 3 · business 2
 *       BUSINESSWOMAN 33 · BUSINESSWOMAN 4 · Business woman 1
 *
 *   `currentOccupation` is free text and the breakdown grouped on the raw
 *   string, so "Farmer" and "Farmer " — one trailing space — were two different
 *   occupations. The largest group in the programme was split five ways and
 *   understated by 38%, on the panel whose top line gets quoted to a funder.
 *
 * ── AND THE SECOND HALF OF THIS SUITE IS THE MORE IMPORTANT ONE ─────────────
 *
 *   "the fixes needs to be applied on other modules so they report the exact
 *   numbers and not the fake numbers."
 *
 *   #841 — excluding `not_started`, the value canonical/normalizer writes when
 *   an account has NO registration for a module — landed in
 *   lib/module-applicant-count, which all five modules share. So it reaches them
 *   all by construction. That is a claim, and claims of this shape are exactly
 *   what this audit keeps finding to be false: #774's acronym took five sweeps,
 *   #824 found an eighth site, #838 found one of two screens.
 *
 *   So it is EXECUTED, per module, against a fixture carrying the same
 *   not_started rows — rather than asserted from the fact that they call a
 *   shared function.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { groupFreeText, groupingKey } from '@/lib/free-text-grouping';

/*
 *   THIS SUITE TESTS THE PER-BUCKET FALLBACK, AND NOW SAYS SO.
 *
 *   It predates #850, which put `module_registration_counts` in front of the
 *   per-bucket counts. It kept passing because the rollup call failed in the
 *   test environment and EVERY failure fell through to the fallback — so the
 *   path under test was reached by accident rather than by choice.
 *
 *   That blanket fall-through is the defect fixed in
 *   the-fallback-was-the-thing-that-timed-out: a rollup that TIMED OUT sent
 *   five to fifteen more sequential scans at the table that was already too
 *   slow. The fallback now fires only for PGRST202 / 42883 — the function not
 *   being there — which is the condition #850 wrote it for and the one this
 *   suite means.
 *
 *   Declared rather than inferred. Nothing else here changes.
 */
jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
        rpc: async () => ({
            data: null,
            error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
        }),
    },
}));


let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#842 — a free-text answer is grouped by what it says, not how it was typed', () => {
    it('THE REPORTED CASE: the farmers are one group again', () => {
        /*
         *   The owner's actual production spellings and counts. 206 + 112 + 11 +
         *   4 + 1 = 334, reported as 206.
         */
        const values = [
            ...Array(206).fill('Farmer '),
            ...Array(112).fill('Farmer'),
            ...Array(11).fill('FARMER'),
            ...Array(4).fill('farmer'),
            ...Array(1).fill('Farmers'),
        ];

        const { counts } = groupFreeText(values);

        //   "Farmers" is a DIFFERENT word, not a spacing difference, so it stays
        //   its own group. Merging it would be a taxonomy decision.
        expect(counts['Farmer']).toBe(333);
        expect(counts['Farmers']).toBe(1);
    });

    it('AND THE LABEL IS THE COMMONEST SPELLING, trimmed', () => {
        //   A trailing space is invisible on a chart, so a label of "Farmer "
        //   would read as a rendering bug.
        const { counts } = groupFreeText([
            ...Array(206).fill('Farmer '), ...Array(11).fill('FARMER'),
        ]);

        expect(Object.keys(counts)).toEqual(['Farmer']);
    });

    it('AND TRADER AND BUSINESS COLLAPSE THE SAME WAY', () => {
        const trader = groupFreeText([
            ...Array(60).fill('Trader'), ...Array(13).fill('Trader '), ...Array(3).fill('TRADER'),
        ]);
        expect(trader.counts['Trader']).toBe(76);

        const business = groupFreeText([
            ...Array(39).fill('Business'), ...Array(16).fill('Business '),
            ...Array(3).fill('BUSINESS'), ...Array(2).fill('business'),
        ]);
        expect(business.counts['Business']).toBe(60);
    });

    it('BUT A TYPO IS NOT GUESSED AT, and that is deliberate', () => {
        /*
         *   The same production list contains Farmeo, Fermer, Faremer, Farmar,
         *   Famer, Farma, Far and Treder. Every one is almost certainly a
         *   misspelling — and "almost certainly" is the standard this audit
         *   exists to refuse. Folding `Far` into `Farmer` by edit distance would
         *   fold in whatever the next reader types, silently, and produce a
         *   number nobody can reproduce from the data.
         */
        const { counts } = groupFreeText(['Farmer', 'Farmeo', 'Fermer', 'Far', 'Farmar']);

        expect(counts['Farmer']).toBe(1);
        expect(counts['Farmeo']).toBe(1);
        expect(counts['Far']).toBe(1);
    });

    it('AND TWO OCCUPATIONS IN ONE ANSWER ARE NOT SPLIT', () => {
        //   "Trader and Farmer" is a person doing two things. Assigning her to a
        //   category is the programme's decision, not a chart's.
        const { counts } = groupFreeText(['Trader and Farmer', 'FARMER/BUSINESSWOMAN', 'Farmer']);

        expect(counts['Trader and Farmer']).toBe(1);
        expect(counts['FARMER/BUSINESSWOMAN']).toBe(1);
        expect(counts['Farmer']).toBe(1);
    });

    it('AND THE UNCONSTRAINED TAIL IS REPORTED, not tidied away', () => {
        /*
         *   The gap between raw and grouped is the measure of how open the field
         *   is. Hiding it would remove the argument for constraining the form,
         *   which is the actual fix for a hundred-and-thirty-row chart.
         */
        const g = groupFreeText([
            'Farmer', 'Farmer ', 'FARMER',   // 3 raw → 1 group
            'Nurse', 'Tailor',               // 2 singletons
        ]);

        expect(g.distinctRawValues).toBe(5);
        expect(Object.keys(g.counts).length).toBe(3);
        expect(g.longTail).toBe(2);
    });

    it('AND THE KEY IGNORES ONLY MECHANICAL DIFFERENCES', () => {
        expect(groupingKey('  Farmer  ')).toBe(groupingKey('farmer'));
        expect(groupingKey('Civil  Servant')).toBe(groupingKey('civil servant'));
        expect(groupingKey('Farmer.')).toBe(groupingKey('Farmer'));
        //   Not the same answer:
        expect(groupingKey('Farmer')).not.toBe(groupingKey('Farmers'));
        expect(groupingKey('Trader')).not.toBe(groupingKey('Treder'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#841 — every module excludes not_started, proved per module', () => {
    /**
     *   The shared helper is the mechanism, but "they all call the shared
     *   helper" is the weakest assertion in this codebase's vocabulary. Each
     *   module is executed against a fixture holding the same not_started rows.
     */
    const MODULES = [
        { key: 'wave', reg: 'wave' },
        { key: 'academy', reg: 'academy' },
        { key: 'export', reg: 'export' },
        { key: 'cooperative', reg: 'cooperatives' },
        { key: 'farmNation', reg: 'farmNation' },
        { key: 'marketplace', reg: 'marketplace' },
    ] as const;

    it('A not_started ACCOUNT IS NOT AN APPLICANT, IN ANY MODULE', async () => {
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');

        for (const { key, reg } of MODULES) {
            store = installFakeDb({
                [COLLECTIONS.USERS]: {
                    'applied': { serviceRegistrations: { [reg]: { status: 'approved' } } },
                    'also-applied': { serviceRegistrations: { [reg]: { status: 'pending' } } },
                    //   The 16,997, in this module's spelling.
                    'never-began': { serviceRegistrations: { [reg]: { status: 'not_started' } } },
                },
            });

            const c = await countModuleApplicants(key);

            expect({ module: key, total: c.total, other: c.other })
                .toEqual({ module: key, total: 2, other: 0 });
        }
    });

    it('AND EVERY MODULE STATS SURFACE GOES THROUGH THAT HELPER', async () => {
        /*
         *   The other half: a module could be correct here and still report a
         *   different number on its own screen by counting its detail collection
         *   directly. Enumerated by SURFACE, so a rewrite of one cannot quietly
         *   go back.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const { stripComments } = require('@/lib/testing/strip-comments') as
            typeof import('@/lib/testing/strip-comments');

        const SURFACES = [
            'src/app/api/admin/wave/compliance/route.ts',
            'src/app/actions/academy/_ac_admin_applications.ts',
            'src/app/actions/admin/_exports.ts',
            'src/app/actions/farm-nation-admin/_fna_finance.ts',
            'src/app/actions/cooperative/_coop_admin_reports.ts',
        ];

        const missing = SURFACES.filter((rel) => !stripComments(
            readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel },
        ).includes('countModuleApplicants'));

        expect(missing).toEqual([]);
    });
});
