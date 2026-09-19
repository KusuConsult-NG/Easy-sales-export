/**
 * IS THIS COORDINATE ANYWHERE NEAR THE STATE THE LISTING NAMES?
 *
 *   #899 "USE MY LOCATION" PINNED WHERE THE SELLER WAS STANDING.
 *
 *   THE OWNER: "when a user use the option of 'Use my location' and the product
 *   is in a different location, over-ride the 'use my location' with the
 *   location of the product so that the inspector doesn't get confused with the
 *   cordinates."
 *
 *   The button reads the device's GPS and drops the pin there. A seller in
 *   Lagos listing family land in Benue taps it and the listing is stamped with
 *   Lagos coordinates — while its own `state` field says Benue. An inspector is
 *   then dispatched by #866's flow to a pin a day's drive from the parcel.
 *
 *   The coordinate is the one field on the listing nobody can sanity-check by
 *   reading it. State and LGA are dropdowns and the address is prose; a pair of
 *   decimals looks equally plausible wherever it points.
 *
 * ── WHAT "NEAR" MEANS HERE, AND WHY IT IS DELIBERATELY LOOSE ────────────────
 *
 *   This is not a boundary test. There are no state polygons in this codebase —
 *   only NIGERIAN_STATE_COORDINATES, one centroid per state — and adding
 *   boundaries to answer this would be a second geography to keep correct,
 *   which is the argument LocationPicker already makes for using the centroids.
 *
 *   So the question asked is the weaker, sufficient one: IS THIS OBVIOUSLY
 *   SOMEWHERE ELSE? Nigeria's largest state is about 70,000 km²; as a circle
 *   that is a radius near 150 km. THRESHOLD_KM is 250, which no point inside
 *   any state exceeds from its own centroid, and which a neighbouring state's
 *   land may well satisfy.
 *
 *   That asymmetry is the right way round. A false "near" leaves the pin as the
 *   seller placed it, which is today's behaviour. A false "far" would move a
 *   correct pin — so the bar is set where only a real mismatch clears it.
 */

import { NIGERIAN_STATE_COORDINATES } from "./locations";

/**
 * How far from a state's centroid still counts as plausibly that state.
 *
 * See the header: no point inside any Nigerian state is further than this from
 * its own centroid, so a coordinate beyond it is somewhere else.
 */
export const THRESHOLD_KM = 250;

const EARTH_RADIUS_KM = 6371;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * The centroid of a named state, or null.
 *
 * NAMED AT LAST. lib/locations' own note says this lookup is "a helper waiting
 * to be named", written out at five call sites and not extracted because that
 * commit was a move. This is the sixth, so it is named here.
 */
export function stateCentre(state: unknown): { lat: number; lng: number } | null {
    const wanted = String(state ?? "").trim().toLowerCase();
    if (!wanted) return null;

    const key = Object.keys(NIGERIAN_STATE_COORDINATES)
        .find((s) => s.toLowerCase() === wanted);

    return key ? NIGERIAN_STATE_COORDINATES[key] : null;
}

/** Great-circle distance in kilometres. */
export function distanceKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
): number {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);

    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Is this point obviously not in the named state?
 *
 * FALSE WHENEVER THE QUESTION CANNOT BE ANSWERED — no state chosen, a state
 * this table does not carry, an unreadable coordinate. The caller's response to
 * `true` is to MOVE THE SELLER'S PIN, so "I don't know" must never be reported
 * as "you are wrong".
 */
export function isFarFromState(
    point: { lat: unknown; lng: unknown },
    state: unknown,
    thresholdKm: number = THRESHOLD_KM,
): boolean {
    const centre = stateCentre(state);
    if (!centre) return false;

    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    return distanceKm({ lat, lng }, centre) > thresholdKm;
}
