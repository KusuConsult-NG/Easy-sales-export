/**
 * Export opportunities — the server half. See #543 / #545.
 *
 * The raw result is handed over. The client turns the serialised date strings
 * back into Date objects, which has to stay there: a Date does not survive the
 * server-to-client boundary as a Date, so the seed carries what the action
 * actually returned.
 */

import { getActiveExportWindowsAction } from "@/app/actions/export-aggregation";
import ExportOpportunitiesClient from "./ExportOpportunitiesClient";
import { rawSeed } from "@/lib/server-seed";

/**
 *   #546 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function ExportOpportunitiesPage() {
    const result = rawSeed("export opportunities", await getActiveExportWindowsAction().catch(() => null));

    return <ExportOpportunitiesClient initial={result} />;
}
