/**
 * @jest-environment jsdom
 */

/**
 *   #901 THE ADMIN LAND QUEUE COULD NOT DRAW A SINGLE ROW, AND THE PUBLIC MAP
 *   COULD NOT PLOT A SINGLE PIN.
 *
 *   Found auditing the files no test had named. Both failures are the same
 *   defect, and it is this audit's most repeated one: a reader asking for a
 *   spelling no writer uses. What makes this pair worth its own suite is that
 *   the spellings are not near-misses of a stored value — the fields are
 *   written by NOTHING:
 *
 *     `soilQuality`      written only by createLandListing in land-actions.ts,
 *                        which HAS NO CALLER anywhere in the application.
 *     `location.lat`     written only by that same dead function. Every live
 *                        writer stores `location: { state, lga, address }` and
 *                        puts coordinates in `gpsCoordinates` — which is what
 *                        lib/land-location was written for (#689).
 *
 *   And both were read WITHOUT A GUARD, inside a `.map`:
 *
 *     land/verify:270        {listing.soilQuality.toUpperCase()}
 *     land/verify:284        {listing.location.lat.toFixed(4)}
 *     LandMap.tsx:179        {listing.soilQuality.toUpperCase()} Soil
 *     LandMap.tsx:142        position={[listing.location.lat, listing.location.lng]}
 *     LandMap.tsx:40         listings.map(l => [l.location.lat, l.location.lng])
 *
 *   So the admin land verification queue threw during render for every listing
 *   awaiting a decision, and the public land map threw before a tile was drawn.
 *   #689 predicted the first in as many words — "the ADMIN REVIEW QUEUE reads
 *   this ... so one listing created through it stops every listing from being
 *   reviewable" — and repaired the ACTION. #598 found the second in the file
 *   NEXT DOOR to the map component — "every one of these was read off the row
 *   inside a `.map`, so a listing with no `location` took the WHOLE MAP down" —
 *   and guarded the grid without entering the map.
 *
 * ── AND A THIRD SPELLING, WHICH COST A BUYER A WHOLE CROP ───────────────────
 *
 *   CROP_SOIL_MATRIX asked for "clayey". Nothing on this platform writes that
 *   word: the form offers "Clay", the enum says 'clay'. So
 *
 *       sugarcane    ["clayey"]            — matched NO listing, ever
 *       rice         ["clayey", "loamy"]   — every clay parcel dropped
 *       maize        ["loamy", "clayey"]   — same
 *       wheat        ["clayey", "loamy"]   — same
 *
 *   One vocabulary now, in lib/land-soil.ts, beside the matrix that reads it.
 *
 * ── WHAT IS BEHAVIOUR HERE AND WHAT IS A SOURCE PIN ─────────────────────────
 *
 *   Said plainly, because a suite that blurs the two is how #867's all-source
 *   #867 suite passed while the chain it described had never run.
 *
 *     BEHAVIOURAL   lib/land-soil in full; the /land/verify page RENDERED
 *                   against the row shape submitLandListingAction writes.
 *     A SOURCE PIN  components/land/LandMap — react-leaflet is not rendered
 *                   anywhere in this suite and mocking the whole of it would
 *                   test the mock. So the three unguarded expressions are
 *                   pinned as ABSENT from the stripped source, and the row
 *                   shape they choked on is asserted behaviourally through
 *                   readLandLocation, which is the reader they now use.
 */

import React from 'react';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { stripComments } from '@/lib/testing/strip-comments';
import { readLandLocation } from '@/lib/land-location';
import { SoilQuality } from '@/types/strict';
import {
    SOIL_TYPES, WATER_SOURCES, soilKey, waterKey, readSoil, readWaterSource,
    CROP_SOIL_MATRIX, soilsForCrop, soilSuitsCrop,
} from '@/lib/land-soil';

const code = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'));

/**
 * The row `submitLandListingAction` actually writes — copied field for field
 * from its `const listing: any = { ... }`, not invented. This is the fixture
 * the whole suite turns on: if it drifts from the writer the assertions below
 * stop meaning anything, so `owner-land-writes-agree` and the pin at the end
 * of this file both watch the writer.
 */
const AS_WRITTEN = {
    ownerId: 'user_1',
    ownerName: 'Ada',
    ownerEmail: 'ada@example.com',
    title: 'Two hectares at Vom',
    description: 'Clay soil, borehole on site.',
    location: { state: 'Plateau', lga: 'Jos South', address: 'Vom, by the college' },
    size: 2,
    price: 5_000_000,
    soilType: 'Clay',
    waterSource: 'Borehole',
    images: ['https://example.com/a.jpg'],
    documents: [],
    status: 'pending_verification',
    availableForSale: true,
    availableForRent: false,
    availableForLease: false,
    type: 'sale',
    escrowAvailable: true,
};

describe('the soil field nobody wrote, and the two screens that read it', () => {
    it('THE FIXTURE IS THE SHAPE THE LIVE WRITER PRODUCES (control)', () => {
        //   THE control, first: every claim below is about a row, and a row
        //   that already carried `soilQuality` or `location.lat` would agree
        //   with the old code and the new alike.
        expect('soilQuality' in AS_WRITTEN).toBe(false);
        expect('lat' in AS_WRITTEN.location).toBe(false);
        expect('lng' in AS_WRITTEN.location).toBe(false);
        expect(AS_WRITTEN.soilType).toBe('Clay');
    });

    it('AND THE OLD EXPRESSIONS THROW ON IT — the defect, reproduced', () => {
        //   Not rhetoric. The two expressions the screens contained, evaluated
        //   against the row above.
        expect(() => (AS_WRITTEN as any).soilQuality.toUpperCase()).toThrow(TypeError);

        const normalised = readLandLocation(AS_WRITTEN);
        expect(normalised.lat).toBeNull();
        expect(() => (normalised.lat as any).toFixed(4)).toThrow(TypeError);
    });

    describe('readSoil — the row, not one field name', () => {
        it('READS THE soilType EVERY LIVE WRITER SETS', () => {
            expect(readSoil(AS_WRITTEN)).toBe('Clay');
        });

        it('AND soilQuality AS A SECOND SPELLING, so the dead writer\'s rows are not blank', () => {
            expect(readSoil({ soilQuality: 'loamy' })).toBe('loamy');
        });

        it('AND soilType WINS when a row somehow carries both', () => {
            expect(readSoil({ soilType: 'Sandy', soilQuality: 'loamy' })).toBe('Sandy');
        });

        it('AND NULL IS NULL — blank, whitespace, a number, no row at all', () => {
            for (const row of [null, undefined, {}, { soilType: '' }, { soilType: '   ' }, { soilType: 7 }]) {
                expect(readSoil(row as any)).toBeNull();
            }
        });

        it('AND THE WATER SOURCE THE SAME WAY', () => {
            expect(readWaterSource(AS_WRITTEN)).toBe('Borehole');
            expect(readWaterSource({ waterSource: '  ' })).toBeNull();
            expect(readWaterSource(null)).toBeNull();
        });
    });

    describe('soilKey — the three vocabularies folded to one', () => {
        it('FOLDS "clayey" TO "clay", which is the whole finding', () => {
            expect(soilKey('clayey')).toBe('clay');
            expect(soilKey('Clay')).toBe('clay');
            expect(soilKey('CLAYEY')).toBe('clay');
            //   The three spellings of one answer now compare equal.
            expect(soilKey('Clay')).toBe(soilKey('clayey'));
        });

        it('AND LEAVES EVERY OTHER SOIL ALONE but for case and padding', () => {
            expect(soilKey('  Loamy ')).toBe('loamy');
            expect(soilKey('Sandy')).toBe('sandy');
            expect(soilKey('Chalky')).toBe('chalky');
            //   NOT a general synonym engine: "sandy" and "loamy" stay distinct.
            expect(soilKey('Sandy')).not.toBe(soilKey('Loamy'));
        });

        it('AND ANSWERS "" FOR A NON-SOIL, so a caller needs no second guard', () => {
            for (const v of [null, undefined, '', '   ', 42, {}, []]) {
                expect(soilKey(v)).toBe('');
            }
        });

        it('AND waterKey FOLDS "Rain-fed" ONTO THE SCHEMA\'S "rain"', () => {
            expect(waterKey('Rain-fed')).toBe('rain');
            expect(waterKey('rainfed')).toBe('rain');
            expect(waterKey('rain')).toBe('rain');
            expect(waterKey('Borehole')).toBe('borehole');
            expect(waterKey(null)).toBe('');
        });
    });

    describe('the crop matrix, against the soil the platform stores', () => {
        it('SUGARCANE NOW MATCHES A CLAY PARCEL — it previously matched nothing at all', () => {
            expect(soilSuitsCrop(AS_WRITTEN, 'sugarcane')).toBe(true);
        });

        it('AND SO DO THE THREE THAT WERE RETURNING HALF AN ANSWER', () => {
            for (const crop of ['rice', 'maize', 'wheat']) {
                expect({ crop, matches: soilSuitsCrop(AS_WRITTEN, crop) })
                    .toEqual({ crop, matches: true });
            }
        });

        it('AND NO CROP ASKS FOR A SOIL THE FORM CANNOT OFFER — LITERALLY, not through the fold', () => {
            /*
             *   MEASURED, AND THE MUTATION LOG SAYS WHY THIS COMPARES RAW
             *   STRINGS.
             *
             *   Written first with `soilKey` on both sides, and reverting the
             *   matrix to "clayey" left all twenty-six tests GREEN — because the
             *   fold makes the table's spelling invisible to every behavioural
             *   assertion here. That is a true fact about the fix (the fold is
             *   what repairs stored rows, and it would rescue a "clayey" in the
             *   table too), and it is also exactly how a vacuous assertion
             *   looks: it agreed with the defect.
             *
             *   So the table is pinned to the vocabulary WITHOUT normalising it.
             *   The fold is the safety net; this is the guard against the net
             *   quietly becoming the only thing holding the table up.
             */
            const offered = new Set([...SOIL_TYPES].map((s) => s.toLowerCase()));
            const asked = new Set(Object.values(CROP_SOIL_MATRIX).flat());

            expect(asked.size).toBeGreaterThan(0);
            expect(offered.size).toBe(6);
            expect([...asked].filter((s) => !offered.has(s))).toEqual([]);

            //   And the word itself, named, because it is the whole finding.
            expect([...asked]).toContain('clay');
            expect([...asked]).not.toContain('clayey');
        });

        it('AND THE MATRIX IS STILL DISCRIMINATING — a sandy parcel is not sugarcane land', () => {
            //   The vacuity guard. A fold that made everything match everything
            //   would pass every assertion above.
            expect(soilSuitsCrop({ soilType: 'Sandy' }, 'sugarcane')).toBe(false);
            expect(soilSuitsCrop({ soilType: 'Clay' }, 'coconut')).toBe(false);
            expect(soilSuitsCrop({ soilType: 'Sandy' }, 'coconut')).toBe(true);
        });

        it('AND A PARCEL WITH NO RECORDED SOIL IS NOT CLAIMED AS SUITABLE', () => {
            //   Deliberately unchanged from `if (!l.soilType) return false`. The
            //   platform must not tell a buyer a parcel suits her crop when
            //   nobody said what its soil is.
            expect(soilSuitsCrop({}, 'rice')).toBe(false);
            expect(soilSuitsCrop(null, 'rice')).toBe(false);
        });

        it('AND AN UNKNOWN CROP FALLS THROUGH rather than matching everything', () => {
            expect(soilsForCrop('dragonfruit')).toEqual([]);
            expect(soilSuitsCrop(AS_WRITTEN, 'dragonfruit')).toBe(false);
            expect(soilSuitsCrop(AS_WRITTEN, '')).toBe(false);
            expect(soilSuitsCrop(AS_WRITTEN, null)).toBe(false);
        });

        it('AND soilsForCrop HANDS BACK A COPY, not the table', () => {
            const first = soilsForCrop('rice');
            first.push('granite');
            expect(soilsForCrop('rice')).not.toContain('granite');
        });
    });

    it('WATER_SOURCES AND SOIL_TYPES ARE THE LISTS THE FORM SHOWS', () => {
        //   Promoted, not redesigned — every stored value came from these.
        expect([...SOIL_TYPES]).toEqual(['Loamy', 'Clay', 'Sandy', 'Silty', 'Peaty', 'Chalky']);
        expect([...WATER_SOURCES])
            .toEqual(['Borehole', 'River', 'Stream', 'Well', 'Dam', 'Rain-fed', 'None']);
    });
});

/*
 *   THE ADMIN QUEUE, RENDERED. The half of this finding that is behaviour
 *   rather than a source assertion, and the reason the suite is .tsx.
 */
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));

const getLandListings = jest.fn() as jest.Mock<any>;
jest.mock('@/app/actions/land-actions', () => ({
    getLandListings: (...args: any[]) => (getLandListings as any)(...args),
    verifyLandListing: jest.fn(),
}));

/*
 *   `require`, not a static import: ES imports hoist above `jest.mock`, so a
 *   statically imported page binds the real ToastContext and throws
 *   "useToast must be used within ToastProvider" before a single assertion
 *   runs. The house pattern — see a-queue-the-admin-could-not-open.
 */
const LandVerificationPage = require('@/app/land/verify/page').default;

describe('/land/verify — the queue an admin works', () => {
    beforeEach(() => {
        getLandListings.mockReset();
    });

    it('DRAWS A ROW WRITTEN BY THE LIVE DOOR', async () => {
        //   Shaped the way the action hands it over: `location` normalised
        //   through readLandLocation, which is where `lat: null` comes from.
        getLandListings.mockResolvedValue({
            success: true,
            error: null,
            data: [{
                ...AS_WRITTEN,
                id: 'land_1',
                location: readLandLocation(AS_WRITTEN),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                verifiedAt: null,
            }],
        });

        render(<LandVerificationPage />);

        //   The listing's own title — this is what threw before.
        expect(await screen.findByText('Two hectares at Vom')).toBeTruthy();

        //   The soil it DID record, which the old code could not have shown
        //   even if it had not thrown: it read a different field.
        expect(screen.getByText('CLAY')).toBeTruthy();

        //   And the two facts the row genuinely lacks, said rather than crashed.
        expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);

        //   The address, built from the parts that exist — no leading comma
        //   from the `city` this row has never had.
        const where = screen.getByText(/Vom, by the college/);
        expect(where.textContent?.startsWith(',')).toBe(false);
    });

    it('AND STILL TELLS A FAILED READ APART FROM AN EMPTY QUEUE (#408 kept)', async () => {
        getLandListings.mockResolvedValue({ success: false, error: 'connection reset', data: null });

        render(<LandVerificationPage />);

        expect(await screen.findByText(/connection reset/)).toBeTruthy();
        expect(screen.queryByText(/All Caught Up/i)).toBeNull();
    });
});

describe('the map component — pinned, because react-leaflet is not rendered here', () => {
    it('NO LONGER CONTAINS THE THREE EXPRESSIONS THAT THREW', () => {
        const map = code('src/components/land/LandMap.tsx');

        expect(map).not.toContain('listing.soilQuality.toUpperCase()');
        expect(map).not.toContain('[listing.location.lat, listing.location.lng]');
        expect(map).not.toContain('[listing.location.lat');
    });

    it('AND READS BOTH ANSWERS THROUGH THE SHARED READERS', () => {
        const map = code('src/components/land/LandMap.tsx');

        expect(map).toContain('readLandLocation');
        expect(map).toContain('readSoil');
        //   The skip, not a plot at (0, 0) off the coast of Ghana.
        expect(map).toContain('where.lat === null');
    });

    it('AND THE COLOUR LOOKUP IS KEYED THE WAY THE TABLE IS', () => {
        /*
         *   The colour tables in both screens are keyed on SoilQuality's values,
         *   which are LOWER CASE — and the form writes "Clay". So a chip built
         *   from the stored value fell through to grey for every soil. Cosmetic
         *   rather than fatal, and found by reading the fix rather than by the
         *   suite, which is why it is asserted here.
         */
        expect(SoilQuality.CLAY).toBe('clay');
        expect(soilKey('Clay')).toBe(SoilQuality.CLAY);

        for (const rel of ['src/components/land/LandMap.tsx', 'src/app/land/verify/page.tsx']) {
            const src = code(rel);
            expect({ rel, keyed: src.includes('getSoilQualityColor(soilKey(') })
                .toEqual({ rel, keyed: true });
        }
    });

    it('AND SO DOES THE QUEUE AND THE GRID BESIDE THE MAP', () => {
        for (const rel of ['src/app/land/verify/page.tsx', 'src/app/land/LandMapClient.tsx']) {
            const src = code(rel);
            expect({ rel, unguarded: src.includes('.soilQuality.toUpperCase()') })
                .toEqual({ rel, unguarded: false });
            expect({ rel, shared: src.includes('readSoil') })
                .toEqual({ rel, shared: true });
        }
    });

    it('AND THE CROP FILTER NO LONGER KEEPS ITS OWN TABLE', () => {
        const actions = code('src/app/actions/land-listings.ts');

        //   The matrix and the vocabulary it looks up are one module now.
        expect(actions).not.toContain('CROP_SOIL_MATRIX: Record<string, string[]>');
        expect(actions).not.toContain('clayey');
        expect(actions).toContain('soilSuitsCrop');
    });

    it('AND NO FILE STILL ASKS FOR "clayey"', () => {
        //   The word existed in exactly one object literal in the repository.
        //   If it comes back, it comes back as a fourth vocabulary.
        //   lib/land-soil is the ONE file that may know the word — it is where
        //   the fold lives. Everything else asking for it is the defect back.
        for (const rel of [
            'src/app/actions/land-listings.ts',
            'src/app/actions/land-actions.ts',
            'src/app/land/verify/page.tsx',
            'src/components/land/LandMap.tsx',
        ]) {
            expect({ rel, clayey: code(rel).includes('clayey') })
                .toEqual({ rel, clayey: false });
        }
    });
});

/*
 *   THE SECOND HALF OF #901: the door that uploaded her deeds and then
 *   refused her. See app/land/submit/page.tsx for the full measurement.
 */
describe('/land/submit — the door that could not succeed', () => {
    const SUBMIT = 'src/app/land/submit/page.tsx';
    const LIST_LAND = 'src/app/farm-nation/(member)/list-land/page.tsx';

    it('NO LONGER WRITES A LISTING, AND NO LONGER UPLOADS ANYTHING', () => {
        const page = code(SUBMIT);

        //   The three things that made it harmful, in order: it collected
        //   files, it put them in storage, and it then called an action that
        //   refuses most of the people who got that far.
        expect(page).not.toContain('submitLandListingAction');
        expect(page).not.toContain('uploadFile');
        expect(page).not.toContain('useStorage');
        expect(page).not.toContain('type="file"');
    });

    it('AND SENDS HER TO THE FORM THAT GATES BEFORE SHE TYPES', () => {
        const page = code(SUBMIT);

        expect(page).toContain('redirect');
        expect(page).toContain('/farm-nation/list-land');
    });

    it('AND THAT FORM STILL EXISTS AND IS STILL THE ONE WITH THE RULES', () => {
        //   Vacuity guard: a redirect to a route that had itself been removed
        //   would pass every assertion above and take the capability with it.
        const form = code(LIST_LAND);

        expect(form).toContain('submitLandListingAction');
        //   The four rules that reached this door and not the other one.
        expect(form).toContain('leaseTermRefusal');
        expect(form).toContain('rentPrice');
        expect(form).toContain('durationValue');
        expect(form).toContain('gpsCoordinates');
        expect(form).toContain('manageLink');
    });

    it('AND THE TWO FIELDS ONLY THE RETIRED DOOR COLLECTED ARE ON IT NOW', () => {
        /*
         *   THE test for this half. /land/submit was the only form on the
         *   platform that asked for soil or water, and four readers want them —
         *   the property page, the properties grid, and two filters on
         *   searchLandListingsAction, one of which (crop suitability) is built
         *   entirely on the soil and drops any parcel that has none.
         *
         *   Retiring the door without moving these would have meant no listing
         *   made from today could ever match a crop search.
         */
        const form = code(LIST_LAND);

        expect(form).toContain('SOIL_TYPES');
        expect(form).toContain('WATER_SOURCES');
        //   Collected...
        expect(form).toContain('soilType: ""');
        expect(form).toContain('waterSource: ""');
        //   ...and actually sent, which is the half a select alone does not do.
        expect(form).toContain('{ soilType: formData.soilType }');
        expect(form).toContain('{ waterSource: formData.waterSource }');
    });

    it('AND THE ACTION STILL ACCEPTS THEM, so the selects are not writing into a void', () => {
        const action = code('src/app/actions/land-listings.ts');

        expect(action).toContain('if (data.soilType !== undefined) listing.soilType = data.soilType;');
        expect(action).toContain('if (data.waterSource !== undefined) listing.waterSource = data.waterSource;');
    });
});

/*
 *   AND THE SCHEMA THE EDIT DOOR PARSES, which held both traps at once.
 */
describe('landListingSchema — the field name and the spelling', () => {
    const { landListingSchema } = require('@/lib/validations/land');

    const MINIMUM = {
        title: 'Two hectares at Vom, Plateau',
        description: 'Clay soil with a borehole on site, fenced.',
        location: { lat: 9.7, lng: 8.77, address: 'Vom, by the college', city: 'Vom', state: 'Plateau' },
        price: 5_000_000,
        size: 2,
        features: [],
        images: ['https://example.com/a.jpg'],
    };

    it('THE FIXTURE PARSES ON ITS OWN (control)', () => {
        expect(landListingSchema.safeParse(MINIMUM).success).toBe(true);
    });

    it('KEEPS soilType RATHER THAN STRIPPING IT', () => {
        //   Zod strips what it does not name. This schema named `soilQuality`
        //   and every live writer sets `soilType`, so the field four screens
        //   read could not survive a parse.
        const parsed = landListingSchema.safeParse({ ...MINIMUM, soilType: 'Clay' });
        expect(parsed.success).toBe(true);
        expect(parsed.data.soilType).toBe('Clay');
    });

    it('AND ACCEPTS THE WATER SOURCES THE FORM ACTUALLY OFFERS', () => {
        for (const source of WATER_SOURCES) {
            const parsed = landListingSchema.safeParse({ ...MINIMUM, waterSource: source });
            expect({ source, ok: parsed.success }).toEqual({ source, ok: true });
        }
    });

    it('AND THE FIVE LOWER-CASE SPELLINGS ROWS ALREADY CARRY', () => {
        for (const source of ['borehole', 'river', 'rain', 'dam', 'none']) {
            const parsed = landListingSchema.safeParse({ ...MINIMUM, waterSource: source });
            expect({ source, ok: parsed.success }).toEqual({ source, ok: true });
        }
    });

    it('AND STILL REFUSES A WATER SOURCE THAT IS NOT ONE', () => {
        //   The vacuity guard: widening to `z.string()` would pass everything
        //   above and check nothing.
        for (const source of ['swimming pool', 'x', 'bore hole']) {
            const parsed = landListingSchema.safeParse({ ...MINIMUM, waterSource: source });
            expect({ source, ok: parsed.success }).toEqual({ source, ok: false });
        }
    });
});
