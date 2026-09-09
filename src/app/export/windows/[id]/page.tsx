/**
 * Export window detail — the server half. See #543 / #545.
 *
 * The client keeps its own `loadWindow`: this screen reloads itself after an
 * investment completes, so the read is still needed for the refresh even though
 * the first one now arrives with the HTML.
 */

import { getExportOpportunityById, type ExportOpportunity } from "@/app/actions/export-investments";
import ExportWindowDetailClient from "./ExportWindowDetailClient";

/**
 *   #548 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function ExportWindowDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await getExportOpportunityById(id).catch(() => null);
    const initial = result?.success ? ((result.data ?? null) as ExportOpportunity | null) : null;

    return <ExportWindowDetailClient initial={initial} />;
}
