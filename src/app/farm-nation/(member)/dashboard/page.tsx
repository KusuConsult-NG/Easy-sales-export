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

export default async function FarmNationDashboardPage() {
    const result = await getFarmNationDashboardStatsAction().catch(() => null);
    const initial = result?.success ? (result.data ?? null) : null;

    return <FarmNationDashboardClient initial={initial} />;
}
