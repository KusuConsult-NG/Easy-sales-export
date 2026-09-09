/**
 * Academy live sessions — the server half. See #543 / #545.
 *
 * The raw list is handed over; the client still splits it into live sessions
 * and ended-with-a-recording, so that rule lives in exactly one place.
 */

import { getLiveSessionsAction } from "@/app/actions/academy";
import AcademyLiveClient from "./AcademyLiveClient";

/**
 *   #548 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function AcademyLivePage() {
    const result = await getLiveSessionsAction().catch(() => null);

    return <AcademyLiveClient initial={result} />;
}
