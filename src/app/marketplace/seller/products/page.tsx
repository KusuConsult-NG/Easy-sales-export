/**
 * A seller's product list — the server half. See #543 / #545.
 *
 * The first page, unfiltered and unsearched: exactly what the client asks for
 * on mount. It also re-asks on every filter change and every debounced
 * keystroke through the same reset path, so the seed is guarded on the client
 * and consumed only by a reset that is still asking the same question. See
 * SellerProductsClient.
 */

import { getSellerProductsAction } from "@/app/actions/marketplace";
import { rawSeed } from "@/lib/server-seed";
import SellerProductsClient from "./SellerProductsClient";

/**
 *   #558 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function SellerProductsPage() {
    const initial = rawSeed(
        "seller products",
        await getSellerProductsAction({ limit: 20, status: "all", search: "" }).catch(() => null),
    );

    return <SellerProductsClient initial={initial} />;
}
