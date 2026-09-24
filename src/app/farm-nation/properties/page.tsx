/**
 * Farm Nation property search — the server half. See #543 / #545.
 *
 * The FIRST, unfiltered page only. This screen refetches on every filter and on
 * a debounced search term and pages with a cursor, so the client consumes the
 * seed once and asks the server for everything else.
 *
 * ── WHY THIS PAGE READS searchParams ────────────────────────────────────────
 *
 *   THE OWNER: "searchLandListingsAction firing seven times in one second."
 *
 *   The landing page's category grid is six `<Link>`s into this route, plus a
 *   browse-all link — and Next prefetches a Link when it enters the viewport.
 *   This page is force-dynamic and ran the listing search unconditionally, so
 *   seven prefetches were seven full queries in the second that grid scrolled
 *   into view, before the visitor clicked anything.
 *
 *   SIX OF THE SEVEN COULD NEVER HAVE BEEN USED. PropertiesClient consumes the
 *   seed only on an unfiltered first load — any filter in the URL and it must
 *   ask the server, or a filtered view would render unfiltered rows. So the
 *   query behind a `?type=` link was paid for and then discarded on arrival.
 *
 *   The same branch is taken here, which is #558's shape: the server reads the
 *   parameters the client reads and seeds only where the client will consume
 *   it. If the two ever disagreed the client would simply fetch, because the
 *   seed is taken inside the branch it belongs to.
 *
 *   `priceRange` and the search term are not in this list on purpose — neither
 *   comes from the URL, so both are always empty on a first render.
 */

import { searchLandListingsAction } from "@/app/actions/land-listings";
import PropertiesClient from "./PropertiesClient";
import { rawSeed } from "@/lib/server-seed";
import { LAND_CATEGORY_PARAM } from "@/lib/land-categories";

/**
 *   #553 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

/** The parameters PropertiesClient seeds its filters from. */
const FILTER_PARAMS = [LAND_CATEGORY_PARAM, "location", "listingType"] as const;

export default async function FarmNationPropertiesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const filtered = FILTER_PARAMS.some((key) => {
        const value = params[key];
        return Array.isArray(value) ? value.some(Boolean) : Boolean(value);
    });

    const result = filtered
        ? null
        : rawSeed("farm-nation properties", await searchLandListingsAction({ limit: 12 }).catch(() => null));

    return <PropertiesClient initial={result} />;
}
