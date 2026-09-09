/**
 * A member's disputes — the server half. See #543 / #545.
 *
 * This screen polls every ten seconds, so the seed replaces only the FIRST
 * read; the poll continues and keeps the list current.
 */

import { getMyDisputes } from "@/app/actions/my-data";
import DisputesClient from "./DisputesClient";

/**
 *   #548 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function DisputesPage() {
    const list = await getMyDisputes().catch(() => null);

    return <DisputesClient initial={(list as any[]) ?? null} />;
}
