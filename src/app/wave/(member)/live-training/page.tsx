/**
 * WAVE live training — the server half. See #543 / #545 / #567.
 *
 * A "use client" page that fetched this application's own training-sessions
 * route on mount, on a 60-second poll — so the wasted first hop happened on
 * every visit, and the poll carried on after it.
 *
 * It reads through the same function the route uses, and that function decides
 * ACCESS as well as content. They are one function on purpose: the listing
 * carries `roomKey`, the secret that opens the video classroom, and the gate in
 * front of it has already been wrong twice — once admitting every signed-in
 * account to a women's-only programme's meeting links, once refusing a member
 * approved within the last hour because the session's copy of her status was
 * stale. A page that copied the query and left the gate behind would be the
 * first of those again.
 *
 * A refusal seeds nothing rather than an empty schedule: "you may not see this"
 * and "there is nothing scheduled" are different answers, and the client asks
 * the route itself, which says so with a 403.
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { readWaveTrainingSessions } from "@/lib/wave-training-reader";
import LiveTrainingClient from "./LiveTrainingClient";

/**
 *   #567 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function WAVELiveTrainingPage() {
    const session = await auth().catch(() => null);

    if (!session?.user?.id) return <LiveTrainingClient initial={null} />;

    const result = await readWaveTrainingSessions(session as any).catch((error) => {
        logger.error("[live-training] read failed; the client will fetch instead", error);
        return null;
    });

    return (
        <LiveTrainingClient
            initial={result?.allowed ? (result.sessions as any) : null}
        />
    );
}
