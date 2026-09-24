/**
 * One order, seen by its seller — the server half. See #543 / #545.
 *
 * A chain of two: the order, and then — only if it carries a tracking number —
 * its tracking updates. In the browser those were two effects, so a seller
 * opening a dispatched order waited for the page, then for the order, and then
 * for the tracking, each after the last had come back.
 *
 * The same condition gates the second read here, so an untracked order costs
 * exactly one read, as it always did.
 *
 * All or nothing: a half-walked chain would hand the client an order while the
 * tracking was still on its way, which is the failure this ledger warns about.
 */

import { getOrderByIdForSellerAction, getTrackingUpdatesAction } from "@/app/actions/order-management";
import { rawSeed } from "@/lib/server-seed";
import SellerOrderDetailClient from "./SellerOrderDetailClient";

/**
 *   #559 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function SellerOrderDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    //   `orderResult`, not `order`: this is the action's envelope, and #443's
    //   ratchet reads `order.<field>` anywhere under src/app/marketplace as a
    //   field of an ORDER ROW that must be declared in OrderSchema. Naming an
    //   envelope `order` made three schema fields appear out of nowhere.
    const orderResult = rawSeed(
        "seller order", await getOrderByIdForSellerAction(id).catch(() => null),
    );

    /*
     *   KEYED ON THE ORDER, not on a tracking number.
     *
     *   This seeded the timeline only when the order HAD a tracking number,
     *   because the mock provider built its journey from one. The events are
     *   the order's own now — placed, paid, shipped, delivered — so every
     *   order has a history, including one travelling by bike with no waybill
     *   at all. See lib/shipment-record.
     */
    const orderId = orderResult?.success ? orderResult.data?.order?.id : undefined;

    const trackingResult = orderId
        ? rawSeed("order tracking", await getTrackingUpdatesAction(orderId).catch(() => null))
        : null;

    const complete = orderResult !== null && (!orderId || trackingResult !== null);

    return (
        <SellerOrderDetailClient
            initial={complete && orderResult ? { orderResult, trackingResult } : null}
        />
    );
}
