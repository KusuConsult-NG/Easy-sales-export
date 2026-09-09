/**
 * Export investment detail — the server half. See #543 / #545.
 *
 * The list is fetched here; the client still picks the matching investment out
 * of it, so "not found" and "you don't have access to it" remain that screen's
 * own distinct messages rather than being flattened into a 404 here.
 */

import { getMyExportInvestmentsAction } from "@/app/actions/export";
import InvestmentDetailClient from "./InvestmentDetailClient";

/**
 *   #547 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function InvestmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await getMyExportInvestmentsAction().catch(() => null);

    return <InvestmentDetailClient investmentId={id} initial={result} />;
}
