/**
 * Marketplace product list — the server half. See #543 / #545.
 *
 * The FIRST, unfiltered page only: this screen refetches on category and on a
 * debounced search and pages with a cursor.
 */

import { getMarketplaceProductsAction } from "@/app/actions/marketplace";
import MarketplaceProductsClient from "./MarketplaceProductsClient";
import { rawSeed } from "@/lib/server-seed";

/**
 *   #554 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MarketplaceProductsPage() {
    const result = rawSeed("marketplace products", await getMarketplaceProductsAction({ limit: 12 }).catch(() => null));

    return <MarketplaceProductsClient initial={result} />;
}
