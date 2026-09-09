/**
 * A buyer's orders — the server half. See #543 / #545.
 *
 * The FIRST, unfiltered page only; the status filter and paging ask the server.
 */

import { getBuyerOrdersAction } from "@/app/actions/marketplace";
import BuyerOrdersClient from "./BuyerOrdersClient";
import { rawSeed } from "@/lib/server-seed";

/**
 *   #554 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
    const result = rawSeed("buyer orders", await getBuyerOrdersAction({ limit: 20 }).catch(() => null));

    return <BuyerOrdersClient initial={result} />;
}
