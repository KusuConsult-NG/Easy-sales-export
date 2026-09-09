/**
 * Marketplace buyer dashboard — the server half. See #543.
 *
 * The three actions are run here, in parallel, exactly as the client's effect
 * ran them, and their RAW results are handed over. The sorting and reshaping
 * stay in the client, where they were: doing them here as well would be two
 * copies of one contract.
 */

import { getBuyerStatsAction, getBuyerOrdersAction, getRecommendedProductsAction } from "@/app/actions/marketplace";
import BuyerDashboardClient from "./BuyerDashboardClient";

/**
 *   #543 EXPLICITLY DYNAMIC.
 *
 *   These pages read a session, so Next cannot prerender them. It found that
 *   out by TRYING at build time: the attempt threw "Dynamic server usage …
 *   used `headers`", the `.catch(() => null)` below absorbed it, and the route
 *   was correctly marked dynamic anyway.
 *
 *   The behaviour was right and the build log was wrong — several screenfuls of
 *   stack traces naming a normal outcome as a fault. That is exactly the "log
 *   that cries wolf on the normal path" #366 recorded in hub-guard, where the
 *   real exception goes unread because the noise is routine.
 *
 *   Saying it up front stops the probe and the noise with it.
 */
export const dynamic = "force-dynamic";


export default async function BuyerDashboardPage() {
    const [statsResult, ordersResult, recommendedResult] = await Promise.all([
        getBuyerStatsAction().catch(() => null),
        getBuyerOrdersAction().catch(() => null),
        getRecommendedProductsAction(3).catch(() => null),
    ]);

    //   All three or none. The client skips its whole load when a seed is
    //   present, so a partial seed would leave the missing panels permanently
    //   empty rather than merely late.
    const initial = statsResult && ordersResult && recommendedResult
        ? { statsResult, ordersResult, recommendedResult }
        : null;

    return <BuyerDashboardClient initial={initial} />;
}
