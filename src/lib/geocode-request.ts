/**
 * The browser's side of api/geocode.
 *
 *   One client, so every caller gets the same abort handling and the same
 *   "what do we do when the service is down" answer. The shape mirrors
 *   lib/upload-request, which is the existing convention for talking to one of
 *   this platform's own routes from a component.
 *
 *   NOTHING HERE TALKS TO NOMINATIM DIRECTLY. See lib/nominatim for why that
 *   would be the wrong shape regardless of how convenient it looks.
 */

import type { GeocodeResult } from "@/lib/nominatim";

export type { GeocodeResult };

export interface GeocodeOutcome {
    results: GeocodeResult[];
    /**
     * Why there are no results, when that is a FAILURE rather than an answer.
     *
     *   `null` with an empty list means the service answered and found nothing,
     *   which is a real answer the form should say out loud. A message means
     *   the lookup did not happen — the caller should fall back rather than
     *   tell a buyer her address does not exist.
     */
    error: string | null;
}

const EMPTY: GeocodeResult[] = [];

/**
 * Look up an address.
 *
 *   Never throws. Every caller here is inside a form a buyer is typing into,
 *   and there is an offline fallback behind all of them
 *   (NIGERIAN_STATE_COORDINATES), so an exception would only ever turn a
 *   degraded field into a blank screen.
 */
export async function geocodeAddress(
    query: string,
    options: { signal?: AbortSignal; limit?: number } = {},
): Promise<GeocodeOutcome> {
    const trimmed = query.trim();
    if (!trimmed) return { results: EMPTY, error: null };

    const params = new URLSearchParams({ q: trimmed });
    if (options.limit) params.set("limit", String(options.limit));

    try {
        const response = await fetch(`/api/geocode?${params.toString()}`, {
            signal: options.signal,
            headers: { Accept: "application/json" },
        });

        const body = await response.json().catch(() => null) as
            { results?: GeocodeResult[]; error?: string } | null;

        if (!response.ok) {
            return {
                results: EMPTY,
                error: body?.error
                    || (response.status === 429
                        ? "Too many address lookups. Please wait a moment and try again."
                        : "The address service is unavailable."),
            };
        }

        return { results: Array.isArray(body?.results) ? body.results : EMPTY, error: null };
    } catch (error) {
        //   An abort is the caller replacing this search with a newer one. It
        //   is not a failure and must not paint an error over a field the buyer
        //   is still typing into.
        if (error instanceof DOMException && error.name === "AbortError") {
            return { results: EMPTY, error: null };
        }
        return { results: EMPTY, error: "The address service could not be reached." };
    }
}
