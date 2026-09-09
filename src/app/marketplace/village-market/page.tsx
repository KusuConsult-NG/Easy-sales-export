/**
 * Village market — the server half. See #543 / #545.
 *
 * This action returns the array directly rather than a {success, data}
 * envelope, so seedOrNull does not apply: there is no refusal to tell apart
 * from a failure. A throw is caught here and passes null.
 */

import { getActiveVillageMarketEventsAction } from "@/app/actions/village-market";
import VillageMarketClient from "./VillageMarketClient";

/**
 *   #552 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function VillageMarketPage() {
    const initial = await getActiveVillageMarketEventsAction().catch(() => null);

    return <VillageMarketClient initial={initial} />;
}
