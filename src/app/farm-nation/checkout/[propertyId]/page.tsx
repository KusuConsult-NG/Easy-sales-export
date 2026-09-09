/**
 * Farm Nation checkout — the server half. See #543 / #545.
 *
 * The RAW result is handed over. The client applies the availability rule —
 * a property whose status is not "verified" shows "no longer available"
 * instead of a checkout form — and deciding that here as well would be two
 * copies of one rule on a path that takes money.
 */

import { getPropertyByIdAction } from "@/app/actions/land-listings";
import CheckoutClient from "./CheckoutClient";

/**
 *   #550 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: Promise<{ propertyId: string }> }) {
    const { propertyId } = await params;
    const result = await getPropertyByIdAction(propertyId).catch(() => null);

    return <CheckoutClient initial={result} />;
}
