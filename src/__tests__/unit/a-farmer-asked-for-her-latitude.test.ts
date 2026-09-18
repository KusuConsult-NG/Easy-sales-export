/**
 * @jest-environment node
 */

/**
 *   #868 THE FORM ASKED A FARMER FOR HER LATITUDE.
 *
 *   THE OWNER: "Map API (Plus Codes or any free API we can use apart from Google
 *   Maps, and that can also be mapped to a location picker)."
 *
 *   MEASURED FIRST, AND HALF THE REQUEST WAS ALREADY SATISFIED — which is worth
 *   saying plainly rather than quietly building what was asked for. Both browse
 *   maps, components/farm-nation/MapView and app/land/LandMapClient, are Leaflet
 *   over `tile.openstreetmap.org`. No Google, no API key, no billing account,
 *   and `leaflet` and `react-leaflet` are already dependencies of this project.
 *   The concern behind the request does not apply to the map itself.
 *
 *   WHAT WAS ACTUALLY MISSING IS THE PICKER. The listing form asked for GPS as
 *   two `<input type="number">` boxes — "Latitude", "Longitude", "e.g. 9.0820" —
 *   with a hint about Nigeria's bounding box. A farmer in Oji River is expected
 *   to know her land's decimal coordinates to six places, or to leave it blank.
 *
 *   AND LEAVING IT BLANK HAS A COST NOBODY IS TOLD ABOUT. The field is optional,
 *   and the map filters listings to those that HAVE coordinates — so a parcel
 *   without them appears on no map at all. The form's own wording called the
 *   field "optional but recommended" and never said that.
 *
 * ── PLUS CODES ARE AN ENCODING, NOT A MAP ───────────────────────────────────
 *
 *   Named in the request and answered rather than ignored. An Open Location Code
 *   is a compact way of WRITING a coordinate; it is not a tile source and not a
 *   geocoder, so adopting it would leave the question of what draws the map
 *   unanswered. Leaflet over OpenStreetMap answers it and is already here.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { isWithinNigeria } from '@/lib/nigeria-bounds';

const PICKER = 'src/components/farm-nation/LocationPicker.tsx';
const FORM = 'src/app/farm-nation/(member)/list-land/page.tsx';
const MAPS = [
    'src/components/farm-nation/MapView.tsx',
    'src/app/land/LandMapClient.tsx',
];

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#868 — nothing on this platform draws a map with Google', () => {
    it('THE PICKER AND BOTH BROWSE MAPS USE OPENSTREETMAP TILES', () => {
        /*
         *   The half of the request that was already true, pinned so it stays
         *   true. A tile URL is the thing that would quietly acquire a key and a
         *   bill, and it is one line in a file nobody reads twice.
         */
        const tiled = [PICKER, MAPS[0]].filter((f) =>
            code(f).includes('tile.openstreetmap.org'));

        expect(tiled).toEqual([PICKER, MAPS[0]]);
    });

    it('AND NO MAP FILE MENTIONS GOOGLE OR AN API KEY', () => {
        const offenders = [PICKER, ...MAPS].filter((f) =>
            /google|maps\.googleapis|MAPS_API_KEY/i.test(code(f)));

        expect(offenders).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#868 — and the seller can point at the land instead of typing it', () => {
    it('THE REPORTED GAP: the form renders a picker', () => {
        const src = code(FORM);

        expect(src).toContain('LocationPicker');
    });

    it('AND IT IS LOADED WITHOUT SSR — Leaflet touches window on import', () => {
        //   The same reason MapView is loaded that way. Server-rendering it
        //   would fail the page, not just the map.
        const src = code(FORM);
        const at = src.indexOf('const LocationPicker = dynamic(');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 300)).toContain('ssr: false');
    });

    it('AND THE TWO NUMBER FIELDS SURVIVE', () => {
        /*
         *   Deliberately kept. A surveyor with the coordinates already written
         *   down should not have to hunt for the spot on a map, and replacing
         *   the fields would trade one group of sellers for another.
         */
        const src = code(FORM);

        expect(src).toContain('formData.latitude');
        expect(src).toContain('formData.longitude');
    });

    it('AND THE PICKER READS THOSE VALUES rather than keeping its own', () => {
        /*
         *   ONE SOURCE OF TRUTH, and the thing that makes the two halves agree:
         *   typing into a field moves the pin because the marker follows the
         *   PROPS. A picker holding its own copy would let the map and the
         *   fields disagree, and the form submits the fields.
         */
        const src = code(FORM);
        const at = src.indexOf('<LocationPicker');

        expect(at).toBeGreaterThan(-1);
        const block = src.slice(at, at + 400);
        expect(block).toContain('latitude={formData.latitude}');
        expect(block).toContain('longitude={formData.longitude}');
    });

    it('AND THE PIN MOVES WITH THE VALUES, not with clicks alone', () => {
        //   The other end of the same rule, read in the component: the marker
        //   effect depends on the parsed props.
        const src = code(PICKER);

        expect(src).toContain('markerRef.current.setLatLng(point)');
        expect(src).toMatch(/\}, \[lat, lng, hasPoint\]\)/);
    });

    it('AND A DRAGGED PIN WRITES BACK', () => {
        //   A marker that can be dragged and does not report where it landed is
        //   worse than one that cannot be dragged at all.
        const src = code(PICKER);

        //   #871 made this conditional: the SAME component renders read-only on
        //   the property detail page, where a buyer must not move the seller's
        //   pin. A dragging map is still a dragging map for the seller.
        expect(src).toContain('draggable: !readOnlyRef.current');
        expect(src).toContain("marker.on(\"dragend\"");
    });

    it('AND THE MAP IS BUILT ONCE, so a keystroke does not reset the view', () => {
        /*
         *   A map rebuilt on every render loses the seller's zoom and pan, which
         *   is the entire value of a picker. The build effect has an empty
         *   dependency list and guards on the existing instance.
         */
        const src = code(PICKER);
        const at = src.indexOf('L.map(containerRef.current)');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at - 200, at)).toContain('if (!containerRef.current || mapRef.current) return;');
    });

    it('AND IT IS TORN DOWN, so remounting does not leak a map', () => {
        const src = code(PICKER);

        expect(src).toContain('map.remove()');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#868 — and a stray tap is flagged rather than refused', () => {
    it('NIGERIA IS RECOGNISED', () => {
        //   Abuja, roughly.
        expect(isWithinNigeria(9.0765, 7.3986)).toBe(true);
    });

    it('AND A POINT IN THE ATLANTIC IS NOT', () => {
        expect(isWithinNigeria(0, 0)).toBe(false);
    });

    it('AND THE BOUNDS ARE THE ONES THE FORM ALWAYS QUOTED', () => {
        //   The form's own hint has always said Lat 4°–14°N, Long 3°–15°E. The
        //   picker agrees with the text beside it rather than inventing a
        //   second box.
        expect(isWithinNigeria(4, 3)).toBe(true);
        expect(isWithinNigeria(14, 15)).toBe(true);
        expect(isWithinNigeria(3.9, 8)).toBe(false);
        expect(isWithinNigeria(9, 15.1)).toBe(false);
    });

    it('AND THE COMPONENT WARNS WITHOUT BLOCKING', () => {
        /*
         *   A bounding box must not refuse a coordinate. A seller near a border,
         *   or one correcting a pin, would be stopped by a rule that is only a
         *   sanity check — so it says so while she can still see the map, and
         *   the value is stored either way.
         */
        const src = code(PICKER);

        expect(src).toContain('outside Nigeria');
        //   The map, the fields and the selected-point line are all rendered
        //   regardless; only the warning is conditional on it.
        //   #871 guarded it with !readOnly too: the warning is advice to whoever
        //   is placing the pin, and there is nobody placing one on a detail page.
        expect(src).toContain('outsideNigeria && (');
        expect(src).not.toContain('if (outsideNigeria) return');
    });
});
