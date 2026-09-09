/**
 * WAVE shipments — the server half. See #543 / #545.
 */

import { auth } from "@/lib/auth";
import { getShipmentTrackingAction } from "@/app/actions/wave";
import { seedOrNull } from "@/lib/server-seed";
import WaveShipmentsClient from "./WaveShipmentsClient";

/**
 *   #552 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function WaveShipmentsPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    const initial = userId
        ? seedOrNull("wave shipments", await getShipmentTrackingAction(userId).catch(() => null))
        : null;

    return <WaveShipmentsClient initial={(initial as any[]) ?? null} />;
}
