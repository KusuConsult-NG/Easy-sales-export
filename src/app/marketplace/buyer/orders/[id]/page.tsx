/**
 * A buyer's order detail — the server half. See #543 / #545.
 *
 * Only the ORDER is seeded. The tracking read keys off order.trackingNumber,
 * which is not known until the order is in hand, so that one genuinely depends
 * on this and stays in the client.
 */

import { getOrderByIdAction } from "@/app/actions/orders";
import { seedOrNull } from "@/lib/server-seed";
import BuyerOrderDetailClient from "./BuyerOrderDetailClient";

/**
 *   #554 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function BuyerOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const data = seedOrNull("buyer order", await getOrderByIdAction(id).catch(() => null));

    return <BuyerOrderDetailClient initial={(data?.order as any) ?? null} />;
}
