/**
 * @jest-environment node
 */

/**
 *   #897 TWO CREATORS WROTE THE LEASE TERM TWO WAYS, AND THE SCREEN READ ONE.
 *
 *   Found while applying #895, and it is that finding's own defect class caught
 *   one commit later: a correct rule applied to some of the places it names.
 *
 *       land-listings.ts   submitLandListingAction writes `durationValue` +
 *                          `durationUnit`. The door the listing FORM uses.
 *       _fn_listings.ts    listPropertyAction writes `leaseDuration`, declared
 *                          by its own type as MONTHS — and nothing else.
 *
 *   Both write LAND_LISTINGS. PropertyDetailsClient read `durationValue` alone,
 *   so a lease created through the second door showed NO TERM AT ALL — which is
 *   #861 verbatim, on rows written after #861 was fixed: "A listing offered for
 *   rent with no term tells a buyer nothing about what she is being offered."
 *
 *   And #895's minimum went on the first door only, so a one-month lease was
 *   still creatable through the second.
 *
 * ── WHAT IS LIVE AND WHAT IS LATENT, SAID PLAINLY ───────────────────────────
 *
 *   `listPropertyAction` is RETIRED behind `LEGACY_FARM_NATION_LISTING`
 *   (#432), so the WRITE half of this — the shared minimum, and writing the
 *   canonical pair — only matters if that flag is ever set again. It is fixed
 *   anyway, because a retired door that can be revived by an environment
 *   variable is exactly where a rule goes missing.
 *
 *   The READ half is NOT latent. Rows written by that door before it was
 *   retired are in the database now, and their term was invisible on the
 *   property page. That is what readLeaseTerm fixes today.
 *
 *   NOTHING IS REWRITTEN AND NOTHING IS DROPPED. `leaseDuration` is still
 *   written exactly as before; the canonical pair is written BESIDE it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { readLeaseTerm, leaseTermRefusal } from '@/lib/lease-term';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#897 — one reader for both vocabularies', () => {
    it('THE CANONICAL PAIR IS READ', () => {
        expect(readLeaseTerm({ durationValue: 2, durationUnit: 'years' }))
            .toEqual({ value: 2, unit: 'years' });
        expect(readLeaseTerm({ durationValue: 18, durationUnit: 'months' }))
            .toEqual({ value: 18, unit: 'months' });
    });

    it('THE REPORTED CASE: a row written as `leaseDuration` is read too', () => {
        /*
         *   Months, because that is what types/farm-nation-actions declares it
         *   as — "months, if type is lease" — rather than a guess.
         */
        expect(readLeaseTerm({ leaseDuration: 24 }))
            .toEqual({ value: 24, unit: 'months' });
    });

    it('AND THE CANONICAL PAIR WINS when a row somehow carries both', () => {
        //   A row written by the new code path carries both. The pair is what
        //   the form collected, so it is the answer.
        expect(readLeaseTerm({ durationValue: 3, durationUnit: 'years', leaseDuration: 6 }))
            .toEqual({ value: 3, unit: 'years' });
    });

    it('AND A SALE CARRIES NO TERM — the control', () => {
        /*
         *   #861 omits the field entirely on a permanent purchase. Inventing a
         *   term here would put "Term: 0 years" on every sale listing.
         */
        for (const row of [{}, null, undefined, { durationValue: 0 }, { leaseDuration: 0 }, { durationValue: 'x' }]) {
            expect({ row, term: readLeaseTerm(row as any) }).toEqual({ row, term: null });
        }
    });

    it('AND THE PROPERTY PAGE USES IT', () => {
        const src = code('src/app/farm-nation/property/[id]/PropertyDetailsClient.tsx');

        expect(src).toContain('readLeaseTerm(');
        //   And no longer reads one vocabulary by hand.
        expect(src).not.toContain('typeof property.durationValue === "number"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#897 — and the second creator obeys the same minimum', () => {
    it('THE RULE REACHES BOTH DOORS — #895 had gone on one', () => {
        for (const rel of [
            'src/app/actions/land-listings.ts',
            'src/app/actions/farm-nation/_fn_listings.ts',
        ]) {
            expect({ rel, guarded: code(rel).includes('leaseTermRefusal({') })
                .toEqual({ rel, guarded: true });
        }
    });

    it('AND IT READS leaseDuration AS MONTHS, not through the stored default', () => {
        /*
         *   The stored default is YEARS (land-listings writes `?? "years"`), so
         *   passing a months figure without saying so would read 6 months as six
         *   YEARS and admit exactly what the rule refuses.
         */
        const src = code('src/app/actions/farm-nation/_fn_listings.ts');
        const at = src.indexOf('leaseTermRefusal({');

        expect(src.slice(at, at + 260)).toContain('durationUnit: "months"');
        //   And the behaviour, not just the argument.
        expect(leaseTermRefusal({ offersLease: true, durationValue: 6, durationUnit: 'months' }))
            .not.toBeNull();
        expect(leaseTermRefusal({ offersLease: true, durationValue: 12, durationUnit: 'months' }))
            .toBeNull();
    });

    it('AND THE RETIREMENT CHECK STILL COMES FIRST', () => {
        /*
         *   #432 retired this door because it accepts no land title or survey
         *   plan. A new guard placed above that would start doing work for a
         *   door that must refuse before it does any.
         */
        const src = code('src/app/actions/farm-nation/_fn_listings.ts');

        expect(src.indexOf('legacyFarmNationListingEnabled()'))
            .toBeLessThan(src.indexOf('leaseTermRefusal({'));
    });

    it('AND leaseDuration IS STILL WRITTEN — nothing is dropped', () => {
        /*
         *   The standing instruction on this audit is that nothing is destroyed.
         *   The canonical pair is written BESIDE the old field, not instead of
         *   it, so any reader of `leaseDuration` keeps working.
         */
        const src = code('src/app/actions/farm-nation/_fn_listings.ts');

        expect(src).toContain('leaseDuration: validatedData.leaseDuration || null');
        expect(src).toContain('durationUnit: "months" as const');
    });
});
