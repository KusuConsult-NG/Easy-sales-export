/**
 * Marketplace seller orders — the server half. See #543 / #545.
 *
 * The FIRST, unfiltered page only. This screen refetches on every status
 * filter and every debounced search and pages with a cursor, so the client
 * consumes the seed once and asks the server for everything else — otherwise
 * a filter could render unfiltered rows.
 */

import { getSellerOrdersAction } from "@/app/actions/marketplace";
import SellerOrdersClient from "./SellerOrdersClient";

/**
 *   #552 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function SellerOrdersPage() {
    const result = await getSellerOrdersAction({ limit: 20 }).catch(() => null);

    return <SellerOrdersClient initial={result} />;
}
