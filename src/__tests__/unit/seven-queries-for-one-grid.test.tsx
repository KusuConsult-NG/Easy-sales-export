/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "searchLandListingsAction firing seven times in one second."
 *
 * ── SEVEN, COUNTED ──────────────────────────────────────────────────────────
 *
 *   /farm-nation renders a "Farm Categories" grid of six `<Link>`s into
 *   /farm-nation/properties, plus a browse-all link to the same route. Next
 *   prefetches a Link when it enters the viewport, and that route is
 *   force-dynamic and ran searchLandListingsAction on every render.
 *
 *       6 tiles + 1 browse link = 7 prefetch targets
 *       = 7 identical listing queries in the second the grid appears,
 *         before the visitor clicks anything.
 *
 *   An N+1 in the MARKUP rather than in a query: each iteration of a `.map`
 *   costs a server round trip.
 *
 * ── AND SIX OF THEM WERE UNUSABLE TWICE OVER ────────────────────────────────
 *
 *   THE FILTER NEVER ARRIVED. The tiles linked with `?category=`, and the
 *   browse screen reads `?type`. Nothing read `?category`, so all six tiles
 *   opened the same unfiltered list.
 *
 *   THE VALUES MATCHED NOTHING. Arable Land, Leasing Options, Poultry Farms,
 *   Fish Farms, Greenhouses, Mixed-Use appear in no other file. Listings are
 *   stored as farmland, ranch, forest, mixed, orchard, aquaculture.
 *
 *   THE COUNTS MATCHED NOTHING EITHER, for the same reason, so every tile fell
 *   through to the word "Browse" — six figures that could not be right and were
 *   therefore never seen. The symptom of the defect was its own fallback.
 *
 *   AND THE SEED WAS DISCARDED. PropertiesClient consumes the server's seed
 *   only on an unfiltered first load, so once the links carry a real filter the
 *   query behind them is paid for and thrown away on arrival.
 *
 * ── AND A FIFTH COPY THAT DISAGREED ─────────────────────────────────────────
 *
 *   The vocabulary was hand-written in five files. edit-property offered
 *   `commercial_farm` and `agricultural_land`, which no other screen knows, and
 *   omitted four that the listing form writes. So a seller editing their own
 *   parcel could set a category that made it unfindable in both places a buyer
 *   looks — or silently lose the one they chose at listing time.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { join } from 'node:path';
import {
    LAND_CATEGORIES, LAND_CATEGORY_VALUES, LAND_CATEGORY_PARAM,
    landBrowseHref, landCategoryLabel, landCategoriesOf, isLandCategory,
} from '@/lib/land-categories';

const code = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
/*
 *   Comments stripped, for the assertions that say a spelling is GONE. Each of
 *   these files now carries a note naming the vocabulary it used to have, and
 *   an assertion satisfied by prose rather than by code is the failure this
 *   audit keeps writing down.
 */
const source = (rel: string) => stripComments(code(rel), { label: rel });

const LANDING = 'src/app/farm-nation/FarmNationLandingClient.tsx';
const BROWSE = 'src/app/farm-nation/properties/PropertiesClient.tsx';
const BROWSE_PAGE = 'src/app/farm-nation/properties/page.tsx';
const MAP = 'src/app/farm-nation/map/FarmNationMapClient.tsx';
const LIST_LAND = 'src/app/farm-nation/(member)/list-land/page.tsx';
const EDIT = 'src/app/farm-nation/(member)/edit-property/[id]/EditPropertyClient.tsx';

// ─────────────────────────────────────────────────────────────────────────────
//  THE QUERY THE PREFETCH USED TO PAY FOR
// ─────────────────────────────────────────────────────────────────────────────

const search = jest.fn() as jest.Mock<any>;
jest.mock('@/app/actions/land-listings', () => ({
    searchLandListingsAction: (...args: any[]) => search(...args),
}));
jest.mock('@/app/farm-nation/properties/PropertiesClient', () => ({
    __esModule: true,
    default: () => null,
}));

const renderBrowsePage = async (params: Record<string, string | string[] | undefined>) => {
    const { default: Page } = await import('@/app/farm-nation/properties/page');
    return (Page as any)({ searchParams: Promise.resolve(params) });
};

beforeEach(() => {
    jest.clearAllMocks();
    search.mockResolvedValue({ success: true, error: null, data: { listings: [], lastDocId: null } });
});

describe('what a prefetch of the browse route costs', () => {
    it('AN UNFILTERED PREFETCH STILL SEEDS — one query, and the client uses it', async () => {
        //   The positive control, and it comes first: a rule that skipped
        //   everything would satisfy every assertion below and leave the page
        //   fetching after hydration, which is the defect #543 removed.
        await renderBrowsePage({});

        expect(search).toHaveBeenCalledTimes(1);
        expect(search).toHaveBeenCalledWith({ limit: 12 });
    });

    it('A CATEGORY PREFETCH COSTS NOTHING', async () => {
        //   THE test. Six of the seven calls were this, and PropertiesClient
        //   could never have used any of them.
        await renderBrowsePage({ [LAND_CATEGORY_PARAM]: 'farmland' });

        expect(search).not.toHaveBeenCalled();
    });

    it('AND SO DOES A LOCATION OR LISTING-TYPE ONE', async () => {
        await renderBrowsePage({ location: 'Ondo' });
        await renderBrowsePage({ listingType: 'rent' });

        expect(search).not.toHaveBeenCalled();
    });

    it('AND AN EMPTY PARAMETER IS NOT A FILTER', async () => {
        //   `?type=` with nothing after it leaves the client's filter empty, so
        //   it WILL take the seed. Refusing to seed there would reintroduce the
        //   post-hydration fetch for anybody arriving on a cleared filter.
        await renderBrowsePage({ [LAND_CATEGORY_PARAM]: '', location: undefined });

        expect(search).toHaveBeenCalledTimes(1);
    });

    it('AND A REPEATED PARAMETER IS STILL A FILTER', async () => {
        //   `?type=a&type=b` arrives as an array. Reading it as a string would
        //   make it truthy by accident rather than on purpose; this pins that
        //   the array is inspected.
        await renderBrowsePage({ [LAND_CATEGORY_PARAM]: ['farmland', 'orchard'] });

        expect(search).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the tiles and the screen they open', () => {
    it('THE LINK CARRIES THE PARAMETER THE BROWSE SCREEN READS', () => {
        //   They were `?category=` and `?type`. One builder and one constant now.
        expect(landBrowseHref('farmland')).toBe(`/farm-nation/properties?${LAND_CATEGORY_PARAM}=farmland`);
        expect(landBrowseHref()).toBe('/farm-nation/properties');

        expect(code(BROWSE)).toContain('searchParams.get(LAND_CATEGORY_PARAM)');
        expect(code(LANDING)).toContain('landBrowseHref(category.value)');
        //   And the dead spelling is not still being written somewhere.
        expect(source(LANDING)).not.toContain('properties?category=');
    });

    it('AND THE VALUES ARE THE ONES LISTINGS ARE STORED WITH', () => {
        expect([...LAND_CATEGORY_VALUES].sort()).toEqual(
            ['aquaculture', 'farmland', 'forest', 'mixed', 'orchard', 'ranch'],
        );
        //   The six display names that matched nothing are gone from the page.
        for (const invented of ['Arable Land', 'Leasing Options', 'Poultry Farms', 'Fish Farms', 'Greenhouses']) {
            expect({ invented, present: source(LANDING).includes(invented) })
                .toEqual({ invented, present: false });
        }
    });

    it('AND THE COUNTS ARE KEYED ON THE STORED VALUE', () => {
        expect(code(LANDING)).toContain('categoryCounts[category.value]');
        //   The key that never matched: the display name, slugged.
        expect(source(LANDING)).not.toContain('replace(/\\s+/g, "_")');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and what a listing counts as', () => {
    it('AN ARRAY ROW COUNTS UNDER EVERY CATEGORY IT HOLDS', () => {
        //   The edit form writes an array. The old counter used the raw value as
        //   an object key, so this row counted under "farmland,orchard" — a
        //   bucket no tile reads — and under neither real category.
        expect(landCategoriesOf({ category: ['farmland', 'orchard' ] }))
            .toEqual(['farmland', 'orchard']);
    });

    it('AND A COMMA STRING AND A PLAIN STRING BOTH WORK', () => {
        expect(landCategoriesOf({ category: 'farmland, orchard' })).toEqual(['farmland', 'orchard']);
        expect(landCategoriesOf({ category: 'farmland' })).toEqual(['farmland']);
    });

    it('AND propertyType IS THE FALLBACK, as the old counter had it', () => {
        expect(landCategoriesOf({ propertyType: 'ranch' })).toEqual(['ranch']);
        expect(landCategoriesOf({})).toEqual([]);
        expect(landCategoriesOf(null)).toEqual([]);
    });

    it('AND NOTHING IS COUNTED TWICE', () => {
        expect(landCategoriesOf({ category: ['farmland', 'farmland', ' farmland '] })).toEqual(['farmland']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('one vocabulary, in the five files that had one each', () => {
    it('EVERY SCREEN READS THE SHARED LIST', () => {
        for (const rel of [LANDING, BROWSE, MAP, LIST_LAND, EDIT]) {
            expect({ rel, shared: code(rel).includes('@/lib/land-categories') })
                .toEqual({ rel, shared: true });
        }
    });

    it('AND NONE OF THEM STILL HAND-WRITES IT', () => {
        //   The shape all five shared: a literal array of {value,label,icon}.
        for (const rel of [LANDING, BROWSE, MAP, LIST_LAND, EDIT]) {
            expect({ rel, literal: /\{\s*value:\s*"farmland"/.test(source(rel)) })
                .toEqual({ rel, literal: false });
        }
    });

    it('AND THE EDIT FORM CAN NO LONGER WRITE A CATEGORY NOBODY SEARCHES', () => {
        /*
         *   `commercial_farm` was offered by the edit form and by nothing else,
         *   so choosing it dropped the parcel out of the browse filter and the
         *   map at once.
         */
        const src = source(EDIT);
        expect(src).not.toMatch(/value:\s*"commercial_farm"/);
        expect(src).not.toMatch(/value:\s*"agricultural_land"/);
        expect(isLandCategory('commercial_farm')).toBe(false);
    });

    it('AND A ROW THAT ALREADY CARRIES ONE STILL READS AS WORDS', () => {
        //   Nothing stored is changed or destroyed. A retired value must not
        //   start rendering as a raw slug on the screens that show it.
        expect(landCategoryLabel('commercial_farm')).toBe('Commercial Farm');
        expect(landCategoryLabel('agricultural_land')).toBe('Agricultural Land');
        expect(landCategoryLabel('farmland')).toBe('Farmland');
        //   And something genuinely unrecognised says what it is, rather than
        //   being quietly relabelled to a category it is not.
        expect(landCategoryLabel('sorghum_plot')).toBe('sorghum_plot');
        expect(landCategoryLabel(undefined)).toBe('');
    });

    it('AND THE LISTING FORM KEEPS ITS LONGER NAMES', () => {
        //   It is where somebody chooses for the first time, so it explains.
        //   One list, two label lengths, rather than two lists.
        expect(LAND_CATEGORIES.find((c) => c.value === 'ranch')?.detail)
            .toBe('Ranch/Pasture (Livestock)');
        expect(code(LIST_LAND)).toContain('category.detail');
    });

    it('AND THE BROWSE PAGE NAMES ITS FILTER PARAMS FROM THE SHARED CONSTANT', () => {
        expect(code(BROWSE_PAGE)).toContain('LAND_CATEGORY_PARAM');
    });
});
