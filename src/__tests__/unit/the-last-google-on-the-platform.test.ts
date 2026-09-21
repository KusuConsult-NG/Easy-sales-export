/**
 * @jest-environment node
 */

/**
 *   THE LAST GOOGLE ON THE PLATFORM WAS THE ONE A BUYER TYPED INTO.
 *
 *   THE OWNER: "For delivery address, we want to use openstreet map instead of
 *   google map."
 *
 *   #868 measured the first half of this and said so plainly: both browse maps
 *   and the Farm Nation location picker were ALREADY Leaflet over
 *   OpenStreetMap, and so was checkout's own route map. So was the concern —
 *   no key, no billing account — already answered everywhere except one field.
 *
 *   THAT FIELD. Checkout's delivery address used Google in four places:
 *
 *       a Places Autocomplete attached to the street input
 *       a Geocoder for the typed address
 *       a Geocoder for the address saved on the profile
 *       a Geocoder for each cart item's origin
 *
 *   All four are gone. The lookups go to this origin's own api/geocode, which
 *   calls Nominatim.
 *
 * ── WHY THE CALL IS NOT MADE IN THE BROWSER ─────────────────────────────────
 *
 *   Nominatim's usage policy requires a User-Agent identifying the application.
 *   `User-Agent` is a forbidden header for `fetch`, so a browser-side call is
 *   anonymous by construction — the shape that gets an application blocked. The
 *   policy also caps use at one request a second and asks for caching, neither
 *   of which a component rendered in a thousand tabs can hold.
 *
 *   AND IT FORBIDS AUTOCOMPLETE OUTRIGHT. The Google control fired a request
 *   per keystroke. The replacement searches on a pause or a press.
 *
 * ── THE ONE THAT NEARLY SHIPPED ─────────────────────────────────────────────
 *
 *   For a while during this change there were TWO debounced effects on the same
 *   typing — a suggestion search at 800ms and the original auto-verify at
 *   1000ms — which is twice the request rate against a ceiling this platform
 *   does not control, for one buyer typing one address. They are one effect,
 *   and the auto-verify rides the results the search already has. That is the
 *   assertion at 'ONE LOOKUP PER PAUSE'.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { buildCsp } from '@/lib/csp';
import { stateCentroid } from '@/lib/locations';
import {
    MAX_RESULTS,
    SEARCH_DEBOUNCE_MS,
    matchNigerianLga,
    matchNigerianState,
    nominatimSearchUrl,
    nominatimUserAgent,
    parseNominatimResults,
} from '@/lib/nominatim';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

const CHECKOUT = 'src/app/marketplace/checkout/page.tsx';
const ROUTE = 'src/app/api/geocode/route.ts';

/**
 * One CSP directive at a time.
 *
 *   NOT A SEARCH OF THE WHOLE POLICY STRING, which is how the vacuity guard
 *   below first failed to do its job: emptying SCRIPT_HOSTS entirely left the
 *   suite green, because `https://js.paystack.co` is also on `frame-src` and
 *   a whole-string `toContain` found it there. A policy that allows no script
 *   at all is exactly what that control exists to catch.
 */
function directive(name: string): string {
    const found = buildCsp({ nonce: 'n' }).split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name} `));
    return found ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the request that goes out', () => {
    it('IT GOES TO OPENSTREETMAP, not to Google', () => {
        const url = nominatimSearchUrl('12 Market Road, Jos');

        expect(url.startsWith('https://nominatim.openstreetmap.org/search?')).toBe(true);
        expect(url).not.toContain('googleapis');
    });

    it('AND IT IS SCOPED TO NIGERIA', () => {
        //   Not decoration: this platform delivers within Nigeria, and without
        //   it "Main Street" returns a road in Ohio which is then dropped by
        //   the bounds check — a lookup spent to find nothing.
        const params = new URL(nominatimSearchUrl('Main Street')).searchParams;

        expect(params.get('countrycodes')).toBe('ng');
        expect(params.get('q')).toBe('Main Street');
        expect(params.get('addressdetails')).toBe('1');
    });

    it('AND IT CANNOT BE ASKED FOR AN UNBOUNDED NUMBER OF RESULTS', () => {
        const at = (n: number) => Number(new URL(nominatimSearchUrl('x', n)).searchParams.get('limit'));

        expect(at(1)).toBe(1);
        expect(at(9999)).toBe(MAX_RESULTS);
        expect(at(0)).toBe(1);
        expect(at(-5)).toBe(1);
    });

    it('AND IT CARRIES A USER-AGENT, which is what the policy requires', () => {
        //   A browser cannot set this header at all, which is the whole reason
        //   the call is made on the server. An empty one gets an application
        //   blocked.
        expect(nominatimUserAgent({})).not.toBe('');
        expect(nominatimUserAgent({ NOMINATIM_USER_AGENT: 'Mine/2.0' })).toBe('Mine/2.0');

        expect(code(ROUTE)).toContain('"User-Agent": nominatimUserAgent()');
    });

    it('and a search is escaped rather than concatenated', () => {
        const url = nominatimSearchUrl('12 & 14 Market Rd, Jos');
        expect(url).toContain('12+%26+14+Market+Rd');
        expect(new URL(url).searchParams.get('q')).toBe('12 & 14 Market Rd, Jos');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the answer that comes back', () => {
    const row = (over: Record<string, unknown> = {}) => ({
        lat: '9.8965',
        lon: '8.8583',
        display_name: '12 Market Road, Jos North, Plateau, Nigeria',
        address: {
            house_number: '12',
            road: 'Market Road',
            city: 'Jos',
            county: 'Jos North',
            state: 'Plateau',
        },
        ...over,
    });

    it('IT BECOMES THIS PLATFORM\'S OWN SHAPE', () => {
        expect(parseNominatimResults([row()])).toEqual([{
            lat: 9.8965,
            lng: 8.8583,
            label: '12 Market Road, Jos North, Plateau, Nigeria',
            street: '12 Market Road',
            city: 'Jos',
            state: 'Plateau',
            lga: 'Jos North',
        }]);
    });

    it('AND ANYTHING OUTSIDE NIGERIA IS DROPPED — countrycodes is a request, not a guarantee', () => {
        //   A delivery pin in the Atlantic prices a shipment the courier cannot
        //   make.
        expect(parseNominatimResults([row({ lat: '51.5074', lon: '-0.1278' })])).toEqual([]);
        expect(parseNominatimResults([row({ lat: 'not-a-number' })])).toEqual([]);
        expect(parseNominatimResults([row({ lat: '0', lon: '0' })])).toEqual([]);
    });

    it('AND A MALFORMED ANSWER IS NOT A CRASH ON A CHECKOUT SCREEN', () => {
        expect(parseNominatimResults(null)).toEqual([]);
        expect(parseNominatimResults({ error: 'nope' })).toEqual([]);
        expect(parseNominatimResults([null, 'string', 42])).toEqual([]);
    });

    it('and a place with no house number still names its street', () => {
        const [only] = parseNominatimResults([row({
            address: { road: 'Market Road', state: 'Plateau', county: 'Jos North' },
        })]);
        expect(only.street).toBe('Market Road');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the state and LGA reconciliation, which used to live in one branch', () => {
    it('THE FCT IS THE CASE AN EXACT MATCH CANNOT COVER', () => {
        expect(matchNigerianState('Federal Capital Territory')).toBe('FCT');
        expect(matchNigerianState('Abuja')).toBe('FCT');
        expect(matchNigerianState('FCT')).toBe('FCT');
    });

    it('AND "Plateau State" IS PLATEAU', () => {
        expect(matchNigerianState('Plateau State')).toBe('Plateau');
        expect(matchNigerianState('  plateau  ')).toBe('Plateau');
    });

    it('AND AN LGA IS MATCHED WITHIN ITS OWN STATE, never across', () => {
        //   OSM writes "Jos North Local Government Area"; this platform's list
        //   says "Jos North". The partial match is what bridges them, and it is
        //   consulted within ONE state's list so it cannot reach a same-named
        //   LGA elsewhere.
        expect(matchNigerianLga('Plateau', 'Jos North Local Government Area')).toBe('Jos North');
        expect(matchNigerianLga('Plateau', 'Jos North')).toBe('Jos North');
        expect(matchNigerianLga('Lagos', 'Jos North')).toBe('');
        expect(matchNigerianLga('', 'Jos North')).toBe('');
    });

    it('and an unrecognisable name is EMPTY rather than a guess', () => {
        //   The form's state select takes one of the platform's own values. A
        //   near-miss written into it renders as nothing selected, with no
        //   error, which is worse than an empty field the buyer can see.
        expect(matchNigerianState('Somewhere Else')).toBe('');
        expect(matchNigerianState(undefined)).toBe('');
        expect(matchNigerianState(42)).toBe('');
        expect(matchNigerianLga('Plateau', 'Nowhere')).toBe('');
    });

    it('AND BOTH CHECKOUT PATHS USE IT — the defect was that only one did', () => {
        //   This rule was written inside the Google `place_changed` listener and
        //   nowhere else, so the MANUAL path — the one most buyers take —
        //   reconciled nothing and left the dependent selects empty.
        const src = code(CHECKOUT);

        expect(src).toContain('applySuggestion');
        expect(src).not.toContain('address_components');
        expect(src).not.toContain('administrative_area_level_1');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('what the policy asks for, and what this does', () => {
    it('ONE LOOKUP PER PAUSE — not one per keystroke, and not two per pause', () => {
        //   THE assertion for the one that nearly shipped. Two debounced
        //   effects on the same typing is twice the request rate against a
        //   ceiling this platform does not control.
        const src = code(CHECKOUT);

        const debounces = src.match(/setTimeout\(/g) || [];
        expect(debounces).toHaveLength(1);
        expect(src).toContain('SEARCH_DEBOUNCE_MS');
        //   The second one, by its old constant.
        expect(src).not.toContain('geocodeManualAddress(false);\n        }, 1000);');
    });

    it('AND THE WAIT IS LONG ENOUGH TO BE A PAUSE rather than a keystroke', () => {
        expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
    });

    it('AND THE ROUTE CACHES, RATE-LIMITS AND TIMES OUT', () => {
        const src = code(ROUTE);

        expect(src).toContain('getCached<');
        expect(src).toContain('setCache(');
        expect(src).toContain('withRateLimit(handler, "geocode")');
        expect(src).toContain('AbortSignal.timeout(');
    });

    it('AND THE ROUTE REQUIRES A SESSION', () => {
        //   An open geocoding proxy on this origin spends the platform's share
        //   of a donated service for anybody who finds the URL.
        const src = code(ROUTE);

        expect(src).toContain('requireSession()');
        expect(src).toContain('{ status: 401 }');
    });

    it('AND THE GEOCODE LIMIT IS ITS OWN BUDGET, not the shared API one', () => {
        //   200 a minute of the shared `api` limit is two hundred times the
        //   upstream ceiling, which is no limit at all here.
        const { rateLimitConfig } = jest.requireActual<typeof import('@/lib/rate-limits.config')>(
            '@/lib/rate-limits.config');

        expect(rateLimitConfig.geocode).toBeDefined();
        expect(rateLimitConfig.geocode.maxRequests)
            .toBeLessThan(rateLimitConfig.api.maxRequests);
    });

    it('and one cart origin is looked up per PLACE, not per line item', () => {
        /*
         *   Three bags of rice from the same farm used to cost three requests.
         *
         *   SPELLING-PINNED, AND SAID SO. The dedupe lives inside a 1400-line
         *   client component that cannot be executed here without mocking a
         *   session, a cart, a toast context and Leaflet — so this asserts the
         *   LOOP, not the behaviour. A first version asserted only that the
         *   word `byPlace` appeared, and a mutant that built the map and then
         *   iterated the cart anyway survived it. The loop header is the line
         *   that has to change for the defect to come back.
         */
        const src = code(CHECKOUT);

        expect(src).toContain('for (const { lga, state, ids } of byPlace.values())');
        expect(src).toContain('geocodeAddress(`${lga}, ${state}, Nigeria`');
        //   And nothing loops the cart to geocode it.
        expect(src).not.toMatch(/for \(const item of cart\)[\s\S]{0,400}geocodeAddress\(/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Google is gone, and the allow-list went with it', () => {
    it('NOT ONE GOOGLE MAPS CALL IS LEFT IN CHECKOUT', () => {
        //   THE test. Comments naming Google are stripped before this runs, so
        //   what is asserted is the code.
        const src = code(CHECKOUT);

        for (const trace of [
            'maps.googleapis.com',
            'google.maps',
            'gm_authFailure',
            'GOOGLE_MAPS_KEY',
            'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
            'places.Autocomplete',
        ]) {
            expect({ trace, present: src.includes(trace) }).toEqual({ trace, present: false });
        }
    });

    it('AND THE CSP NO LONGER PERMITS THE SCRIPT HOST', () => {
        //   An allow-list entry with no caller is standing permission for a
        //   script host nothing needs, and reads as evidence that it IS needed.
        const policy = buildCsp({ nonce: 'n' });

        expect(policy).not.toContain('maps.googleapis.com');
        expect(policy).not.toContain('maps.google.com');
    });

    it('POSITIVE CONTROL: script-src IS NOT EMPTY — the guard that first failed', () => {
        //   A policy allowing no script at all satisfies every not.toContain
        //   above and breaks Paystack checkout. Asserted on the DIRECTIVE, for
        //   the reason `directive` gives.
        expect(directive('script-src')).toContain('https://js.paystack.co');
        expect(directive('script-src')).toContain('https://www.googletagmanager.com');
        expect(directive('connect-src')).toContain('https://api.paystack.co');
    });

    it('AND NOTHING WAS ADDED TO REPLACE THEM, because the call is server side', () => {
        const policy = buildCsp({ nonce: 'n' });

        expect(policy).not.toContain('nominatim.openstreetmap.org');
        //   The browser only ever talks to this origin about addresses. It
        //   imports Nominatim's RESULT TYPE, which erases at compile time and
        //   is not a request — so the assertion is on the URL, not on the word.
        const client = code('src/lib/geocode-request.ts');

        expect(client).toContain('`/api/geocode?');
        expect(client).not.toContain('nominatim.openstreetmap.org');
        expect(client).not.toContain('nominatimSearchUrl');
        expect(client).not.toContain('NOMINATIM_BASE');
    });

    it('POSITIVE CONTROL: and the media host uploads are served from', () => {
        //   #!! put res.cloudinary.com on media-src because no uploaded video
        //   could play without it. Nothing here should have disturbed it.
        expect(directive('media-src')).toContain('https://res.cloudinary.com');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the map itself, which was never the problem', () => {
    it('THE ROUTE MAP IS STILL LEAFLET OVER OPENSTREETMAP TILES', () => {
        //   #868's guard, one file further on. A tile URL is the thing that
        //   quietly acquires a key and a bill, and it is one line in a file
        //   nobody reads twice.
        const src = code('src/components/marketplace/CheckoutRouteMap.tsx');

        expect(src).toContain('tile.openstreetmap.org');
        expect(src).toContain('react-leaflet');
    });

    it('AND IT IS NO LONGER CALLED A FALLBACK, because there is nothing to fall back from', () => {
        expect(code(CHECKOUT)).toContain('CheckoutRouteMap');
        expect(code(CHECKOUT)).not.toContain('CheckoutMapFallback');
    });

    it('POSITIVE CONTROL: THE OFFLINE STATE CENTROID IS STILL THE LAST RESORT', () => {
        /*
         *   The answer when the geocoding service is unreachable. Removing it
         *   makes a checkout depend on a third party being up.
         *
         *   EXECUTED, AFTER TWO SPELLING-PINNED VERSIONS FAILED TO CATCH A
         *   MUTANT. The lookup was written out at five call sites inside a
         *   1400-line client component, and a mutant that gutted one of them
         *   survived a test asserting the file still mentioned the table AND
         *   still called `setDestinationCoords(NIGERIAN_STATE_COORDINATES[...])`
         *   — because both lines remain when the lookup between them is gone.
         *
         *   So the rule was named. lib/locations' own comment had been asking
         *   for it: "which is a helper waiting to be named. Not named here:
         *   that would change five call sites in a file with no rendering
         *   tests." This is that test.
         */
        expect(stateCentroid('Plateau')).toEqual({ lat: 9.8965, lng: 8.8583 });
        expect(stateCentroid('plateau')).toEqual(stateCentroid('Plateau'));
        expect(stateCentroid('  LAGOS  ')).toEqual(stateCentroid('Lagos'));
    });

    it('AND AN UNKNOWN STATE GETS NO PIN, rather than a plausible one', () => {
        //   `null` is what tells checkout it has no offline answer and must say
        //   so. A nearest-match here would place a delivery in another state
        //   and price it as though that were right.
        expect(stateCentroid('Narnia')).toBeNull();
        expect(stateCentroid('')).toBeNull();
        expect(stateCentroid(undefined)).toBeNull();
        expect(stateCentroid(9)).toBeNull();
    });

    it('AND ALL FIVE CHECKOUT CALL SITES GO THROUGH IT', () => {
        //   The point of naming it. A sixth hand-written copy is how one of
        //   them drifts.
        const src = code(CHECKOUT);

        expect(src).not.toContain('Object.keys(NIGERIAN_STATE_COORDINATES)');
        expect((src.match(/stateCentroid\(/g) || []).length).toBeGreaterThanOrEqual(4);
    });

    it('POSITIVE CONTROL: and "Use Address Anyway" still exists', () => {
        //   The buyer's own override, for an address no map knows. It is the
        //   thing that stops any of this blocking a sale.
        expect(code(CHECKOUT)).toContain('Use Address Anyway');
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to lib/nominatim.ts, lib/locations.ts, api/geocode/route.ts,
 *   lib/csp.ts, marketplace/checkout/page.tsx and CheckoutRouteMap.tsx; this
 *   suite re-run against each. COUNTS ARE MEASURED.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   drop countrycodes=ng                         1  'AND IT IS SCOPED TO
 *                                                   NIGERIA'
 *
 *   stop dropping results outside Nigeria        1  'AND ANYTHING OUTSIDE
 *                                                   NIGERIA IS DROPPED'
 *
 *   unbounded result limit                       1  'AND IT CANNOT BE ASKED
 *                                                   FOR AN UNBOUNDED NUMBER'
 *
 *   drop the FCT special case                    1  'THE FCT IS THE CASE AN
 *                                                   EXACT MATCH CANNOT COVER'
 *
 *   LGA matched across every state at once       1  'AND AN LGA IS MATCHED
 *                                                   WITHIN ITS OWN STATE'
 *
 *   parser trusts every row shape                1  'AND A MALFORMED ANSWER IS
 *                                                   NOT A CRASH'
 *
 *   route loses its rate limit                   1  'AND THE ROUTE CACHES,
 *                                                   RATE-LIMITS AND TIMES OUT'
 *
 *   route stops caching                          1  same
 *
 *   route becomes an open geocoding proxy        1  'AND THE ROUTE REQUIRES A
 *                                                   SESSION'
 *
 *   no identifying User-Agent                    1  'AND IT CARRIES A
 *                                                   USER-AGENT'
 *
 *   a SECOND debounced lookup returns — the      1  'ONE LOOKUP PER PAUSE'
 *   one that nearly shipped
 *
 *   debounce dropped to a keystroke (50ms)       1  'AND THE WAIT IS LONG
 *                                                   ENOUGH TO BE A PAUSE'
 *
 *   maps.googleapis.com back on script-src       1  'AND THE CSP NO LONGER
 *                                                   PERMITS THE SCRIPT HOST'
 *
 *   route map tiles switched to Google           1  'THE ROUTE MAP IS STILL
 *                                                   LEAFLET OVER OSM TILES'
 *
 *   cart origins looked up per LINE ITEM         1  'and one cart origin is
 *                                                   looked up per PLACE'
 *
 *   stateCentroid returns Lagos for an           1  'AND AN UNKNOWN STATE GETS
 *   unknown state                                   NO PIN'
 *
 *   stateCentroid becomes case-sensitive         1  'POSITIVE CONTROL: THE
 *                                                   OFFLINE STATE CENTROID'
 *
 *   stateCentroid always null                    1  same
 *
 *   the typed-address fallback gutted            1  'AND ALL FIVE CHECKOUT
 *                                                   CALL SITES GO THROUGH IT'
 *
 *   CSP allows no script hosts at all            1  'POSITIVE CONTROL:
 *                                                   script-src IS NOT EMPTY'
 *
 *   media-src loses Cloudinary                   1  'POSITIVE CONTROL: and the
 *                                                   media host uploads are
 *                                                   served from'
 *
 *   ── THREE THAT SURVIVED FIRST, AND WHAT THAT COST ──────────────────────────
 *
 *   Recorded because the tests that let them through were mine, and each one
 *   was the same mistake: asserting a SPELLING in a 1400-line client component
 *   that cannot be executed here.
 *
 *   ·  "CSP allows no script hosts at all" survived a whole-policy
 *      `toContain('https://js.paystack.co')` — that host is also on frame-src.
 *      Fixed by asserting the DIRECTIVE.
 *
 *   ·  "cart origins per line item" survived `toContain('byPlace')`, because
 *      the mutant still BUILT the map and then ignored it. Fixed by pinning
 *      the loop header, and the assertion says it is spelling-pinned.
 *
 *   ·  "the state-centroid fallback gutted" survived TWICE — once against
 *      `toContain('NIGERIAN_STATE_COORDINATES')`, then again against the
 *      `setDestinationCoords(NIGERIAN_STATE_COORDINATES[matchedState])` line,
 *      because both remain when the lookup between them is removed. Fixed by
 *      NAMING the rule — lib/locations' own comment had been asking for it —
 *      and executing it.
 *
 *   CONTROLS — SHOULD SURVIVE
 *   reword this module's header                  0  SURVIVED ✓
 *   lengthen the debounce 800ms -> 1200ms        0  SURVIVED ✓ (a bound, not a
 *                                                   number: longer is still a
 *                                                   pause)
 */
