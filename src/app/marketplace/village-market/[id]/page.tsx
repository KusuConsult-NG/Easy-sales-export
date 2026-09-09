/**
 * One Village Market event — the server half. See #543 / #545.
 *
 * The event and its flash-sale products come back from a single read, keyed on
 * the id in the route, so the server has everything it needs to render the
 * screen populated instead of sending a spinner and asking the browser to go
 * and get it.
 *
 * getVillageMarketEventAction THROWS rather than returning a refusal, and the
 * client turns that into #492's "this event could not be loaded" — which is a
 * different thing from "event not found". A throw here seeds nothing, and the
 * client makes the call itself and tells the buyer the same thing it always did.
 */

import { getVillageMarketEventAction } from "@/app/actions/village-market";
import VillageMarketEventClient from "./VillageMarketEventClient";

/**
 *   #559 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function VillageMarketEventPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const initial = await getVillageMarketEventAction(id).catch(() => null);

    return <VillageMarketEventClient initial={initial} />;
}
