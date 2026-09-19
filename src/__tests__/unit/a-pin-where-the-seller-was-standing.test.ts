/**
 * @jest-environment node
 */

/**
 *   #899 "USE MY LOCATION" PINNED WHERE THE SELLER WAS STANDING.
 *
 *   THE OWNER: "when a user use the option of 'Use my location' and the product
 *   is in a different location, over-ride the 'use my location' with the
 *   location of the product so that the inspector doesn't get confused with the
 *   cordinates."
 *
 *   The button read the device's GPS and dropped the pin there, full stop. A
 *   seller in Lagos listing family land in Benue stamped the listing with Lagos
 *   — while its own `state` field said Benue — and #866's flow then dispatches
 *   an inspector to the pin.
 *
 *   THE COORDINATE IS THE ONE FIELD NOBODY CAN SANITY-CHECK BY READING IT.
 *   State and LGA are dropdowns and the address is prose; a pair of decimals
 *   looks equally plausible wherever it points. Nothing downstream would have
 *   caught it, which is why the inspector is the one who finds out.
 *
 * ── THE TEST IS DELIBERATELY LOOSE, AND THAT DIRECTION IS THE POINT ─────────
 *
 *   There are no state polygons here — only one centroid per state — and adding
 *   boundaries would be a second geography to keep correct, which is the
 *   argument LocationPicker already makes for using the centroids.
 *
 *   So the question asked is the weaker, sufficient one: is this OBVIOUSLY
 *   somewhere else? A false "near" leaves the pin as the seller placed it,
 *   which is today's behaviour. A false "far" would move a CORRECT pin. The
 *   threshold is set where only a real mismatch clears it, and every
 *   "I cannot tell" answers near.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    stateCentre, distanceKm, isFarFromState, THRESHOLD_KM,
} from '@/lib/state-proximity';
import { NIGERIAN_STATE_COORDINATES } from '@/lib/locations';

const PICKER = 'src/components/farm-nation/LocationPicker.tsx';
const code = () => stripComments(readFileSync(join(process.cwd(), PICKER), 'utf8'), { label: PICKER });

const LAGOS = NIGERIAN_STATE_COORDINATES['Lagos'];
const BORNO = NIGERIAN_STATE_COORDINATES['Borno'];

// ─────────────────────────────────────────────────────────────────────────────
describe('#899 — a device in the wrong state is recognised', () => {
    it('THE REPORTED CASE: standing in Lagos while listing land in Benue', () => {
        expect(isFarFromState(LAGOS, 'Benue')).toBe(true);
    });

    it('AND THE OTHER END OF THE COUNTRY, which is the everyday version', () => {
        expect(isFarFromState(LAGOS, 'Borno')).toBe(true);
        expect(isFarFromState(BORNO, 'Lagos')).toBe(true);
    });

    it('AND STANDING ON THE LAND IS NOT AN OVERRIDE — the control', () => {
        /*
         *   The half that would make this a defect rather than a fix. A seller
         *   who IS at the parcel must keep the precise pin she just captured.
         */
        for (const [state, centre] of Object.entries(NIGERIAN_STATE_COORDINATES)) {
            expect({ state, far: isFarFromState(centre, state) })
                .toEqual({ state, far: false });
        }
    });

    it('AND A POINT ANYWHERE INSIDE A STATE IS STILL "NEAR"', () => {
        //   ~100km off the centroid in each direction — well inside any state,
        //   and comfortably under the threshold.
        const near = { lat: LAGOS.lat + 0.9, lng: LAGOS.lng + 0.9 };

        expect(distanceKm(near, LAGOS)).toBeLessThan(THRESHOLD_KM);
        expect(isFarFromState(near, 'Lagos')).toBe(false);
    });

    it('AND "I CANNOT TELL" NEVER MOVES THE PIN', () => {
        /*
         *   The response to `true` is to MOVE THE SELLER'S PIN, so an unknown
         *   state, an unlisted one or an unreadable coordinate must answer
         *   false. This is the property that keeps the feature from doing harm
         *   when its inputs are missing.
         */
        for (const state of [undefined, null, '', '   ', 'Atlantis', 42]) {
            expect({ state, far: isFarFromState(LAGOS, state) })
                .toEqual({ state, far: false });
        }
        for (const point of [{ lat: NaN, lng: 3 }, { lat: 'x', lng: 'y' }, { lat: undefined, lng: undefined }]) {
            expect({ point, far: isFarFromState(point as any, 'Lagos') })
                .toEqual({ point, far: false });
        }
    });

    it('AND THE THRESHOLD CLEARS THE LARGEST STATE — the reason for 250km', () => {
        /*
         *   Nigeria's largest state is about 70,000 km²; as a circle that is a
         *   radius near 150 km. If this number is ever lowered below that, a
         *   correct pin at the edge of a big state starts being moved.
         */
        expect(THRESHOLD_KM).toBeGreaterThanOrEqual(150);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#899 — and the centroid lookup is named at last', () => {
    it('IT RESOLVES A STATE, CASE AND SPACE INSENSITIVELY', () => {
        //   lib/locations' own note calls this "a helper waiting to be named",
        //   written out at five call sites. This is the sixth.
        expect(stateCentre('Lagos')).toEqual(LAGOS);
        expect(stateCentre('  lagos  ')).toEqual(LAGOS);
        expect(stateCentre('AKWA IBOM')).toEqual(NIGERIAN_STATE_COORDINATES['Akwa Ibom']);
    });

    it('AND ANSWERS null FOR ANYTHING IT DOES NOT CARRY', () => {
        for (const bad of ['', '   ', 'Atlantis', null, undefined, 7]) {
            expect({ bad, centre: stateCentre(bad) }).toEqual({ bad, centre: null });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#899 — and the picker applies it', () => {
    it('THE OVERRIDE: the state centre replaces the device position', () => {
        const src = code();
        const at = src.indexOf('const useMyLocation');

        expect(at).toBeGreaterThan(-1);
        const body = src.slice(at, at + 900);

        expect(body).toContain('isFarFromState(here, stateRef.current)');
        expect(body).toContain('fmt(centre.lat)');
    });

    it('AND THE SELLER IS TOLD THE PIN MOVED', () => {
        //   A silent override is the same class of defect as the wrong
        //   coordinate: she cannot tell what the listing will carry.
        const src = code();

        expect(src).toContain('overrodeLocation');
        expect(src).toContain('Your device is not in');
    });

    it('AND THE STATE IS READ THROUGH A REF, like onChange beside it', () => {
        /*
         *   The geolocation callback is created when the button is pressed and
         *   resolves later. Reading `state` directly would capture whatever it
         *   was at the last render, which is the bug the file already solved
         *   once for onChange.
         */
        const src = code();

        expect(src).toContain('const stateRef = useRef(state)');
        expect(src).toContain('stateRef.current = state');
    });
});
