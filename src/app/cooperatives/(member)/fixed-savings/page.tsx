/**
 * A member's fixed savings — the server half. See #543 / #545 / #564.
 *
 * Two `fetch` calls back to this same application on mount — the membership
 * check and the plans — after the page had already been rendered, downloaded
 * and hydrated. Both now read through the shared functions the routes
 * themselves use, so #488's membership lookup and #419's derived plan status
 * have one definition and two callers each.
 *
 * The membership ANSWER is passed down whole rather than flattened, because
 * #565 is about the difference between "not a member" and "could not tell" and
 * that reading belongs on one side.
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { readCooperativeMembership, readFixedSavingsPlans } from "@/lib/cooperative-readers";
import FixedSavingsClient from "./FixedSavingsClient";

/**
 *   #564 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function FixedSavingsPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    if (!userId) {
        //   Nothing decided here that the routes do not decide themselves: the
        //   client falls back to them and they answer 401.
        return <FixedSavingsClient initial={null} />;
    }

    const [membership, plans] = await Promise.all([
        readCooperativeMembership(userId).catch((error) => {
            logger.error("[fixed-savings] membership read failed; the client will fetch", error);
            return null;
        }),
        readFixedSavingsPlans(userId).catch((error) => {
            logger.error("[fixed-savings] plans read failed; the client will fetch", error);
            return null;
        }),
    ]);

    //   All or nothing, in one expression — see #562. A member seeded with
    //   plans and no membership answer would be shown the join panel over the
    //   top of their own savings.
    const initial = membership !== null && plans !== null
        ? { membership: { isMember: membership.isMember, status: membership.status }, plans }
        : null;

    return <FixedSavingsClient initial={initial} />;
}
