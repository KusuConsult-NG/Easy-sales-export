/**
 * Geocoding over OpenStreetMap — Nominatim.
 *
 *   THE OWNER: "For delivery address, we want to use openstreet map instead of
 *   google map."
 *
 *   #868 measured that both browse maps and the Farm Nation location picker
 *   were already Leaflet over OpenStreetMap, and checkout's route map
 *   (components/marketplace/CheckoutRouteMap) is too. WHAT WAS STILL GOOGLE IS
 *   THE DELIVERY ADDRESS, in four places: the Places Autocomplete on the street
 *   input, the geocoder for the typed address, the geocoder for the address
 *   saved on the profile, and the geocoder that placed each cart item's origin.
 *   All four are what this replaces.
 *
 * ── WHY THE CALL IS MADE ON THE SERVER ──────────────────────────────────────
 *
 *   Nominatim's usage policy requires a User-Agent that identifies the
 *   application. A browser cannot set one — `User-Agent` is a forbidden header
 *   for `fetch` — so a browser-side call is anonymous by construction and is
 *   the shape that gets an application blocked.
 *
 *   The policy also caps use at one request a second and asks that results be
 *   cached. A route handler can hold both; a component rendered in a thousand
 *   tabs cannot. So this module holds the URL, the headers and the parsing —
 *   everything except the fetch — and api/geocode makes the call.
 *
 * ── AND WHY AUTOCOMPLETE IS NOT SEARCH-AS-YOU-TYPE ──────────────────────────
 *
 *   The same policy says, in terms: do not use Nominatim for autocomplete. The
 *   Google control it replaces fired on every keystroke. The checkout input
 *   therefore searches on a deliberate action — a pause of at least
 *   SEARCH_DEBOUNCE_MS, or pressing Search — and never per character.
 */

import { isWithinNigeria } from "@/lib/nigeria-bounds";
import { NIGERIAN_LOCATIONS } from "@/lib/locations";

export const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

/**
 * Who is asking.
 *
 *   Required by the usage policy, and the thing that gets an application
 *   blocked when it is missing or generic. Overridable so a deployment can name
 *   its own host and contact address.
 */
export function nominatimUserAgent(
    env: Record<string, string | undefined> = process.env,
): string {
    return env.NOMINATIM_USER_AGENT
        || env.NEXT_PUBLIC_APP_URL
        || "EasySalesExport/1.0 (agricultural marketplace)";
}

/** How long to wait after typing stops before searching. See the header. */
export const SEARCH_DEBOUNCE_MS = 800;

/** The most results a single search may ask for. */
export const MAX_RESULTS = 5;

/**
 * The search URL for a free-text address.
 *
 *   `countrycodes=ng` is not decoration: this platform delivers within Nigeria,
 *   and without it "Main Street" returns a road in Ohio that would then be
 *   checked against the Nigeria bounds and silently dropped.
 */
export function nominatimSearchUrl(query: string, limit: number = MAX_RESULTS): string {
    const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        addressdetails: "1",
        countrycodes: "ng",
        limit: String(Math.max(1, Math.min(MAX_RESULTS, limit))),
    });
    return `${NOMINATIM_BASE}/search?${params.toString()}`;
}

/** One place Nominatim found. */
export interface GeocodeResult {
    lat: number;
    lng: number;
    /** The full name, for the suggestion list. */
    label: string;
    /** The parts the checkout form fills in, reconciled to this platform's own lists. */
    street: string;
    city: string;
    /** A state this platform knows, or "" — never Nominatim's spelling. */
    state: string;
    /** An LGA within that state, or "". */
    lga: string;
}

/**
 * A state this platform knows, from whatever the geocoder called it.
 *
 *   This rule was written inline inside the Google `place_changed` callback and
 *   nowhere else, so the manual verifier — the path most buyers actually take —
 *   never reconciled anything. It is here so both use it.
 *
 *   "Federal Capital Territory" and "Abuja" both mean FCT, which is the one
 *   case the exact match cannot cover and the one the callback special-cased.
 */
export function matchNigerianState(raw: unknown): string {
    if (typeof raw !== "string" || !raw.trim()) return "";

    const cleaned = raw.replace(/\s*state$/i, "").trim();
    const exact = Object.keys(NIGERIAN_LOCATIONS).find(
        (state) => state.toLowerCase() === cleaned.toLowerCase());
    if (exact) return exact;

    const lower = cleaned.toLowerCase();
    if (lower === "federal capital territory" || lower === "abuja") return "FCT";

    return "";
}

/**
 * An LGA within a known state, from whatever the geocoder called it.
 *
 *   The partial match is deliberate and was in the original: OSM writes "Jos
 *   North Local Government Area" where this platform's list says "Jos North".
 *   It is only ever consulted within ONE state's list, so it cannot reach
 *   across to a same-named LGA elsewhere.
 */
export function matchNigerianLga(state: string, raw: unknown): string {
    if (typeof raw !== "string" || !raw.trim()) return "";

    const list = NIGERIAN_LOCATIONS[state];
    if (!list) return "";

    const lower = raw.trim().toLowerCase();
    const exact = list.find((lga) => lga.toLowerCase() === lower);
    if (exact) return exact;

    return list.find((lga) =>
        lga.toLowerCase().includes(lower) || lower.includes(lga.toLowerCase())) || "";
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Nominatim's answer, as this platform's shape.
 *
 *   ANYTHING OUTSIDE NIGERIA IS DROPPED rather than returned and checked later:
 *   a delivery pin in the Atlantic prices a shipment the courier cannot make,
 *   and `countrycodes=ng` is a request, not a guarantee.
 */
export function parseNominatimResults(raw: unknown): GeocodeResult[] {
    if (!Array.isArray(raw)) return [];

    const results: GeocodeResult[] = [];

    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const row = entry as Record<string, unknown>;

        const lat = Number.parseFloat(str(row.lat));
        const lng = Number.parseFloat(str(row.lon));
        if (!isWithinNigeria(lat, lng)) continue;

        const address = (row.address && typeof row.address === "object"
            ? row.address : {}) as Record<string, unknown>;

        const state = matchNigerianState(address.state);
        //   OSM files an LGA under `county` in most of Nigeria and under
        //   `city`/`municipality` in a few. Both are tried before giving up,
        //   because an unmatched LGA leaves the form's dependent select empty.
        const lga = matchNigerianLga(state, address.county)
            || matchNigerianLga(state, address.city)
            || matchNigerianLga(state, address.municipality);

        const houseNumber = str(address.house_number);
        const road = str(address.road);
        const street = [houseNumber, road].filter(Boolean).join(" ")
            || str(row.name)
            || str(row.display_name).split(",")[0]?.trim()
            || "";

        results.push({
            lat,
            lng,
            label: str(row.display_name) || street,
            street,
            city: str(address.city) || str(address.town) || str(address.village)
                || str(address.suburb) || lga,
            state,
            lga,
        });
    }

    return results;
}
