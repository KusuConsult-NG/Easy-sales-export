/**
 * farm-nation onboarding — the server half. See #543 / #545.
 *
 * Only the STATUS CHECK that gates the wizard is made here. All the branching
 * it feeds — pending, approved, edit mode, the redirects — stays in the client,
 * because moving a redirect to the server changes how an onboarding flow
 * behaves and that is a different decision from removing a round trip.
 */

import { checkFarmNationStatusAction } from "@/app/actions/farm-nation";
import { rawSeed } from "@/lib/server-seed";
import FarmNationOnboardingClient from "./FarmNationOnboardingClient";

/**
 *   #555 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function FarmNationOnboardingPage() {
    const initial = rawSeed("farm-nation status", await checkFarmNationStatusAction().catch(() => null));

    return <FarmNationOnboardingClient initial={initial} />;
}
