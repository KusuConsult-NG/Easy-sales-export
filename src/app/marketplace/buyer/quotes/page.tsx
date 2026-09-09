/**
 * Marketplace buyer quotes — the server half. See #543 / #545.
 *
 * The client keeps its own `load`: this screen refreshes after a quote is
 * accepted or rejected, so the read is still needed — just not first.
 */

import { getMyQuotesAction } from "@/app/actions/marketplace";
import BuyerQuotesClient from "./BuyerQuotesClient";
import { seedOrNull } from "@/lib/server-seed";

/**
 *   #551 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function BuyerQuotesPage() {
    const data = seedOrNull("buyer quotes", await getMyQuotesAction("buyer").catch(() => null));
    const initial = (data?.quotes as any[] | undefined) ?? null;

    return <BuyerQuotesClient initial={initial} />;
}
