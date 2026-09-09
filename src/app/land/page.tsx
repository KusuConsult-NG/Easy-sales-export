/**
 * The public land map — the server half. See #543 / #545 / #562.
 *
 * This was a "use client" page whose first act on mount was
 * `fetch("/api/farm-nation/listings")` — the hydration waterfall with an extra
 * hop in it, because the browser opened a second HTTP request back to the same
 * server that had just rendered the page.
 *
 * It reads the same listings through the same shared reader the route uses, so
 * there is one definition of which listings are public and which fields a
 * stranger may see, not one per caller.
 */

import { readPublicLandListings } from "@/lib/land-listings-reader";
import { logger } from "@/lib/logger";
import type { LandListing } from "@/types/strict";
import LandMapClient from "./LandMapClient";

/**
 *   #562 EXPLICITLY DYNAMIC — the listings change as admins approve them, and
 *   this page must not be frozen at build time.
 */
export const dynamic = "force-dynamic";

export default async function LandMapPage() {
    const initial = await readPublicLandListings().catch((error) => {
        //   Said out loud rather than silently slower: the client will fall
        //   back to the HTTP route, and a page that quietly does that on every
        //   request is the failure #551 closed for the action-based seeds.
        logger.error("[land] listings read failed; the client will fetch instead", error);
        return null;
    });

    return <LandMapClient initial={initial as LandListing[] | null} />;
}
