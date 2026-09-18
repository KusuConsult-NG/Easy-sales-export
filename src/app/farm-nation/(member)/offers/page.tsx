/**
 * Farm Nation offers — the server half.
 *
 *   #874 One page for both sides of a negotiation, because on Farm Nation one
 *   account is routinely both: a member who lists a parcel also browses them.
 *   Two pages would mean somebody seeing half their offers and concluding the
 *   other half had been lost.
 */

import { getMyLandOffersAction } from "@/app/actions/land-offers";
import { seedOrNull } from "@/lib/server-seed";
import OffersClient from "./OffersClient";

/**
 *   #549 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it.
 */
export const dynamic = "force-dynamic";

export default async function OffersPage() {
    /*
     *   The action takes NO user id: it filters on the session's own id on both
     *   sides. There is nothing to pass and nothing to pass wrongly — the shape
     *   that let "any authenticated user name any landowner and read their
     *   inbox" on the inquiries side.
     *
     *   #551/#552 THE SHARED UNWRAPPER, not an inline `?.success &&`.
     *
     *   My first draft hand-rolled the same three branches, and #552's cap
     *   caught it. seedOrNull is where the reasoning lives: a refusal and a
     *   throw both mean "seed nothing and let the client fetch", and both are
     *   LOGGED — so the server's own reason for failing is recoverable, which is
     *   the half an inline check drops. That is D1, from the other ratchet, in
     *   the same four lines.
     */
    const initial = seedOrNull("farm-nation/offers", await getMyLandOffersAction().catch(() => null));

    return <OffersClient initial={initial} />;
}
