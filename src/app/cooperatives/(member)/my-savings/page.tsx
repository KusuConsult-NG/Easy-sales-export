/**
 * A member's savings — the server half. See #543 / #545 / #564.
 *
 * A mixed pair on mount: a server action for the membership, and a `fetch` back
 * to this application's own /api/cooperative/fixed-savings for the plans. They
 * ran together, which was right, but both ran after the page had already been
 * rendered, downloaded and hydrated.
 *
 * The plans come through the shared reader the route uses, so #419's derived
 * plan status — nothing ever wrote "matured", so a finished plan still showed a
 * countdown — has one definition for both callers.
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getMembershipAction } from "@/app/actions/cooperative";
import { readFixedSavingsPlans } from "@/lib/cooperative-readers";
import { rawSeed } from "@/lib/server-seed";
import MySavingsClient from "./MySavingsClient";

/**
 *   #564 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MySavingsPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    if (!userId) {
        return <MySavingsClient initial={null} />;
    }

    const [membershipResult, plans] = await Promise.all([
        getMembershipAction().catch(() => null),
        readFixedSavingsPlans(userId).catch((error) => {
            logger.error("[my-savings] plans read failed; the client will fetch", error);
            return null;
        }),
    ]);

    const membership = rawSeed("cooperative membership", membershipResult);

    //   All or nothing, in one expression — see #562.
    const initial = membership !== null && plans !== null ? { membership, plans } : null;

    return <MySavingsClient initial={initial} />;
}
