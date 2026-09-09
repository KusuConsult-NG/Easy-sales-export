/**
 * WAVE training events — the server half. See #543 / #545.
 *
 * The same conditional chain as the WAVE profile page: the membership check
 * gates everything, so it runs first and the two reads it gates run TOGETHER.
 * The client awaited those two one after the other, which cost the member the
 * sum of both round trips; they are independent and are now issued in parallel
 * on whichever side does the work.
 *
 * All the branching — the "could not tell" toast and the not-enrolled redirect,
 * both #323 — stays in the client, reading the same results.
 */

import {
    checkWaveMembershipAction,
    getUserTrainingRegistrationsAction,
    getWaveTrainingEventsAction,
} from "@/app/actions/wave";
import { rawSeed } from "@/lib/server-seed";
import WaveTrainingClient from "./WaveTrainingClient";

/**
 *   #556 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function WaveTrainingPage() {
    const membership = rawSeed(
        "wave membership", await checkWaveMembershipAction().catch(() => null),
    );

    const enrolled = membership?.success === true && membership.data?.enrolled === true;

    const [events, registrations] = enrolled
        ? await Promise.all([
            getWaveTrainingEventsAction(undefined, 100, true).catch(() => null),
            getUserTrainingRegistrationsAction().catch(() => null),
        ])
        : [null, null];

    //   All or nothing, for the reason the ledger records: a seed present while
    //   the rest of the chain still fetches is worse than no seed at all.
    const complete = membership !== null
        && (!enrolled || (events !== null && registrations !== null));

    return (
        <WaveTrainingClient
            initial={complete && membership ? { membership, events, registrations } : null}
        />
    );
}
