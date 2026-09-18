/**
 * @jest-environment node
 */

/**
 *   #871 THE PIN SHE DROPPED SHOWED NOBODY ANYTHING.
 *
 *   THE OWNER: "where users have coordinates of latitude and longitude, the map
 *   picks the location and display it on the details (can this be done)."
 *
 *   It can, and it was not there. The property detail page — the one screen a
 *   buyer reads before committing money to a parcel — never mentioned
 *   `gpsCoordinates` at all. A seller who took the trouble to place her land on
 *   the map, which #868 had just made possible, showed a buyer a state, an LGA
 *   and a line of address.
 *
 * ── THE TYPE SYSTEM WAS ENFORCING THE DEFECT ────────────────────────────────
 *
 *   `LandListing` never declared `gpsCoordinates`, and the submit action has
 *   written it since long before today. So every consumer typed as LandListing
 *   was told the field does not exist: a reader could not render it without a
 *   cast, and a cast is what somebody reaches for instead of asking why.
 *
 *   A stored field nothing can read is #624's defect, arriving here through the
 *   declaration rather than through the screen.
 *
 * ── ONE MAP, NOT TWO ────────────────────────────────────────────────────────
 *
 *   The detail page renders the SAME component the seller placed the pin with,
 *   in read-only mode. A separate PropertyMap would be a second copy of the
 *   tiles, the marker, the centring and the teardown — and the tile URL is
 *   exactly the line #868 established should exist once, because it is the line
 *   that would quietly acquire a Google key and a bill.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const DETAILS = 'src/app/farm-nation/property/[id]/PropertyDetailsClient.tsx';
const PICKER = 'src/components/farm-nation/LocationPicker.tsx';
const ACTION = 'src/app/actions/land-listings.ts';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
describe('#871 — the buyer sees where the land is', () => {
    it('THE REPORTED GAP: the detail page renders a map', () => {
        const src = code(DETAILS);

        expect(src).toContain('PropertyLocationMap');
        expect(src).toContain('gpsCoordinates');
    });

    it('AND ONLY WHEN THERE IS A COORDINATE TO SHOW', () => {
        /*
         *   An empty map centred on the middle of Nigeria says "this land is
         *   somewhere in Nigeria", which is worse than no map — it looks like
         *   information.
         */
        const src = code(DETAILS);
        const at = src.indexOf('PropertyLocationMap\n');

        expect(src).toContain('typeof property.gpsCoordinates?.latitude === "number"');
        expect(src).toContain('typeof property.gpsCoordinates?.longitude === "number"');
        expect(at).toBeGreaterThan(-1);
    });

    it('AND IT IS LOADED WITHOUT SSR — Leaflet touches window on import', () => {
        const src = code(DETAILS);
        const at = src.indexOf('const PropertyLocationMap = dynamic(');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at, at + 400)).toContain('ssr: false');
    });

    it('AND THE TYPE DECLARES THE FIELD, so a reader can see it without a cast', () => {
        /*
         *   THE HALF THAT MADE THIS INVISIBLE. The action wrote gpsCoordinates
         *   and the interface did not name it, so TypeScript told every consumer
         *   the field was not there.
         */
        expect(code(ACTION))
            .toContain('gpsCoordinates?: { latitude: number; longitude: number }');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#871 — and it is the same map, not a second one', () => {
    it('THE DETAIL PAGE IMPORTS THE PICKER', () => {
        expect(code(DETAILS)).toContain('@/components/farm-nation/LocationPicker');
    });

    it('AND THERE IS STILL EXACTLY ONE TILE SOURCE IN THE TREE', () => {
        /*
         *   #868's rule, re-checked because this finding is the obvious moment
         *   to break it. A second map component would be a second tile URL, and
         *   that is the line that would quietly acquire a Google key.
         */
        const { readdirSync, statSync } = require('fs') as typeof import('fs');
        const ROOT = join(process.cwd(), 'src');

        const walk = (dir: string, out: string[] = []): string[] => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (!full.includes('__tests__')) walk(full, out);
                } else if (/\.tsx?$/.test(full) && !full.includes('.test.')) {
                    out.push(full);
                }
            }
            return out;
        };

        const tiled = walk(ROOT)
            .filter((f) => /L\.tileLayer\(/.test(
                stripComments(readFileSync(f, 'utf8'), { label: f })))
            .map((f) => f.slice(process.cwd().length + 1))
            .sort();

        //   The picker (now also the detail map) and the browse map. Two, and
        //   both on OpenStreetMap — asserted by name so a third is a decision
        //   somebody has to make deliberately.
        expect(tiled).toEqual([
            'src/components/farm-nation/LocationPicker.tsx',
            'src/components/farm-nation/MapView.tsx',
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#871 — and read-only really is read-only', () => {
    it('A READ-ONLY MAP BINDS NO CLICK HANDLER', () => {
        /*
         *   Not cosmetic. A buyer clicking the map on a detail page must do
         *   nothing at all rather than silently move a pin she cannot save and
         *   then see coordinates that are not the seller's.
         */
        const src = code(PICKER);
        const at = src.indexOf('map.on("click"');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at - 120, at)).toContain('if (!readOnlyRef.current) {');
    });

    it('AND THE PIN CANNOT BE DRAGGED', () => {
        expect(code(PICKER)).toContain('draggable: !readOnlyRef.current');
    });

    it('AND THE EDITING CONTROLS ARE NOT RENDERED', () => {
        //   "Use my location" on a page where nothing can be saved is a button
        //   that appears to do something and does not.
        const src = code(PICKER);

        expect(src).toContain('{!readOnly && (');
        expect(src).toContain('{!readOnly && outsideNigeria && (');
    });

    it('AND THE FLAG IS READ THROUGH A REF, like the change handler', () => {
        /*
         *   The build effect runs once, so a value it reads has to be held the
         *   same way `onChange` is — otherwise the map is built with whatever
         *   the first render happened to pass and never notices a change.
         */
        const src = code(PICKER);

        expect(src).toContain('const readOnlyRef = useRef(readOnly)');
        expect(src).toContain('readOnlyRef.current = readOnly;');
    });
});
