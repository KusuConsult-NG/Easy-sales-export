/**
 * Nigeria's bounding box, and the one question asked about it.
 *
 *   #868 A PURE RULE, OUT OF THE COMPONENT THAT NEEDED IT.
 *
 *   The box itself is not new — the listing form's own hint has always read
 *   "Nigeria bounds: Lat 4° to 14°N, Long 3° to 15°E". What was new is the
 *   location picker wanting to ACT on it, and the picker imports Leaflet, which
 *   touches `window` the moment it loads. That is why the form renders it with
 *   `ssr: false`, and it is also why the rule cannot live inside it: importing
 *   the component to test four numbers drags a map library and a DOM in behind
 *   them.
 *
 *   So the fact lives here, where anything may read it — a component, a server
 *   action validating a submitted coordinate, a test — and the picker is left
 *   holding only what genuinely needs a browser.
 *
 *   IT IS A SANITY CHECK, NOT A BOUNDARY. Nothing should REFUSE a coordinate on
 *   this: the box is a rectangle around a country that is not rectangular, so it
 *   admits parts of four neighbours and would reject a seller whose pin is
 *   fractionally outside it. It is here to catch a stray tap that landed in the
 *   Atlantic, which is a different thing from deciding where Nigeria is.
 */

export const NIGERIA_BOUNDS = {
    minLat: 4,
    maxLat: 14,
    minLng: 3,
    maxLng: 15,
} as const;

/** Roughly the centre, for a map that opens before anything is chosen. */
export const NIGERIA_CENTRE: readonly [number, number] = [9.0820, 8.6753];

/** Is this point plausibly in Nigeria? See the header for what "plausibly" buys. */
export function isWithinNigeria(lat: number, lng: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    return (
        lat >= NIGERIA_BOUNDS.minLat && lat <= NIGERIA_BOUNDS.maxLat
        && lng >= NIGERIA_BOUNDS.minLng && lng <= NIGERIA_BOUNDS.maxLng
    );
}
