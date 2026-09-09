/**
 * Marketplace seller analytics — the server half. See #543 / #545.
 *
 * The raw result is handed over: the client merges three previous-month
 * defaults over it, and restating that here would be two copies of one rule.
 */

import { getSellerAnalyticsAction } from "@/app/actions/marketplace";
import SellerAnalyticsClient from "./SellerAnalyticsClient";

/**
 *   #552 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function SellerAnalyticsPage() {
    const result = await getSellerAnalyticsAction().catch(() => null);

    return <SellerAnalyticsClient initial={result} />;
}
