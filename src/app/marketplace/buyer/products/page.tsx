/**
 * Marketplace buyer product browse — the server half. See #543 / #545.
 *
 * The catalogue and the flash sales were already parallel in the client and are
 * fetched here instead. The raw results are handed over: the flash-sale rows
 * are mapped into a Product-like shape in the client, and that mapping stays
 * there.
 *
 * The FIRST, unfiltered load only — the state filter, the price range and the
 * debounced search all ask the server.
 */

import { getProductsAction } from "@/app/actions/marketplace";
import { getActiveFlashSaleProductsAction } from "@/app/actions/village-market";
import BuyerProductsClient from "./BuyerProductsClient";
import { rawSeed } from "@/lib/server-seed";

/**
 *   #554 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
    const [productsRes, flashRes] = await Promise.all([
        getProductsAction({}).catch(() => null),
        getActiveFlashSaleProductsAction().catch(() => null),
    ]);

    //   getActiveFlashSaleProductsAction returns its array directly, so only
    //   the products result carries a refusal to report.
    const initial = productsRes && flashRes
        ? { productsRes: rawSeed("buyer products", productsRes), flashRes }
        : null;

    return <BuyerProductsClient initial={initial} />;
}
