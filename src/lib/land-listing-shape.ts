/**
 * Turn a stored LAND_LISTINGS row into the shape the screens read.
 *
 * "WHEN THEY CLICK ON MY PROPERTIES NOTHING IS SHOWN."
 *
 * Not an empty list. A crash, reported as an empty list.
 *
 * land-actions.ts normalised every row it read with this expression, written
 * three times — once in the browse catalogue, once in the detail reader, once
 * in My Properties:
 *
 *     location: {
 *         ...data.location,
 *         lat: data.location.geopoint?.latitude || data.location.lat,
 *         lng: data.location.geopoint?.longitude || data.location.lng,
 *     },
 *
 * `data.location.geopoint` is not guarded. It assumes every row in the
 * collection has a `location` object. FOUR THINGS WRITE TO THAT COLLECTION AND
 * ONE OF THEM DOES NOT:
 *
 *   land-actions._createLandListing        location: { lat, lng, city, state, geopoint }
 *   land-listings.submitLandListingAction  location: { state, lga, address }   ← the live one
 *   farm-nation._listPropertyAction        location: <whatever the form sent>
 *   api/farm-nation/create-listing         NO location key — state, lga, address
 *                                          and gpsCoordinates, flat on the row
 *
 * So `data.location` is `undefined`, `.geopoint` throws TypeError, and the
 * throw happens inside `snapshot.docs.map(...)` — INSIDE the try, OUTSIDE any
 * per-row protection. One row written by that route does not vanish from the
 * list. It takes the entire list down with it:
 *
 *   getMyLandListings  → { success: false, error: "Failed to fetch your listings" }
 *   getLandListings    → { success: false, error: "Failed to fetch land listings" }
 *   getLandListing     → { success: false, error: "Failed to fetch listing" }
 *
 * all three executed against a seeded route-created row before this module
 * existed. An owner with four good listings and one made through that route
 * saw none of the five. And getLandListings is the PUBLIC browse catalogue and
 * the /land/verify queue — the queue being precisely where a route-created
 * listing sits, since that route writes `status: "pending_verification"`. One
 * such row empties the catalogue for everybody and empties the queue for the
 * admin who would have fixed it.
 *
 * THE SIBLING READER WAS NEVER AFFECTED. farm-nation/_fn_listings.ts's
 * getMyPropertiesAction reads the same collection for the same owner through
 * `serializeDocs`, which spreads whatever is there. Executed on both rows, it
 * returns both. Two readers of one collection, one of which assumes a shape the
 * collection does not guarantee — the same fault this codebase keeps producing,
 * and the reason this normaliser is one function and not a fourth copy.
 *
 * WHAT IT RECOVERS, RATHER THAN MERELY SURVIVING
 * ----------------------------------------------
 * A row from that route does carry its location: in `state`, `lga`, `address`
 * and `gpsCoordinates` at the top level. Defaulting `location` to `{}` would
 * stop the crash and show the owner a listing with no location on it. So the
 * flat fields are folded back into `location` when the object is missing them,
 * and coordinates are read from `geopoint`, from flat `lat`/`lng`, or from
 * `gpsCoordinates.latitude`/`.longitude` — the three spellings the four writers
 * use between them.
 *
 * Nothing here widens what is returned: it is the same fields, from the same
 * document, in the shape the readers already declared they wanted.
 */

/** The location shape every screen reads, plus the coordinates the map needs. */
export interface NormalisedLandLocation {
    state?: string;
    lga?: string;
    city?: string;
    address?: string;
    lat?: number;
    lng?: number;
    [key: string]: unknown;
}

type Row = Record<string, any> | null | undefined;

function firstNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return undefined;
}

function firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === "string" && value.length > 0) return value;
    }
    return undefined;
}

/**
 * The `location` object for a row, whichever writer made it.
 *
 * Never throws and never returns undefined: a caller spreading this into a
 * listing gets an object in every case.
 */
export function normaliseLandLocation(data: Row): NormalisedLandLocation {
    const raw = (data?.location && typeof data.location === "object" ? data.location : {}) as Record<string, any>;
    const gps = (data?.gpsCoordinates && typeof data.gpsCoordinates === "object" ? data.gpsCoordinates : {}) as Record<string, any>;
    const geopoint = (raw.geopoint && typeof raw.geopoint === "object" ? raw.geopoint : {}) as Record<string, any>;

    const location: NormalisedLandLocation = { ...raw };

    // The flat fields the create-listing route writes, folded in only where the
    // object does not already say it. The object wins: it is the more specific
    // record, and three of the four writers fill it.
    const state = firstString(raw.state, data?.state);
    if (state !== undefined) location.state = state;
    const lga = firstString(raw.lga, data?.lga);
    if (lga !== undefined) location.lga = lga;
    const address = firstString(raw.address, data?.address);
    if (address !== undefined) location.address = address;

    const lat = firstNumber(geopoint.latitude, raw.lat, gps.latitude, data?.lat);
    if (lat !== undefined) location.lat = lat;
    const lng = firstNumber(geopoint.longitude, raw.lng, gps.longitude, data?.lng);
    if (lng !== undefined) location.lng = lng;

    return location;
}

/**
 * A stored timestamp as an ISO string.
 *
 * The adapter converts ISO strings back to Timestamp objects on read, so
 * `.toDate()` is normally there — but the three readers called it as
 * `(data.createdAt as Timestamp)?.toDate()`, where the `?.` guards the field
 * and not the method. A row holding a plain string or a Date would have thrown
 * the same way `location` did. This asks what the value IS.
 */
export function landTimestampToIso(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof (value as any)?.toDate === "function") {
        const date = (value as any).toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
}

/**
 * The whole normalisation the three readers each open with.
 *
 * `createdAt` / `updatedAt` fall back to now when the row carries none, which
 * is what the three copies did — a listing with no timestamp sorts and renders
 * rather than disappearing.
 */
export function normaliseLandListingRow<T>(id: string, data: Row): T {
    const now = new Date().toISOString();
    return {
        ...(data ?? {}),
        id,
        location: normaliseLandLocation(data),
        createdAt: landTimestampToIso(data?.createdAt) ?? now,
        updatedAt: landTimestampToIso(data?.updatedAt) ?? now,
        verifiedAt: landTimestampToIso(data?.verifiedAt),
    } as unknown as T;
}
