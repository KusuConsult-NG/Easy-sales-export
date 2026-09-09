/**
 * A member's withdrawal history — the server half. See #543 / #545 / #564.
 *
 * getMyWithdrawals is already session-scoped, so the server simply calls it and
 * hands the list down. See #566 in WithdrawalsClient for the HTTP round trip
 * this screen was making in FRONT of that call, to ask a question the call
 * answers itself.
 */

import { getMyWithdrawals } from "@/app/actions/my-data";
import { logger } from "@/lib/logger";
import WithdrawalsClient from "./WithdrawalsClient";

/**
 *   #564 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function WithdrawalsHistoryPage() {
    const initial = await getMyWithdrawals().catch((error) => {
        logger.error("[withdrawals] read failed; the client will fetch instead", error);
        return null;
    });

    return <WithdrawalsClient initial={initial as any[] | null} />;
}
