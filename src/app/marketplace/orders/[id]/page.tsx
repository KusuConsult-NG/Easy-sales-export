/**
 * Marketplace order confirmation — the server half. See #543 / #545.
 *
 * The client keeps loadOrder: that is what redirects to /marketplace when the
 * order is missing or is not the caller's, and a refusal here passes null so
 * the path still runs.
 */

import { getOrderByIdAction } from "@/app/actions/orders";
import { seedOrNull } from "@/lib/server-seed";
import OrderConfirmationClient from "./OrderConfirmationClient";

/**
 *   #552 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function OrderConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const data = seedOrNull("marketplace order", await getOrderByIdAction(id).catch(() => null));

    return <OrderConfirmationClient initial={(data?.order as any) ?? null} />;
}
