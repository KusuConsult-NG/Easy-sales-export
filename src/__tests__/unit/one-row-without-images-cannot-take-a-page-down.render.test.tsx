/**
 *   #439 ONE LAND LISTING WITH NO `images` KEY TOOK THE WHOLE PUBLIC PROPERTY
 *   CATALOGUE DOWN.
 *
 *   FOUND BY RUNNING THE BROWSER SUITE, NOT BY READING. The full Playwright run
 *   against the local stack was 359 passed, 1 failed, and the one failure was
 *   "User can browse properties". The interesting part is not that it failed —
 *   it is WHAT Playwright captured at the moment of failure:
 *
 *       heading "Something went wrong!"
 *       paragraph: We encountered an unexpected error while loading Farm Nation.
 *
 *   That is the Farm Nation error boundary, NOT the page's own "No properties
 *   found" empty state. So this was never a missing-fixture problem, which is
 *   what an eye passing over "element not found" would reasonably assume.
 *
 *   THE ROW, AND THE LINE. /farm-nation/properties rendered
 *
 *       <Image src={property.images[0] || "/placeholder-land.jpg"} ... />
 *
 *   and the local database held three `verified` listings, one of which carries
 *   no `images` key at all:
 *
 *       e2e-listing-1                           verified   images []
 *       e2e-listing-2                           verified   images []
 *       80785f53-165c-…  "Verified Land"        verified   NO images KEY
 *
 *   `undefined[0]` throws. The throw is inside the .map() building the grid, so
 *   React unwinds the entire route. One malformed row, every visitor, whole page
 *   — #130 is this same sentence about the marketplace catalogue.
 *
 *   ELEVEN OF FIFTEEN SITES ALREADY GUARDED IT. That is the shape this audit has
 *   now met nine times (#425, #426, #429–#434, #438): a rule written by hand in
 *   every reader, and a fix that reaches most of them. Worse, the eleven did not
 *   guard the SAME thing — five also check the value starts with http:// or
 *   https://, because `next/image` throws on a src that is neither an absolute
 *   URL nor a leading-slash path. So six of the "guarded" sites were still open
 *   to a bare storage key crashing the page in exactly the way a missing array
 *   does. lib/first-image.ts states both halves once.
 *
 *   WHAT THIS SUITE PROVES. It mounts the real page with the real three rows and
 *   requires the grid to render. Against the pre-fix line it does not merely
 *   fail an assertion — it throws, which is the defect itself.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     firstImageSrc stops checking Array.isArray          KILLED
 *     firstImageSrc stops checking the URL scheme         KILLED
 *     the page goes back to property.images[0]            KILLED
 *     the ratchet's own file list is emptied              KILLED
 *     reword the header prose                             SURVIVED, as intended
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';
import { firstImageSrc, firstImageSrcOr, imageSrcOr } from '@/lib/first-image';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/**
 * The page debounces 500ms before its first load, and this suite mounts the
 * real component. Under the full run — 543 suites in parallel, with coverage
 * instrumentation — the default 5s budget is not enough, and the suite failed
 * intermittently on a TIMEOUT rather than on any assertion. Raised so a failure
 * here means the grid did not render, which is the thing being tested.
 */
jest.setTimeout(30000);

const mockSearch = jest.fn();

jest.mock('@/app/actions/land-listings', () => ({
    searchLandListingsAction: (...a: any[]) => mockSearch(...a),
}));

jest.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(''),
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

/**
 * The three `verified` rows the local database actually held when the browser
 * suite failed, copied rather than invented. The third is the one that did it.
 */
const ROWS_AS_STORED = [
    { id: 'e2e-listing-1', title: 'E2E Farmland Plot 1', status: 'verified', price: 1_000_000, size: 2, images: [], category: 'farmland' },
    { id: 'e2e-listing-2', title: 'E2E Farmland Plot 2', status: 'verified', price: 2_000_000, size: 3, images: [], category: 'farmland' },
    // No `images` key, and no `category` key. Exactly as stored.
    { id: '80785f53-25c0-4b44-88e8-2c9b878f8051', title: 'Verified Land', status: 'verified', price: 3_000_000, size: 4 },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#439 — the rule for showing a record\'s picture', () => {
    it('RETURNS NULL FOR A MISSING ARRAY RATHER THAN THROWING — the defect itself', () => {
        const stored: any = { title: 'Verified Land' };
        // The pre-fix expression, spelled out so the difference is visible.
        expect(() => stored.images[0]).toThrow(TypeError);
        expect(firstImageSrc(stored.images)).toBeNull();
    });

    it.each([
        ['key absent', undefined],
        ['null', null],
        ['a string where an array belongs', 'https://cdn.example/x.jpg'],
        ['an empty array', []],
        ['an array of empty strings', ['', '   ']],
        ['an array of nulls', [null, undefined]],
        ['a bare storage key next/image would throw on', ['land/abc123.jpg']],
        ['a relative path next/image would throw on', ['../x.jpg']],
        // #262's rule, on an image src: this starts with a slash and fetches
        // from a host somebody else controls. The existing open-redirect
        // ratchet failed on my first version of the helper for exactly this,
        // and was right.
        ['a protocol-relative URL to a third-party host', ['//evil.example/x.jpg']],
    ])('and null for %s', (_label, value) => {
        expect(firstImageSrc(value)).toBeNull();
    });

    it.each([
        ['an https URL', ['https://cdn.example/x.jpg'], 'https://cdn.example/x.jpg'],
        ['an http URL', ['http://cdn.example/x.jpg'], 'http://cdn.example/x.jpg'],
        ['a root-relative path', ['/placeholder-land.jpg'], '/placeholder-land.jpg'],
        ['surrounding whitespace trimmed', ['  /a.jpg  '], '/a.jpg'],
    ])('and the value for %s', (_label, value, expected) => {
        expect(firstImageSrc(value)).toBe(expected);
    });

    it('and SKIPS an unusable entry rather than stopping at index 0', () => {
        // Indexing [0] showed a gap for this row. There is a picture; it is
        // second.
        expect(firstImageSrc(['land/bare-key.jpg', 'https://cdn.example/real.jpg']))
            .toBe('https://cdn.example/real.jpg');
    });

    it('and the fallback forms answer the same question', () => {
        expect(firstImageSrcOr(undefined, '/placeholder-land.jpg')).toBe('/placeholder-land.jpg');
        expect(firstImageSrcOr(['https://cdn.example/x.jpg'], '/p.jpg')).toBe('https://cdn.example/x.jpg');
        expect(imageSrcOr('land/bare-key.jpg', '/p.jpg')).toBe('/p.jpg');
        expect(imageSrcOr(undefined, '/p.jpg')).toBe('/p.jpg');
        expect(imageSrcOr('https://cdn.example/x.jpg', '/p.jpg')).toBe('https://cdn.example/x.jpg');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#439 — the public catalogue survives the row that took it down', () => {
    beforeEach(() => {
        mockSearch.mockReset();
        mockSearch.mockResolvedValue({
            success: true,
            data: { listings: ROWS_AS_STORED, lastDocId: null },
            error: null,
        });
    });

    it('RENDERS THE GRID FOR THE EXACT THREE ROWS, one of which has no images key', async () => {
        // Against the pre-fix line this does not fail an assertion — the render
        // throws, which is the defect.
        const PropertiesPage = (await import('@/app/farm-nation/properties/page')).default;
        render(<PropertiesPage />);

        await waitFor(() => {
            expect(screen.getByTestId('property-grid')).toBeInTheDocument();
        }, { timeout: 15000 });

        expect(screen.getAllByTestId('property-card')).toHaveLength(3);
        // And the row with no images is one of the three, not a card that was
        // quietly dropped to dodge the crash.
        expect(screen.getByText('Verified Land')).toBeInTheDocument();
    });

    it('and the empty state is still reachable, so the fix did not paper over it', async () => {
        // "No properties found" is the page's own answer to nothing matching.
        // The bug was that a visitor saw the ERROR BOUNDARY instead; both
        // states have to remain distinguishable.
        mockSearch.mockResolvedValue({ success: true, data: { listings: [], lastDocId: null }, error: null });

        const PropertiesPage = (await import('@/app/farm-nation/properties/page')).default;
        render(<PropertiesPage />);

        await waitFor(() => {
            expect(screen.getByText('No properties found')).toBeInTheDocument();
        }, { timeout: 15000 });
        expect(screen.queryByTestId('property-grid')).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#439 — the rule is stated once, and cannot be restated', () => {
    /** Every file that reads a record's picture. Computed, not listed. */
    function sitesIndexingImages(): string[] {
        const out = execSync(
            "grep -rln '\\.images\\[' src --include=*.ts --include=*.tsx || true",
            { cwd: ROOT },
        ).toString().trim();
        return out === '' ? [] : out.split('\n')
            .filter((f) => !f.includes('__tests__'))
            .filter((f) => f !== 'src/lib/first-image.ts')
            .sort();
    }

    it('NOTHING INDEXES .images[…] BY HAND ANY MORE', () => {
        // A new screen writing `record.images[0]` is #439 again. The helper is
        // the only place allowed to reach into the array.
        expect({ handWritten: sitesIndexingImages() }).toEqual({ handWritten: [] });
    });

    it('VACUITY GUARD: the sweep really can find such a site', () => {
        // Without this, a grep that matched nothing would pass the test above
        // for the wrong reason — this audit's most repeated mistake.
        const anyHit = execSync(
            "grep -rln 'images\\[' src --include=*.ts --include=*.tsx || true",
            { cwd: ROOT },
        ).toString().trim();
        expect(anyHit.length).toBeGreaterThan(0);
    });

    it('and the sixteen readers all go through the shared rule', () => {
        // Eleven guarded it by hand, four did not, and one indexed by a gallery
        // position. Counting them here means a reader that stops importing the
        // helper — because somebody inlined the check again — is visible.
        const READERS = [
            'src/app/actions/saved-items.ts',
            'src/app/admin/farm-nation/listings/page.tsx',
            'src/app/export/(app)/products/page.tsx',
            'src/app/farm-nation/(member)/my-properties/page.tsx',
            'src/app/farm-nation/checkout/[propertyId]/page.tsx',
            'src/app/farm-nation/map/page.tsx',
            'src/app/farm-nation/page.tsx',
            'src/app/farm-nation/properties/page.tsx',
            'src/app/farm-nation/property/[id]/page.tsx',
            'src/app/marketplace/buyer/dashboard/page.tsx',
            'src/app/marketplace/buyer/products/page.tsx',
            'src/app/marketplace/checkout/page.tsx',
            'src/app/marketplace/products/[id]/page.tsx',
            'src/app/marketplace/products/page.tsx',
            'src/app/marketplace/sell/page.tsx',
            'src/app/marketplace/sellers/[sellerId]/page.tsx',
        ];
        // Asserted before the loop: a `for` over an emptied list makes no
        // assertions at all and passes, which is the vacuity this suite exists
        // to refuse. My own mutation run is what surfaced it.
        expect(READERS.length).toBe(16);
        for (const rel of READERS) {
            expect({ rel, importsTheRule: /from "@\/lib\/first-image"/.test(code(rel)) })
                .toEqual({ rel, importsTheRule: true });
        }
    });

    it('and the helper never throws, for any input at all', () => {
        // It is called during render. A helper that throws would move the crash
        // rather than remove it.
        const hostile: unknown[] = [
            undefined, null, 0, '', 'x', true, {}, [], [Symbol('s')],
            [{ toString() { throw new Error('nope'); } }],
            new Proxy([], { get() { return undefined; } }),
        ];
        for (const value of hostile) {
            expect(() => firstImageSrc(value)).not.toThrow();
        }
    });
});
