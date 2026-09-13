/**
 *   #689 ONE COLLECTION, FOUR SHAPES FOR `location`.
 *
 *   LAND_LISTINGS has five writers and they do not agree on where a plot is:
 *
 *     land-actions.ts::createLandListing
 *         location: { state, lga, address, lat, lng, geopoint }
 *
 *     land-listings.ts  (two writers)
 *         location: { state, lga, address }              — no coordinates
 *
 *     farm-nation/_fn_listings.ts::createFarmNationListing
 *         location: "5 Riverside, Jos"                   — a STRING,
 *         state / lga flat on the row                      per its own schema
 *
 *     api/farm-nation/create-listing
 *         no `location` AT ALL — state / lga / address flat on the row,
 *         with gpsCoordinates: { latitude, longitude }
 *
 *   THE THREE READERS IN land-actions.ts ASSUMED THE FIRST SHAPE:
 *
 *       lat: data.location.geopoint?.latitude || data.location.lat
 *
 *   `data.location` is undefined for anything the API route wrote, so that is a
 *   TypeError — thrown inside the `.map()`, caught by the function's own
 *   try/catch, and returned as "Failed to fetch your listings".
 *
 *   ONE BAD ROW LOSES THE WHOLE PAGE, measured rather than reasoned about:
 *
 *     getMyLandListings   one location-less row → the member's entire listing
 *                         page fails, their good listings included
 *     getLandListing      that listing's own page fails
 *     getLandListings     the ADMIN REVIEW QUEUE reads this with
 *                         status: 'pending_verification', which is exactly the
 *                         status the API route writes — so one listing created
 *                         through it stops every listing from being reviewable
 *
 *   And the STRING shape does not throw, it garbles: `{ ...("5 Riverside") }`
 *   spreads a string into character keys, so the address reached the caller as
 *   `{ "0": "5", "1": " ", "2": "R", … }`.
 *
 *   THE SCREENS ALREADY KNEW. FarmNationDashboardClient, CheckoutClient and
 *   PropertyDetailsClient each carry their own
 *   `typeof location === "object" ? … : …` — three hand-maintained copies of a
 *   contract nobody had written down, which is this audit's fourth recurring
 *   class. my-properties/page.tsx has no copy and renders ", " for a string.
 *
 *   SO IT IS WRITTEN DOWN HERE, ONCE. Readers normalise through
 *   `readLandLocation`; screens render through `landLocationText`. Both accept
 *   every shape above, including rows already in the database — which is why
 *   the repair is at the READ. Nothing on this platform rewrites a member's
 *   records to tidy a schema, and it does not need to: a reader that
 *   understands what is there costs one function and works on history.
 *
 *   The writers are brought into line too, but ADDITIVELY — see the notes at
 *   each one. Nothing they wrote before is removed.
 */

export interface LandLocation {
    state: string;
    lga: string;
    address: string;
    /** null when the row carries no coordinates, which most of them do not. */
    lat: number | null;
    lng: number | null;
    /**
     *   ANY OTHER KEY THE ROW'S OWN `location` OBJECT CARRIED.
     *
     *   Not decoration. `landListingSchema` records a `city`, and
     *   _getLandListings filters on `listing.location.city` — so a normaliser
     *   that returned only the five fields it names would silently break the
     *   city filter on the land search. The first version of this did exactly
     *   that, and no test covered that filter to say so.
     *
     *   The rule is: normalise what the shapes disagree about, and pass
     *   through what they do not.
     */
    [key: string]: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A finite number, or null. `0` is a real coordinate and survives. */
const num = (...vs: unknown[]): number | null => {
    for (const v of vs) {
        const n = typeof v === "string" ? Number(v) : v;
        if (typeof n === "number" && Number.isFinite(n)) return n;
    }
    return null;
};

/** True for a plain object — not a string, not an array, not null. */
const isObj = (v: unknown): v is Record<string, any> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

/**
 *   Where this plot is, whichever writer created the row.
 *
 *   NEVER THROWS AND NEVER READS THROUGH AN ASSUMED OBJECT. That is the whole
 *   point: the old expression `data.location.geopoint?.latitude` guarded the
 *   geopoint and not the location, so the optional chain protected the half
 *   that was always present.
 */
export function readLandLocation(row: Record<string, any> | null | undefined): LandLocation {
    const data = isObj(row) ? row : {};
    const loc = data.location;
    const obj = isObj(loc) ? loc : {};

    //   A string `location` IS the address — that is what the Farm Nation
    //   schema calls it (`z.string().min(2, "Location address is required")`).
    const fromString = typeof loc === "string" ? loc.trim() : "";

    return {
        //   Whatever the object carried — `city`, and anything a future writer
        //   adds — kept, then overridden by the normalised fields below.
        ...obj,
        state: str(obj.state) || str(data.state),
        lga: str(obj.lga) || str(data.lga),
        address: str(obj.address) || fromString || str(data.address),
        lat: num(obj.geopoint?.latitude, obj.lat, data.gpsCoordinates?.latitude, data.latitude),
        lng: num(obj.geopoint?.longitude, obj.lng, data.gpsCoordinates?.longitude, data.longitude),
    };
}

/**
 *   The one-line address a card or a header shows.
 *
 *   Replaces three hand-written copies on the Farm Nation screens, which each
 *   built their own "address, lga, state" from their own idea of the shape and
 *   then stripped the stray commas an empty part leaves behind. Built from the
 *   parts that exist instead, so there are no stray commas to strip.
 */
export function landLocationText(row: Record<string, any> | null | undefined): string {
    const { address, lga, state } = readLandLocation(row);
    return [address, lga, state].filter(Boolean).join(", ");
}
