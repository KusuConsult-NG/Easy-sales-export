/**
 * marketplace onboarding — the server half. See #543 / #545.
 *
 * Only the STATUS CHECK that gates the wizard is made here. All the branching
 * it feeds — pending, approved, edit mode, the redirects — stays in the client,
 * because moving a redirect to the server changes how an onboarding flow
 * behaves and that is a different decision from removing a round trip.
 */

import { checkMarketplaceStatusAction } from "@/app/actions/marketplace";
import { rawSeed } from "@/lib/server-seed";
import MarketplaceOnboardingClient from "./MarketplaceOnboardingClient";

/**
 *   #555 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MarketplaceOnboardingPage() {
    const initial = rawSeed("marketplace status", await checkMarketplaceStatusAction().catch(() => null));

    return <MarketplaceOnboardingClient initial={initial} />;
}
