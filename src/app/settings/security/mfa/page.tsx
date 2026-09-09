/**
 * Two-factor setup — the server half. See #543 / #545 / #567.
 *
 * The screen's first act on mount was `fetch("/api/auth/mfa/status")` — a
 * second HTTP request back to the server that had just rendered the page, to
 * answer a question that server could have answered in the response it was
 * already writing.
 *
 * It reads through the same function the route uses, which THROWS rather than
 * answering false when it cannot read. That matters more here than anywhere
 * else in this ledger: the endpoint's catch once replied "success, no second
 * factor" to a database failure, telling a protected account it was
 * unprotected. A seed that could absorb a failure would put that back.
 *
 * So a failed read seeds nothing, and the client keeps its own #313 "unknown"
 * state.
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { readMfaStatus } from "@/lib/mfa-status-reader";
import MfaSetupClient from "./MfaSetupClient";

/**
 *   #567 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MFASetupPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    if (!userId) return <MfaSetupClient initial={null} />;

    const initial = await readMfaStatus(userId).catch((error) => {
        logger.error("[mfa] status read failed; the client will fetch instead", error);
        return null;
    });

    return <MfaSetupClient initial={initial} />;
}
