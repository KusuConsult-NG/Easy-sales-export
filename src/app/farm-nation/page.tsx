/**
 * Farm Nation landing — the server half. See #543 / #545.
 *
 * The raw search result is handed over: the client takes the first three as
 * featured, counts the rest by category and derives a total, and restating
 * those three derivations here would be three copies of one contract.
 */

import { searchLandListingsAction } from "@/app/actions/land-listings";
import FarmNationLandingClient from "./FarmNationLandingClient";
import { rawSeed } from "@/lib/server-seed";

/**
 *   #553 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function FarmNationLandingPage() {
    const result = rawSeed("farm-nation landing", await searchLandListingsAction({ limit: 50 }).catch(() => null));

    return <FarmNationLandingClient initial={result} />;
}
