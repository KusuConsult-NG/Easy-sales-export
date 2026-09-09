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

/**
 *   #543 EXPLICITLY DYNAMIC.
 *
 *   These pages read a session, so Next cannot prerender them. It found that
 *   out by TRYING at build time: the attempt threw "Dynamic server usage …
 *   used `headers`", the `.catch(() => null)` below absorbed it, and the route
 *   was correctly marked dynamic anyway.
 *
 *   The behaviour was right and the build log was wrong — several screenfuls of
 *   stack traces naming a normal outcome as a fault. That is exactly the "log
 *   that cries wolf on the normal path" #366 recorded in hub-guard, where the
 *   real exception goes unread because the noise is routine.
 *
 *   Saying it up front stops the probe and the noise with it.
 */
export const dynamic = "force-dynamic";


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
