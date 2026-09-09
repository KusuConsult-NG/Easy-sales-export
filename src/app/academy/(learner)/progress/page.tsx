/**
 * Academy progress — the server half. See #543 / #545.
 *
 * The aggregate and the streak were already parallel in the client and are
 * fetched here instead. The raw results are handed over so the flattening into
 * nine fields, each with its own default, stays in one place.
 */

import { auth } from "@/lib/auth";
import { getUserAggregateProgressAction, calculateStreakAction } from "@/app/actions/academy";
import ProgressClient from "./ProgressClient";

/**
 *   #550 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function ProgressPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    const [aggResult, streakResult] = userId
        ? await Promise.all([
            getUserAggregateProgressAction(userId).catch(() => null),
            calculateStreakAction(userId).catch(() => null),
        ])
        : [null, null];

    const initial = aggResult && streakResult ? { aggResult, streakResult } : null;

    return <ProgressClient initial={initial} />;
}
