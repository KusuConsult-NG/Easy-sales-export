/**
 * The Village Market seller hub — the server half. See #543 / #545.
 *
 * One read of the active events, made after the page had already arrived. The
 * action returns a bare array and throws rather than refusing, so a failure
 * seeds nothing and the client asks for itself exactly as before.
 */

import { getActiveVillageMarketEventsAction } from "@/app/actions/village-market";
import VillageMarketSellerClient from "./VillageMarketSellerClient";

/**
 *   #559 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function VillageMarketSellerHubPage() {
    const initial = await getActiveVillageMarketEventsAction().catch(() => null);

    return <VillageMarketSellerClient initial={initial} />;
}
