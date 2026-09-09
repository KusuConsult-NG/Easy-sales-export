/**
 * WAVE earnings — the server half. See #543 / #545.
 *
 * calculateEarningsAction walks the escrow rows to compute a commission
 * balance; it is the most expensive read on this screen and it was made AFTER
 * the page had already been sent, downloaded and hydrated. It takes a user id
 * and refuses any id but the caller's own, so the session is resolved here and
 * the same check still runs inside the action.
 *
 * A refusal seeds null and the client asks for it exactly as it always did.
 */

import { auth } from "@/lib/auth";
import { calculateEarningsAction, type MemberEarnings } from "@/app/actions/wave";
import { seedOrNull } from "@/lib/server-seed";
import WaveEarningsClient from "./WaveEarningsClient";

/**
 *   #556 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function WaveEarningsPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    const initial = userId
        ? seedOrNull<MemberEarnings>(
            "wave earnings", await calculateEarningsAction(userId).catch(() => null),
        )
        : null;

    return <WaveEarningsClient initial={initial} />;
}
