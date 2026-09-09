/**
 * Export portfolio — the server half. See #543 / #545.
 *
 * This screen had TWO separate effects firing on mount — the stats and the
 * first page of investments — issued as two independent round trips from the
 * browser. They run in parallel here.
 *
 * The seed covers only the first page: the client pages with a cursor, so
 * loadInvestments keeps its own fetch for everything after it.
 */

import { getUserExportStatsAction, getUserExportInvestmentsAction } from "@/app/actions/export";
import ExportPortfolioClient from "./ExportPortfolioClient";

/**
 *   #550 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function ExportPortfolioPage() {
    const [statsResult, investmentsResult] = await Promise.all([
        getUserExportStatsAction().catch(() => null),
        getUserExportInvestmentsAction(10).catch(() => null),
    ]);

    const initial = statsResult && investmentsResult
        ? { statsResult, investmentsResult }
        : null;

    return <ExportPortfolioClient initial={initial} />;
}
