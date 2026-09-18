/**
 * @jest-environment node
 */

/**
 *   #879 #880 THE LOCATION WAS WRITTEN NESTED AND READ FLAT, AND THE MAP
 *   ALWAYS OPENED IN THE SAME PLACE.
 *
 *   THE OWNER: "The location picker is hardcoding a location and on the form
 *   Admin can't see state and LGA, they are blank pages."
 *
 *   Two faults, and the second one I had already photographed without reading
 *   it: screenshot 09 of the admin verification panel shows the Location row
 *   rendering a bare "," — a comma with nothing on either side of it. I sent it
 *   to the owner as evidence that the panel worked.
 *
 * ── #879 ONE FILE, TWO SHAPES ───────────────────────────────────────────────
 *
 *   The listing form writes
 *
 *       location: { state, lga, address }
 *
 *   and the admin screen read `verification.state` and `verification.lga` at
 *   the TOP LEVEL — in the table column and again on the panel an admin
 *   approves from. Its own interface declares `location?: { state; lga;
 *   address }`, and line 124 of the same file already reads
 *   `selectedVerification.location?.address` correctly for the edit field.
 *
 *   So the file holds both readings, four lines apart, and the two that a
 *   person looks at to make a decision had the wrong one.
 *
 *   readLandLocation is #689's answer to precisely this — "one reader for four
 *   shapes", written because rows in this collection carry the location nested,
 *   flat, as a bare string, and as a geopoint. Not a new rule: an existing one
 *   that two render sites did not ask.
 *
 * ── #880 THE MAP WAS NOT HARDCODED, IT WAS UNMOVED ──────────────────────────
 *
 *   The picker writes no default — the marker follows the two number fields and
 *   there is no marker at all until there is a coordinate. What it did was open
 *   on NIGERIA_CENTRE at zoom 6 and stay there. A seller who had just chosen
 *   Kano and its LGA was shown the middle of the country.
 *
 *   From the seller's side that is indistinguishable from a hardcoded location,
 *   which is what the report calls it and why the report is right.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { readLandLocation, landLocationText } from '@/lib/land-location';

const ROOT = process.cwd();
const ADMIN = 'src/app/admin/farm-nation/land-verification/page.tsx';
const PICKER = 'src/components/farm-nation/LocationPicker.tsx';
const FORM = 'src/app/farm-nation/(member)/list-land/page.tsx';

const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

/** A row exactly as the listing form writes it. */
const AS_THE_FORM_WRITES_IT = {
    id: 'l-1',
    title: '2 hectares at Ugwuoba',
    location: { state: 'Enugu', lga: 'Oji River', address: 'Plot 4, Ugwuoba' },
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#879 — the admin reads the shape the form writes', () => {
    it('THE REPORTED DEFECT: the flat read returns nothing on a real row', () => {
        /*
         *   The defect itself, as a claim rather than a story. This is what the
         *   two render sites were doing, and it is why the column was empty and
         *   the panel showed ", ".
         */
        const row = AS_THE_FORM_WRITES_IT as Record<string, any>;

        expect(row.state).toBeUndefined();
        expect(row.lga).toBeUndefined();
        expect(`${row.state}, ${row.lga}`).toBe('undefined, undefined');
    });

    it('AND THE SHARED READER FINDS THEM', () => {
        const place = readLandLocation(AS_THE_FORM_WRITES_IT);

        expect(place.state).toBe('Enugu');
        expect(place.lga).toBe('Oji River');
        expect(landLocationText(AS_THE_FORM_WRITES_IT)).toContain('Enugu');
    });

    it('AND IT STILL READS A FLAT ROW — the older shape is not broken', () => {
        /*
         *   The collection is written by more than one door and #689 lists four
         *   shapes. A fix that read only the nested one would move the blank
         *   column to a different set of rows.
         */
        const place = readLandLocation({ state: 'Kano', lga: 'Dala', address: 'Km 4' });

        expect(place.state).toBe('Kano');
        expect(place.lga).toBe('Dala');
    });

    it('AND NEITHER ADMIN SITE READS THE TOP LEVEL ANY MORE', () => {
        const src = code(ADMIN);

        expect(src).not.toMatch(/\{verification\.state\}/);
        expect(src).not.toMatch(/\{verification\.lga\}/);
        expect(src).not.toMatch(/\{selectedVerification\.state\}/);
        expect(src).not.toMatch(/\{selectedVerification\.lga\}/);
    });

    it('AND BOTH GO THROUGH THE SHARED READER', () => {
        //   Named rather than counted: the table column a queue is scanned from
        //   AND the panel a listing is approved from.
        const src = code(ADMIN);

        expect(src).toContain('readLandLocation(verification).state');
        expect(src).toContain('readLandLocation(verification).lga');
        expect(src).toContain('landLocationText(selectedVerification)');
    });

    it('AND A ROW WITH NO LOCATION AT ALL SHOWS A DASH, not "undefined"', () => {
        /*
         *   Rows written by /api/farm-nation/create-listing store no `location`
         *   key — #689 records that, and it is the case that used to throw here.
         *   An admin should see that the field is empty, not the word undefined.
         */
        expect(readLandLocation({}).state).toBe('');
        expect(landLocationText({})).toBe('');
        expect(code(ADMIN)).toContain('landLocationText(selectedVerification) || "—"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#880 — the map opens where the seller said the land is', () => {
    it('THE REPORTED DEFECT: it used to open on one fixed point, always', () => {
        //   Still the INITIAL view, which is right — there is nowhere better to
        //   start before a state is chosen.
        const src = code(PICKER);

        expect(src).toContain('setView([...NIGERIA_CENTRE] as [number, number], 6)');
    });

    it('AND IT MOVES TO THE CHOSEN STATE', () => {
        const src = code(PICKER);

        expect(src).toContain('NIGERIAN_STATE_COORDINATES');
        expect(src).toContain('map.setView([sLat, sLng], 9)');
    });

    it('AND IT DEFERS TO A PIN THE SELLER HAS ALREADY PLACED', () => {
        /*
         *   The half that would make this worse than the defect. Re-centring
         *   after a pin exists would drag the seller away from the point they
         *   had just clicked, every time the state field changed.
         */
        const src = code(PICKER);
        const at = src.indexOf('const key = Object.keys(NIGERIAN_STATE_COORDINATES)');

        expect(at).toBeGreaterThan(-1);
        expect(src.slice(at - 200, at)).toContain('if (!map || hasPoint) return;');
    });

    it('AND THE FORM HANDS IT THE STATE IT ALREADY COLLECTED', () => {
        //   A prop the form never passes is a feature that does not exist.
        expect(code(FORM)).toContain('state={formData.state}');
    });

    it('AND THE STATE TABLE IS THE ONE THE PLATFORM ALREADY USES', () => {
        /*
         *   A second table of state centroids would be a second thing to keep
         *   correct, and the marketplace checkout already geocodes against this
         *   one.
         */
        const { NIGERIAN_STATE_COORDINATES } = require('@/lib/locations');

        expect(Object.keys(NIGERIAN_STATE_COORDINATES).length).toBeGreaterThan(30);
        expect(NIGERIAN_STATE_COORDINATES.Enugu).toBeDefined();
    });

    it('AND A STATE IT DOES NOT KNOW LEAVES THE VIEW ALONE', () => {
        //   Matched case-insensitively and by exact name; an unknown or empty
        //   value must not throw or jump the map somewhere arbitrary.
        const src = code(PICKER);
        const at = src.indexOf('const key = Object.keys(NIGERIAN_STATE_COORDINATES)');

        expect(src.slice(at, at + 300)).toContain('if (!key) return;');
        expect(src.slice(at, at + 300)).toContain('toLowerCase()');
    });
});
