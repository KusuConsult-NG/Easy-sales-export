/**
 * Export member dashboard — the server half. See #543 in
 * hooks/useServerSeed.ts for why every one of these pages is split this way.
 *
 * The two actions run in parallel here, exactly as the client's effect ran
 * them, and the results are seeded into the client's state so the
 * server-rendered HTML already carries the portfolio figures.
 */

import { getUserExportStatsAction, getUserExportInvestmentsAction } from "@/app/actions/export";
import ExportDashboardClient from "./ExportDashboardClient";

export default async function ExportDashboardPage() {
    const [statsResult, investmentsResult] = await Promise.all([
        getUserExportStatsAction().catch(() => null),
        getUserExportInvestmentsAction(5).catch(() => null),
    ]);

    //   Both or neither. A half-seed would render real stats beside an empty
    //   investment list and never fetch the rest, because the client skips its
    //   load whenever a seed is present.
    const initial = statsResult?.success && statsResult.data
        && investmentsResult?.success && investmentsResult.data
        ? { stats: statsResult.data, investments: investmentsResult.data as any[] }
        : null;

    return <ExportDashboardClient initial={initial} />;
}
