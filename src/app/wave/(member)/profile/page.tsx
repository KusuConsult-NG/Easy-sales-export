/**
 * A WAVE member's profile — the server half. See #543 / #545.
 *
 * Two reads, and the second is CONDITIONAL on the first: the membership check
 * decides whether this visitor is a member at all, and only a member's
 * statistics are worth reading. Doing them both unconditionally would be
 * faster and would also do the work for every visitor the screen is about to
 * send back to /wave, which is what #543 held the WAVE dashboard back for.
 *
 * So the chain is walked in order here, and every decision it feeds — the
 * "could not tell" toast and the not-enrolled redirect, both #323 — stays in
 * the client, reading the same results it would have fetched itself.
 *
 * A break anywhere seeds nothing and the client walks the chain as before.
 */

import { checkWaveMembershipAction, getWaveMemberStatsAction } from "@/app/actions/wave";
import { rawSeed } from "@/lib/server-seed";
import WaveProfileClient from "./WaveProfileClient";

/**
 *   #556 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function WaveProfilePage() {
    const membership = rawSeed(
        "wave membership", await checkWaveMembershipAction().catch(() => null),
    );

    //   Only for a member who is staying on this screen.
    const stats = membership?.success && membership.data?.enrolled
        ? rawSeed("wave member stats", await getWaveMemberStatsAction().catch(() => null))
        : null;

    //   All or nothing: a half-walked chain is a seed present while the rest
    //   still fetches, the failure the ledger warns about.
    const complete = membership !== null
        && (!membership.success || !membership.data?.enrolled || stats !== null);

    return (
        <WaveProfileClient
            initial={complete && membership ? { membership, stats } : null}
        />
    );
}
