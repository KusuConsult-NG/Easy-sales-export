/**
 * Farm Nation edit property — the server half. See #543 / #545.
 *
 * The RAW property is handed over. The client unpacks it into a dozen form
 * fields — including deriving the listing types from three separate booleans —
 * and that mapping stays there, in one place.
 */

import { getPropertyByIdAction } from "@/app/actions/land-listings";
import EditPropertyClient from "./EditPropertyClient";

/**
 *   #549 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await getPropertyByIdAction(id).catch(() => null);

    return <EditPropertyClient id={id} initial={result} />;
}
