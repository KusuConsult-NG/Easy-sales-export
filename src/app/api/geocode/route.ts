/**
 * Address geocoding over OpenStreetMap.
 *
 *   THE OWNER: "For delivery address, we want to use openstreet map instead of
 *   google map."
 *
 *   The one door through which this platform talks to Nominatim. See
 *   lib/nominatim for why the call is made here and not in the browser: the
 *   usage policy requires an identifying User-Agent, which `fetch` in a browser
 *   is not permitted to set, and it asks for caching and a hard ceiling of one
 *   request a second — none of which a component rendered in a thousand tabs
 *   can hold.
 *
 *   AUTHENTICATED, because it is reached from checkout and an open geocoding
 *   proxy on this origin would spend the platform's share of a donated service
 *   for anybody who found the URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { withRateLimit } from "@/lib/rate-limit";
import { getCached, setCache } from "@/lib/redis";
import { logger } from "@/lib/logger";
import {
    MAX_RESULTS,
    nominatimSearchUrl,
    nominatimUserAgent,
    parseNominatimResults,
    type GeocodeResult,
} from "@/lib/nominatim";

export const dynamic = "force-dynamic";

/**
 * How long an answer is kept.
 *
 *   The policy asks that results be cached. A street does not move, so this is
 *   long: the value of a shorter window is nil and the cost is a request
 *   against a ceiling this platform does not control. A day, so a correction
 *   upstream still reaches us within one.
 */
const CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * How long to wait for Nominatim.
 *
 *   A buyer is looking at a spinner. Without this the request inherits the
 *   platform's default and the field can hang for the best part of a minute,
 *   which is worse than the offline fallback checkout already has.
 */
const UPSTREAM_TIMEOUT_MS = 6000;

/** The shortest query worth sending. */
const MIN_QUERY_LENGTH = 3;

const MAX_QUERY_LENGTH = 200;

async function handler(request: NextRequest): Promise<NextResponse> {
    const { session } = await requireSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const query = (request.nextUrl.searchParams.get("q") || "").trim();
    if (query.length < MIN_QUERY_LENGTH) {
        //   Not an error: an empty field is the normal state of the form. A 400
        //   here would paint a red message on a buyer who has typed two
        //   characters.
        return NextResponse.json({ results: [] });
    }
    if (query.length > MAX_QUERY_LENGTH) {
        return NextResponse.json({ error: "That address is too long to look up." }, { status: 400 });
    }

    const limit = Math.max(1, Math.min(
        MAX_RESULTS, Number.parseInt(request.nextUrl.searchParams.get("limit") || "", 10) || MAX_RESULTS));

    const cacheKey = `geocode:osm:${limit}:${query.toLowerCase()}`;
    const cached = await getCached<GeocodeResult[]>(cacheKey);
    if (cached) {
        return NextResponse.json({ results: cached, cached: true });
    }

    let results: GeocodeResult[];
    try {
        const response = await fetch(nominatimSearchUrl(query, limit), {
            headers: {
                //   The policy's requirement, and the reason this is not done
                //   in the browser at all. See lib/nominatim.
                "User-Agent": nominatimUserAgent(),
                "Accept": "application/json",
                "Accept-Language": "en",
            },
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });

        if (!response.ok) {
            logger.warn("[geocode] Nominatim refused the lookup", { status: response.status });
            return NextResponse.json(
                { error: "The address service is unavailable. Please try again." },
                { status: 502 },
            );
        }

        results = parseNominatimResults(await response.json());
    } catch (error) {
        logger.error("[geocode] Nominatim lookup failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
            { error: "The address service could not be reached. Please try again." },
            { status: 502 },
        );
    }

    //   A miss is cached too. "No such street" is a stable answer, and not
    //   caching it means every retype of a misspelling spends the ceiling
    //   again.
    await setCache(cacheKey, results, CACHE_TTL_SECONDS);

    return NextResponse.json({ results });
}

export const GET = withRateLimit(handler, "geocode");
