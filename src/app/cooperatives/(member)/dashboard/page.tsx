/**
 * Cooperative member dashboard — the server half. See #543.
 *
 * The client's own comment says getDashboardDataAction "has its own
 * multi-fallback queries", which is exactly why it is called here unchanged
 * rather than reimplemented: one definition of how a membership is found.
 */

import { getDashboardDataAction } from "@/app/actions/cooperative";
import CooperativeDashboardClient from "./CooperativeDashboardClient";

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


export default async function CooperativeDashboardPage() {
    const result = await getDashboardDataAction().catch(() => null);
    const initial = result?.success && result.data
        ? { membership: result.data.membership, transactions: result.data.transactions }
        : null;

    return <CooperativeDashboardClient initial={initial} />;
}
