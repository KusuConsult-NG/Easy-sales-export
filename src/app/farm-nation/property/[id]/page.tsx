/**
 * Farm Nation property detail — the server half. See #543 / #545.
 */

import { getPropertyByIdAction, type LandListing } from "@/app/actions/land-listings";
import { seedOrNull } from "@/lib/server-seed";
import PropertyDetailsClient from "./PropertyDetailsClient";

/**
 *   #553 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function PropertyDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const initial = seedOrNull<LandListing>(
        "farm-nation property", await getPropertyByIdAction(id).catch(() => null),
    );

    return <PropertyDetailsClient initial={initial} />;
}
