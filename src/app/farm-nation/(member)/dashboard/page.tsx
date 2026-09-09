/**
 * Farm Nation member dashboard — the server half.
 *
 *   #543 THE DASHBOARD FETCHED ITSELF AFTER THE PAGE HAD ALREADY APPEARED.
 *
 *   This was a "use client" page whose only job on mount was one server action.
 *   The user got HTML containing a full-page spinner, waited for the JS bundle,
 *   waited for hydration, and only then waited for the round trip.
 *
 *   The stats are fetched here instead and seeded into the client's STATE, so
 *   the server-rendered HTML already holds the numbers — no spinner, no round
 *   trip. `.catch(() => null)` keeps a failed server read from turning a working
 *   screen into an error page: the client then fetches exactly as it used to.
 */

import { getFarmNationDashboardStatsAction } from "@/app/actions/farm-nation";
import FarmNationDashboardClient from "./FarmNationDashboardClient";

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


export default async function FarmNationDashboardPage() {
    const result = await getFarmNationDashboardStatsAction().catch(() => null);
    const initial = result?.success ? (result.data ?? null) : null;

    return <FarmNationDashboardClient initial={initial} />;
}
