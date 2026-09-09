/**
 * Raise a dispute — the server half. See #543 / #545.
 *
 * The order id arrives as a query parameter, which a server component reads
 * from searchParams. The client keeps `loadOrder`: it is what redirects to the
 * orders list when the order is missing or is not the caller's, and a refusal
 * here passes null so that path still runs.
 */

import { getOrderByIdAction } from "@/app/actions/orders";
import NewDisputeClient from "./NewDisputeClient";

/**
 *   #550 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function NewDisputePage({ searchParams }: {
    searchParams: Promise<{ orderId?: string }>;
}) {
    const { orderId } = await searchParams;

    const result = orderId
        ? await getOrderByIdAction(orderId).catch(() => null)
        : null;
    const initial = result?.success && result.data?.order ? (result.data.order as any) : null;

    return <NewDisputeClient initial={initial} />;
}
