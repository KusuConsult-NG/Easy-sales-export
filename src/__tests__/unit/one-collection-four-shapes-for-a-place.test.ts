/**
 * @jest-environment node
 */

/**
 *   #689 ONE BAD ROW LOST THE WHOLE PAGE — AND THE ADMIN REVIEW QUEUE WITH IT.
 *
 *   LAND_LISTINGS has five writers and they do not agree on where a plot is:
 *
 *     land-actions.ts::createLandListing
 *         location: { state, lga, address, lat, lng, geopoint }
 *     land-listings.ts  (two writers)
 *         location: { state, lga, address }              — no coordinates
 *     farm-nation/_fn_listings.ts::createFarmNationListing
 *         location: "5 Riverside, Jos"                   — a STRING
 *     api/farm-nation/create-listing
 *         NO `location` at all — state/lga/address flat, plus gpsCoordinates
 *
 *   The three readers in land-actions.ts assumed the first shape:
 *
 *       lat: data.location.geopoint?.latitude || data.location.lat
 *
 *   The optional chain guards the GEOPOINT, which is the half that is usually
 *   present, and not the LOCATION, which is the half that is sometimes absent.
 *   So a row written by the API route is a TypeError — thrown inside `.map()`,
 *   caught by the function's own try/catch, and returned as a flat failure.
 *
 *   WHAT THAT COSTS, measured before anything was changed:
 *
 *     getMyLandListings   {"success":false,"error":"Failed to fetch your
 *                         listings"} — over a member who had one good listing
 *                         and one from the API route. The good one is lost too.
 *     getLandListing      that listing's own page, the same.
 *     getLandListings     the ADMIN REVIEW QUEUE calls this with
 *                         status: 'pending_verification' — the exact status the
 *                         API route writes. So one listing created through it
 *                         stops EVERY listing from being reviewable, and the
 *                         listing that broke the queue is the one waiting in it.
 *
 *   The STRING shape does not throw, it garbles. `{ ...("5 Riverside, Jos") }`
 *   spreads a string into character keys, and the address reached the caller as
 *   `{"0":"5","1":" ","2":"R","3":"i",…}` — measured, not imagined.
 *
 * ── THE SCREENS ALREADY KNEW, SEPARATELY, FOUR TIMES ────────────────────────
 *
 *   FarmNationDashboardClient, CheckoutClient and PropertyDetailsClient each
 *   carried their own `typeof location === "object" ? … : …`, and all three
 *   disagreed about what to render: one used `address || lga`, another used
 *   address, lga AND state, and each stripped the stray commas its own
 *   construction left behind. my-properties/page.tsx had no copy at all and
 *   rendered ", " for a string location.
 *
 *   Four hand-maintained answers to one question — this audit's fourth
 *   recurring class — sitting above three server readers that had none.
 *
 * ── THE REPAIR IS AT THE READ ───────────────────────────────────────────────
 *
 *   lib/land-location.ts states it once. It has to be the read rather than a
 *   migration: the rows are already in the database in all four shapes, and
 *   nothing on this platform rewrites a member's records to tidy a schema. A
 *   reader that understands what is there costs one function and works on
 *   history.
 *
 *   The two divergent writers are brought into line too, but ADDITIVELY —
 *   the API route gains a `location` object BESIDE its flat fields, which is
 *   what makes new rows answer `where("location.state", …)`, the filter
 *   land-listings.ts searches with. Nothing either writer stored is removed.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { stripComments } from '@/lib/testing/strip-comments';
import { readLandLocation, landLocationText } from '@/lib/land-location';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

const OWNER = 'owner-1';
let store: FakeDbHandle;

const asOwner = () =>
    (globalThis as any).mockRequireSession?.mockImplementation(() => Promise.resolve({
        session: { user: { id: OWNER, roles: ['general_user'], email: 'ada@example.com' } },
        error: null,
    }));

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    asOwner();
});

/** The four shapes, exactly as their writers store them. */
const ROWS = {
    /** land-actions.ts::createLandListing */
    full: {
        ownerId: OWNER, title: 'Full plot', status: 'pending_verification',
        location: {
            state: 'Plateau', lga: 'Jos North', address: '12 Market Road',
            lat: 9.93, lng: 8.89, geopoint: { latitude: 9.93, longitude: 8.89 },
        },
        createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    },
    /** land-listings.ts — an object with no coordinates */
    noCoords: {
        ownerId: OWNER, title: 'No-coords plot', status: 'pending_verification',
        location: { state: 'Plateau', lga: 'Jos South', address: '8 Hill Street' },
        createdAt: new Date('2026-01-02T00:00:00Z').toISOString(),
    },
    /** farm-nation/_fn_listings.ts — a STRING */
    stringLoc: {
        ownerId: OWNER, title: 'String plot', status: 'pending_verification',
        location: '5 Riverside', state: 'Plateau', lga: 'Jos East',
        createdAt: new Date('2026-01-03T00:00:00Z').toISOString(),
    },
    /** api/farm-nation/create-listing — NO location field at all */
    flat: {
        ownerId: OWNER, title: 'Flat plot', status: 'pending_verification',
        state: 'Plateau', lga: 'Mangu', address: '3 Farm Lane',
        gpsCoordinates: { latitude: 9.52, longitude: 9.13 },
        createdAt: new Date('2026-01-04T00:00:00Z').toISOString(),
    },
} as const;

const seedAll = () => {
    for (const [id, row] of Object.entries(ROWS)) {
        store.seed(COLLECTIONS.LAND_LISTINGS, id, { ...row });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#689 — the readers survive every shape their writers produce', () => {
    it('THE DEFECT: a row with no `location` no longer loses the member\'s page', async () => {
        /*
         *   THE test, and the measurement that started this. Before the repair
         *   this returned {"success":false,"error":"Failed to fetch your
         *   listings"} — the good listings lost along with the one that threw.
         */
        seedAll();

        const { getMyLandListings } = await import('@/app/actions/land-actions');
        const res: any = await getMyLandListings();

        expect(res.success).toBe(true);
        expect(res.data.map((l: any) => l.title).sort())
            .toEqual(['Flat plot', 'Full plot', 'No-coords plot', 'String plot']);
    });

    it('AND THE ADMIN REVIEW QUEUE STAYS READABLE', async () => {
        /*
         *   The worst of the three, because of WHICH status it reads. The queue
         *   asks for `pending_verification`, which is exactly what the API
         *   route writes — so the listing that broke the queue was the one
         *   waiting in it, and no listing at all could be reviewed.
         */
        seedAll();
        (globalThis as any).mockRequireSession?.mockImplementation(() => Promise.resolve({
            session: { user: { id: 'admin-1', roles: ['super_admin'] } }, error: null,
        }));

        const { getLandListings } = await import('@/app/actions/land-actions');
        const res: any = await getLandListings({ status: 'pending_verification' } as any);

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(4);
    });

    it('AND A SINGLE LISTING PAGE OPENS', async () => {
        seedAll();

        const { getLandListing } = await import('@/app/actions/land-actions');
        const res: any = await getLandListing('flat');

        expect(res.success).toBe(true);
        expect(res.data.location).toMatchObject({
            state: 'Plateau', lga: 'Mangu', address: '3 Farm Lane', lat: 9.52, lng: 9.13,
        });
    });

    it('AND A STRING LOCATION IS AN ADDRESS, NOT A BAG OF CHARACTERS', async () => {
        /*
         *   The shape that did not throw. `{ ...("5 Riverside") }` spreads into
         *   character keys, so the caller received
         *   {"0":"5","1":" ","2":"R",…} where the address should be.
         */
        seedAll();

        const { getLandListing } = await import('@/app/actions/land-actions');
        const res: any = await getLandListing('stringLoc');

        expect(res.data.location.address).toBe('5 Riverside');
        expect(res.data.location).not.toHaveProperty('0');
        //   …and the flat state/lga on the same row are picked up.
        expect(res.data.location.state).toBe('Plateau');
        expect(res.data.location.lga).toBe('Jos East');
    });

    it('AND THE SHAPE THAT ALWAYS WORKED STILL DOES', async () => {
        //   The control. A normaliser that returned empty strings for
        //   everything would satisfy every assertion above about not crashing.
        seedAll();

        const { getLandListing } = await import('@/app/actions/land-actions');
        const res: any = await getLandListing('full');

        expect(res.data.location).toMatchObject({
            state: 'Plateau', lga: 'Jos North', address: '12 Market Road',
            lat: 9.93, lng: 8.89,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#689 — the rule itself', () => {
    it('READS COORDINATES FROM WHEREVER THE WRITER PUT THEM', () => {
        expect(readLandLocation(ROWS.full)).toMatchObject({ lat: 9.93, lng: 8.89 });
        expect(readLandLocation(ROWS.flat)).toMatchObject({ lat: 9.52, lng: 9.13 });
        //   And says so honestly when there are none, rather than inventing a
        //   point off the coast of Africa.
        expect(readLandLocation(ROWS.noCoords)).toMatchObject({ lat: null, lng: null });
    });

    it('AND KEEPS A COORDINATE OF ZERO', () => {
        /*
         *   `||` would drop it. The old expression used `||` throughout, and
         *   the platform's own html`` helper carries the same note: 0 and false
         *   are real values, and rendering them as absent is the confident
         *   wrong answer this audit keeps finding.
         */
        expect(readLandLocation({ location: { lat: 0, lng: 0 } }))
            .toMatchObject({ lat: 0, lng: 0 });
    });

    it('AND NEVER THROWS, WHATEVER IT IS HANDED', () => {
        //   The property the three readers needed and did not have.
        for (const row of [null, undefined, {}, { location: null }, { location: 42 },
            { location: [] }, { location: 'x' }, { gpsCoordinates: null }]) {
            expect(() => readLandLocation(row as any)).not.toThrow();
        }
        expect(readLandLocation(null)).toEqual({ state: '', lga: '', address: '', lat: null, lng: null });
    });

    it('AND THE ONE-LINE ADDRESS SKIPS WHAT IT DOES NOT KNOW', () => {
        //   Four screens built this by hand and each stripped the stray commas
        //   its own construction left behind. Built from the parts that exist,
        //   so there are none to strip.
        expect(landLocationText(ROWS.full)).toBe('12 Market Road, Jos North, Plateau');
        expect(landLocationText({ location: { state: 'Plateau' } })).toBe('Plateau');
        expect(landLocationText({})).toBe('');
        expect(landLocationText(null)).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#689 — and nobody keeps their own copy of the rule', () => {
    /*
     *   SIX READERS, FOUND BY SWEEPING RATHER THAN BY EYE.
     *
     *   The first four came from reading the Farm Nation screens. The last two
     *   came from a sweep for the crash SHAPE — a document field dereferenced
     *   two hops without guarding the first — run over the whole of src and
     *   validated against the pre-fix land-actions.ts, which it reported
     *   correctly at all three sites.
     *
     *   Without it this finding would have fixed five places and left two,
     *   which is the "one of N doors" class applied to its own repair. Neither
     *   of the two crashed — both guarded the shape their own way — but both
     *   dropped the address for a row written by the API route, and the layout
     *   is the widest audience of all: it is the page's OpenGraph title and its
     *   schema.org RealEstateListing, which is what a shared link and a search
     *   engine show.
     */
    const SCREENS = [
        'src/app/farm-nation/(member)/dashboard/FarmNationDashboardClient.tsx',
        'src/app/farm-nation/checkout/[propertyId]/CheckoutClient.tsx',
        'src/app/farm-nation/property/[id]/PropertyDetailsClient.tsx',
        'src/app/farm-nation/(member)/my-properties/page.tsx',
        'src/app/farm-nation/property/[id]/layout.tsx',
        'src/app/actions/saved-items.ts',
    ];

    it.each(SCREENS)('%s RENDERS THROUGH THE SHARED RULE', (screen) => {
        expect(code(screen)).toContain('landLocationText(');
    });

    it('AND NOT ONE OF THEM STILL TESTS THE SHAPE BY HAND', () => {
        //   The control. Calling the shared rule while keeping the old ternary
        //   beside it would satisfy the line above and leave the copies to
        //   drift — which is the state this finding found.
        for (const screen of SCREENS) {
            const src = code(screen);
            expect({ screen, handRolled: /typeof\s+[\w.]+\.location\s*===\s*["']object["']/.test(src) })
                .toEqual({ screen, handRolled: false });
            //   And no reader reaches past `location` on its own — the
            //   OPTIONAL form included. `data.location?.lga` does not throw,
            //   which is exactly why it survived a mutant here: it is guarded
            //   against the crash and not against the defect, and it still
            //   loses the address on every row the API route wrote.
            expect({ screen, rawRead: /\bdata\.location[.?]/.test(src) })
                .toEqual({ screen, rawRead: false });
        }
    });

    it('AND THE SWEEP THAT FOUND THE LAST TWO STILL REPORTS THE ORIGINAL FAULT', () => {
        /*
         *   THE INSTRUMENT, PINNED. The last two readers were found by sweeping
         *   for "a document field dereferenced two hops with the first hop
         *   unguarded", not by reading the screens — and a sweep is only worth
         *   having if it is known to fire on the thing it was written for.
         *
         *   Asked of a known-bad sample rather than of the tree: the exact
         *   expression that threw, which no longer appears anywhere in src.
         */
        const KNOWN_BAD = `
            const data = doc.data();
            return { lat: data.location.geopoint?.latitude || data.location.lat };
        `;
        const rawRead = /\bdata\.location[.?]/;
        expect(rawRead.test(KNOWN_BAD)).toBe(true);
        //   …and the optional form too, which is the one that slipped through
        //   the first version of this pattern.
        expect(rawRead.test('addressLocality: data.location?.lga')).toBe(true);

        //   …and it is absent from every reader this finding touched.
        for (const screen of [...SCREENS, 'src/app/actions/land-actions.ts']) {
            expect({ screen, found: rawRead.test(code(screen)) }).toEqual({ screen, found: false });
        }
    });

    it('AND ALL FOUR READERS IN land-actions.ts GO THROUGH THE RULE', () => {
        //   The ratchet on the defect itself: `data.location.geopoint` guarded
        //   the geopoint and not the location.
        //
        //   FOUR, not three. getLandStatistics was the fourth and it did not
        //   crash — `data.location?.state` is guarded against the TypeError and
        //   not against the defect, so every listing the API route wrote was
        //   counted under 'Unknown' in the by-state breakdown.
        const src = code('src/app/actions/land-actions.ts');
        expect(src).not.toMatch(/data\.location\.geopoint/);
        expect((src.match(/readLandLocation\(data\)/g) ?? []).length).toBe(4);
    });

    it('AND THE RULE PASSES THROUGH WHAT THE SHAPES DO NOT DISAGREE ABOUT', () => {
        /*
         *   A regression the first version of this fix introduced, caught by
         *   reading rather than by a test — which is why it is a test now.
         *
         *   `...data.location` used to carry the whole object, `city` included,
         *   and _getLandListings filters on `listing.location.city`. Returning
         *   only the five normalised fields silently broke the city filter on
         *   the land search, and nothing covered it.
         */
        const out = readLandLocation({
            location: { state: 'Plateau', lga: 'Jos North', city: 'Jos', address: '1 A Road' },
        });
        expect(out.city).toBe('Jos');
        expect(out.state).toBe('Plateau');

        //   …and the filter that needs it is still written that way.
        expect(code('src/app/actions/land-actions.ts')).toContain('listing.location.city');
    });

    it('AND NORMALISATION WINS OVER PASS-THROUGH, NOT THE OTHER WAY AROUND', () => {
        /*
         *   The control on the line above, and a surviving mutant put it here.
         *
         *   Passing the object's keys through is for the fields the shapes
         *   AGREE about. For the five this function normalises, the normalised
         *   value must win — `...obj` spread AFTER them would hand back
         *   whatever the row happened to hold, which is the raw reading this
         *   whole finding exists to stop.
         *
         *   Both halves of what normalising means are checked: a coordinate
         *   stored as a STRING becomes a number, and a padded state is trimmed.
         *   Either alone would still pass with the spread in the wrong place.
         */
        const out = readLandLocation({
            location: { state: '  Plateau  ', lga: 'Jos North', lat: '9.93', lng: '8.89' },
        });

        expect(out.state).toBe('Plateau');
        expect(out.lat).toBe(9.93);
        expect(out.lng).toBe(8.89);
        expect(typeof out.lat).toBe('number');
    });

    it('AND BOTH DIVERGENT WRITERS NOW STORE A location OBJECT', () => {
        /*
         *   Additive, and that is the point — the readers normalise, so history
         *   needs no migration. This is so NEW rows answer
         *   `where("location.state", …)`, which is how land-listings.ts filters
         *   a search: a flat row was invisible to every state filter.
         */
        const route = code('src/app/api/farm-nation/create-listing/route.ts');

        /*
         *   READ FROM THE WRITE, not from the file.
         *
         *   The first version asserted `/^\s+state,$/m` over the whole source
         *   and a mutant that deleted the flat fields FROM THE PAYLOAD survived
         *   — because the route destructures `const { state, lga, address … } =
         *   body` and those lines match the same pattern. A check satisfied by
         *   a different part of the file than the one it is about.
         */
        const at = route.indexOf('listingRef.set(');
        expect(at).toBeGreaterThan(-1);
        const payload = route.slice(at, route.indexOf('});', at));

        const locAt = payload.indexOf('location: {');
        expect(locAt).toBeGreaterThan(-1);

        /*
         *   AND THE FLAT FIELDS ARE READ WITH THE location BLOCK TAKEN OUT.
         *
         *   The second attempt at this still let the mutant through: the new
         *   `location: { state, lga, address }` puts those very names back into
         *   the payload, so `/^\s+state,$/m` matched the NESTED copy after the
         *   flat one had been deleted. The assertion for "both are written"
         *   cannot be allowed to be satisfied by either one alone.
         */
        let depth = 0, i = payload.indexOf('{', locAt);
        do { if (payload[i] === '{') depth++; else if (payload[i] === '}') depth--; i++; }
        while (i < payload.length && depth > 0);
        const flat = payload.slice(0, locAt) + payload.slice(i);

        expect(flat).toMatch(/^\s+state,$/m);
        expect(flat).toMatch(/^\s+lga,$/m);
        expect(flat).toMatch(/^\s+address,$/m);
        //   …and the block that was excised really is the location object, or
        //   the three lines above prove nothing about it.
        expect(payload.slice(locAt, i)).toMatch(/location:\s*\{[\s\S]*gpsCoordinates/);

        const action = code('src/app/actions/farm-nation/_fn_listings.ts');
        expect(action).toMatch(/location:\s*\{\s*address:\s*validatedData\.location/);
        //   Its flat state/lga stay too, for the same reason.
        expect(action).toMatch(/^\s+state: normalizeLocation\(validatedData\.state\),$/m);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: a reader dereferences data.location again           KILLED
 *     the normaliser ignores the flat fields                          KILLED
 *     the normaliser ignores a string location                        KILLED
 *     the normaliser reads no coordinates at all                      KILLED
 *     `??` becomes `||`, so a coordinate of zero disappears           KILLED
 *     the API route stops writing its location object                 KILLED
 *     the API route drops its flat fields while adding the object     KILLED
 *       — SURVIVED TWICE; see the note below
 *     a screen keeps its hand-rolled shape test                       KILLED
 *     saved items keeps its own copy of the shape rule                KILLED
 *     the shared link's title reads location directly again           KILLED
 *     the schema.org address reads the raw field again                KILLED
 *       — SURVIVED once; the pattern missed the OPTIONAL form
 *     the statistics bucket reads location directly again             KILLED
 *     the rule stops passing the object's other keys through (city)   KILLED
 *     pass-through wins over normalisation                            KILLED
 *       — SURVIVED once; nothing pinned which of the two wins
 *
 *     WITHDRAWN AS EQUIVALENT
 *     the normaliser treats an array as an object                  (withdrawn)
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── TWO MUTANTS DID NOT DIE THE FIRST TIME ──────────────────────────────────
 *
 *   "the API route drops its flat fields while adding the object" SURVIVED
 *   TWICE, and both times the fault was the test's.
 *
 *     First:  it asserted `/^\s+state,$/m` over the WHOLE FILE, and the route
 *             destructures `const { state, lga, address … } = body` — lines
 *             matching the same pattern. Satisfied by a part of the file it was
 *             not about.
 *     Second: narrowed to the `listingRef.set(...)` payload, and it STILL
 *             survived — because the fix itself writes
 *             `location: { state, lga, address }`, so the names it was looking
 *             for were back in the payload, nested. An assertion that two
 *             things are both written must not be satisfiable by either alone.
 *
 *   It reads the payload with the `location` block brace-matched out now, and
 *   checks separately that the excised block really was that object.
 *
 *   "the schema.org address reads the raw field again" survived because the
 *   pattern was `/\bdata\.location\.\w/` and the code was
 *   `data.location?.lga` — guarded against the CRASH and not against the
 *   defect, which is the distinction this whole finding turns on. Widening it
 *   to `/\bdata\.location[.?]/` killed the mutant AND immediately found a
 *   SEVENTH reader, getLandStatistics, in a file already counted as fixed.
 *
 *   "pass-through wins over normalisation" survived because nothing said which
 *   of the two the function owes. It owes normalisation on the five fields it
 *   names and pass-through on everything else; a coordinate stored as a string
 *   and a padded state now pin it.
 *
 *   "the normaliser treats an array as an object" is WITHDRAWN AS EQUIVALENT
 *   rather than chased. Removing `!Array.isArray(v)` makes `location: []` take
 *   the object branch, where `obj.state` is undefined and the flat fallback
 *   answers exactly as before — no observable difference, and no test could
 *   have killed it. No writer produces that shape; the guard is there to say
 *   what "an object" means, not to change an answer.
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The five writers were found by searching every add/set into
 *   COLLECTIONS.LAND_LISTINGS across src, and each was read for what it stores
 *   under `location`. The failures above were reproduced against the real
 *   actions with the four rows seeded, BEFORE any repair — the flat row's
 *   {"success":false,"error":"Failed to fetch your listings"} and the string
 *   row's {"0":"5","1":" ","2":"R",…} are both transcripts, not predictions.
 */
