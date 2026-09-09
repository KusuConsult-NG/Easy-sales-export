/**
 * Export landing — the server half. See #543 / #545.
 *
 * The three windows shown on the landing card are fetched here, so the page
 * arrives with them instead of asking after it has already rendered.
 */

import { getActiveExportWindowsAction } from "@/app/actions/export-aggregation";
import ExportLandingClient from "./ExportLandingClient";

/**
 *   #548 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function ExportWindowsLandingPage() {
    const result = await getActiveExportWindowsAction().catch(() => null);
    const initial = result?.success ? ((result.data || []) as any[]).slice(0, 3) : null;

    return <ExportLandingClient initial={initial} />;
}
