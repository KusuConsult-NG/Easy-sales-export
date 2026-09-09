/**
 * Farm Nation purchase requests — the server half. See #543 / #545.
 *
 * The client keeps loadPurchases: cancelling a request refreshes the list.
 */

import { getMyPurchaseRequestsAction } from "@/app/actions/farm-nation";
import MyPurchasesClient from "./MyPurchasesClient";

/**
 *   #550 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MyPurchasesPage() {
    const result = await getMyPurchaseRequestsAction().catch(() => null);
    const initial = result?.success && result.data?.requests
        ? (result.data.requests as any[])
        : null;

    return <MyPurchasesClient initial={initial} />;
}
