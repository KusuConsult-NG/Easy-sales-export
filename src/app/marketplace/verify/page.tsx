/**
 * Seller verification — the server half. See #543 / #545.
 *
 * One read: whether this seller already has an application in flight. It
 * decides which of two screens is shown — the form, or the status of what was
 * already submitted — so making it in the browser meant every seller saw a
 * spinner before finding out which.
 */

import { getSellerVerificationAction } from "@/app/actions/marketplace";
import { rawSeed } from "@/lib/server-seed";
import SellerVerificationClient from "./SellerVerificationClient";

/**
 *   #559 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function SellerVerificationPage() {
    const initial = rawSeed(
        "seller verification", await getSellerVerificationAction().catch(() => null),
    );

    return <SellerVerificationClient initial={initial} />;
}
