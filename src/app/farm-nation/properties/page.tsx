/**
 * Farm Nation property search — the server half. See #543 / #545.
 *
 * The FIRST, unfiltered page only. This screen refetches on every filter and on
 * a debounced search term and pages with a cursor, so the client consumes the
 * seed once and asks the server for everything else.
 */

import { searchLandListingsAction } from "@/app/actions/land-listings";
import PropertiesClient from "./PropertiesClient";

/**
 *   #553 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function FarmNationPropertiesPage() {
    const result = await searchLandListingsAction({ limit: 12 }).catch(() => null);

    return <PropertiesClient initial={result} />;
}
